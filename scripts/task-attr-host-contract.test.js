'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
assert.match(source, /TOMATO_MINUTE_ATTR_DEFAULT_VERSION\s*=\s*1/, 'minute-format defaults must have an explicit migration version');
assert.match(source, /cfg\.enableMinuteAttr\s*=\s*true[\s\S]*cfg\.minuteAttrDefaultVersion\s*=\s*TOMATO_MINUTE_ATTR_DEFAULT_VERSION/, 'legacy minute-format defaults must migrate to enabled once');
assert.match(source, /enableMinuteAttr:\s*cfg\.enableMinuteAttr !== false[\s\S]*minuteAttrDefaultVersion:\s*TOMATO_MINUTE_ATTR_DEFAULT_VERSION/, 'minute-format accounting must preserve an explicit opt-out after migration');

const resolverStart = source.indexOf('function resolveTomatoTaskAttrContextFromDom');
const resolverEnd = source.indexOf('\n    async function getTomatoBlockAttrs', resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'task attribute resolver must remain extractable');
const resolverBlock = source.slice(resolverStart, resolverEnd);

assert.match(resolverBlock, /attrHostId:\s*taskId/, 'DOM task resolution must always use the NodeListItem as attribute host');
assert.doesNotMatch(resolverBlock, /directTaskItems\.length\s*===\s*1[\s\S]*?\?\s*listId/, 'a singleton task must not use its parent NodeList as attribute host');
assert.match(resolverBlock, /resolveTomatoTaskTargetFromKernel/, 'standalone mode must resolve a canonical task item through the Kernel');
assert.doesNotMatch(resolverBlock, /writeId/, 'canonical task context must not expose an ambiguous writeId');
assert.doesNotMatch(resolverBlock, /getTaskCustomPropsByAnyId|__taskHorizonBuildTaskLikeFromBlockId/, 'generic Task Horizon block wrappers must not classify ordinary blocks as tasks');

assert.doesNotMatch(source, /function getTomatoTaskAttrRows|function readTomatoAttrValue/, 'steady reads must not merge multiple attribute hosts');
assert.match(source, /async function readCanonicalTomatoTaskAttrs/, 'task attributes must have one canonical reader');
assert.match(source, /async function writeCanonicalTomatoTaskAttrs/, 'task attributes must have one canonical writer');
assert.match(source, /async function resolveTomatoAttrContext[\s\S]*?kind:\s*'block'[\s\S]*?attrHostId:\s*requestedId/, 'confirmed non-task blocks must keep their own attribute host');
assert.match(source, /async function writeTomatoAttrContextAttrs[\s\S]*?ctx\.kind\s*!==\s*'block'[\s\S]*?writeCanonicalTomatoTaskAttrs/, 'task writes must still delegate to the canonical task writer');

const writerStart = source.indexOf('async function writeCanonicalTomatoTaskAttrs');
const writerEnd = source.indexOf('\n    async function writeTomatoAttrContextAttrs', writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, 'canonical task writer must remain extractable');
const writerBlock = source.slice(writerStart, writerEnd);
assert.match(writerBlock, /id:\s*attrHostId/, 'canonical writes must target attrHostId');
assert.match(writerBlock, /taskId\s*!==\s*attrHostId/, 'canonical writes must reject a non-item host mismatch');
assert.doesNotMatch(writerBlock, /applyTaskAttrUpdateWithUndo|writeId|requestedTaskId\s*\|\|/, 'canonical writes must not fall back to Task Horizon or a requested block');

const timeStart = source.indexOf('async function updateTaskBlockTomatoTime');
const timeEnd = source.indexOf('\n    function normalizeTaskBlockTomatoCountValue', timeStart);
const timeBlock = source.slice(timeStart, timeEnd);
assert.match(timeBlock, /withTomatoTaskAttrLock/, 'timer settlement must serialize read-modify-write by task item');
assert.match(timeBlock, /readTomatoAttrContextAttrs/, 'timer settlement must read through the classified task-or-block context');
assert.match(timeBlock, /writeTomatoAttrContextAttrs/, 'timer settlement must write through the classified task-or-block context');
assert.doesNotMatch(timeBlock, /useTaskHorizon|writeId/, 'timer settlement must not keep the old write fallback');
assert.match(timeBlock, /policy\.tomatoActualCountBySpentEnabled === false/, 'count attributes must only be written when Task Horizon is not deriving count from spent time');
assert.match(timeBlock, /const countOnly = options\?\.countOnly === true;[\s\S]*!countOnly && enableHourAttr[\s\S]*!countOnly && enableMinuteAttr/, 'count-only effects must not also add duration');

const projectionStart = source.indexOf('    function getAccountingProjectionDeltas(');
const projectionEnd = source.indexOf('    function getAccountingBaselineKey(', projectionStart);
assert.ok(projectionStart >= 0 && projectionEnd > projectionStart, 'accounting projection policy must remain extractable');
const projectionContext = vm.createContext({
    Number,
    String,
    ensureTaskBlockTomatoTimeConfig: () => ({
        enableHourAttr: true,
        hourAttrName: 'custom-hours',
        enableMinuteAttr: false,
        minuteAttrName: 'custom-minutes',
        enableCountAttr: true,
        countAttrName: 'custom-count',
    }),
    getTomatoAccountingPolicy: () => ({}),
});
vm.runInContext(`${source.slice(projectionStart, projectionEnd)}\nthis.project = getAccountingProjectionDeltas;`, projectionContext);
const derivedCountProjection = projectionContext.project({
    enabled: true,
    tomatoSpentAttrMode: 'minutes',
    tomatoActualCountBySpentEnabled: true,
    tomatoSpentAttrKeyHours: 'custom-hours',
    tomatoSpentAttrKeyMinutes: 'custom-minutes',
    tomatoCountAttrKey: 'custom-count',
}, 3_600_000, 1);
assert.equal(derivedCountProjection['custom-hours'], 1);
assert.equal(derivedCountProjection['custom-minutes'], 60);
assert.equal(derivedCountProjection['custom-count'], undefined, 'spent-time count mode must not project the count attribute');
const explicitCountProjection = projectionContext.project({
    enabled: true,
    tomatoSpentAttrMode: 'hours',
    tomatoActualCountBySpentEnabled: false,
    tomatoSpentAttrKeyHours: 'custom-hours',
    tomatoSpentAttrKeyMinutes: 'custom-minutes',
    tomatoCountAttrKey: 'custom-count',
}, 3_600_000, 1);
assert.equal(explicitCountProjection['custom-count'], 1, 'explicit count mode must retain the completed-focus count');

const accountingStart = source.indexOf('    const AccountingRepository = {');
const accountingEnd = source.indexOf('    const TransitionExecutor = {', accountingStart);
const accountingBlock = source.slice(accountingStart, accountingEnd);
assert.match(accountingBlock, /baseline\.values\[key\] = storedBaseline \+ \(currentValue - lastProjected\)/, 'new effects must absorb user edits into the persistent baseline');
assert.match(accountingBlock, /baseline\.values\[key\][\s\S]*projectedTotals/, 'policy re-projection must combine the persistent baseline with ledger totals');

const recordStart = source.indexOf('    async function recordEndTime(');
const recordEnd = source.indexOf('\n    /**\n     * 清除当前计时记录中的任务块', recordStart);
const recordBlock = source.slice(recordStart, recordEnd);
assert.match(recordBlock, /useValidatedV2Association[\s\S]*associationAtEnd\?\.taskBlockId/, 'v2 history and accounting must use the session-validated association snapshot');
assert.match(recordBlock, /effectId: `count:\$\{recordData\.focusSessionId\}`[\s\S]*kind: 'count'[\s\S]*durationMs: 0/, 'completed focus sessions must use a separate idempotent count effect');
assert.match(recordBlock, /TransitionExecutor\.execute\([\s\S]*accountingDrafts: queuedAccountingDrafts/, 'duration and count effects must be replayed through one ordered accounting queue');

const reminderResolverStart = source.indexOf('async function resolveReminderBlockAttrContext');
const reminderResolverEnd = source.indexOf('\n    globalThis.__tomatoTimer', reminderResolverStart);
assert.ok(reminderResolverStart >= 0 && reminderResolverEnd > reminderResolverStart, 'reminder host resolver must remain extractable');
const reminderResolverBlock = source.slice(reminderResolverStart, reminderResolverEnd);
assert.match(reminderResolverBlock, /resolveTomatoTaskTarget\(requestedId\)/, 'reminders must classify the requested block as task or ordinary block');
assert.match(reminderResolverBlock, /kind:\s*'task'/, 'task reminders must expose task storage context');
assert.match(reminderResolverBlock, /kind:\s*'block'/, 'ordinary block reminders must preserve direct-block storage');
assert.doesNotMatch(reminderResolverBlock, /preferDirect|directReminder/, 'existing legacy attributes must not override task canonicalization');

const queryStart = source.indexOf('async function queryAllReminderBlocks');
const queryEnd = source.indexOf('\n    const __getReminderDockMeta', queryStart);
assert.ok(queryStart >= 0 && queryEnd > queryStart, 'global reminder query must remain extractable');
const queryBlock = source.slice(queryStart, queryEnd);
assert.match(queryBlock, /block\?\.type[\s\S]*?===\s*'l'[\s\S]*?resolveTomatoTaskTarget\(block\.id\)/, 'legacy list reminders must be classified before use');
assert.match(queryBlock, /directReminderIds/, 'canonical reminder rows must suppress their legacy list mirrors');
assert.match(queryBlock, /seenReminderRows/, 'duplicate SQL rows from the same attribute host must be deduplicated');
assert.doesNotMatch(queryBlock, /seenReminderIds\.has\(canonicalId\)/,
    'distinct reminder rows must not be merged solely because they resolve to the same canonical host');

const migrationStart = source.indexOf('async function ensureTomatoTaskAttrsMigrated');
const migrationEnd = source.indexOf('\n    async function readCanonicalTomatoTaskAttrs', migrationStart);
assert.ok(migrationStart >= 0 && migrationEnd > migrationStart, 'legacy task attribute migration must remain extractable');
const migrationBlock = source.slice(migrationStart, migrationEnd);
assert.match(migrationBlock, /firstTaskId[\s\S]*?firstTaskId\s*!==\s*taskId/, 'parent-list legacy attributes must only migrate to the current first task item');
assert.ok(migrationBlock.indexOf("id: taskId, attrs: targetPatch") < migrationBlock.indexOf("id: parentListId, attrs: sourceCleanup"), 'legacy source cleanup must happen after the canonical write');
assert.match(migrationBlock, /verifiedAttrs/, 'canonical migration writes must be read back before cleanup');

const databaseStart = source.slice(
    source.indexOf('async function startTimerFromDatabaseBlock'),
    source.indexOf('\n    // ========== 提醒功能', source.indexOf('async function startTimerFromDatabaseBlock'))
);
assert.match(databaseStart, /currentDatabaseBlockId\s*=\s*taskBlockId/, 'database timers must retain their database association');
assert.match(databaseStart, /startTimerFromTaskBlock\(/, 'database timers must retain the existing timer start path');

const kernelStart = source.indexOf('function buildCanonicalTomatoTaskContext');
const kernelEnd = source.indexOf('\n    async function resolveTomatoTaskTarget(blockId)', kernelStart);
assert.ok(kernelStart >= 0 && kernelEnd > kernelStart, 'Kernel task target resolver must remain extractable');
const kernelBlock = source.slice(kernelStart, kernelEnd);

(async () => {
    const rowsById = {
        'task-1': [{ id: 'task-1', parent_id: 'list-1', type: 'i', subtype: 't' }],
        'list-1': [{ id: 'list-1', parent_id: 'doc-1', type: 'l', subtype: 't' }],
        'doc-1': [{ id: 'doc-1', parent_id: '', type: 'd', subtype: '' }],
        'plain-list': [{ id: 'plain-list', parent_id: 'doc-1', type: 'l', subtype: 'u' }],
    };
    const context = vm.createContext({
        escapeSqlString: (value) => String(value || '').replace(/'/g, "''"),
        postJSON: async (_url, payload) => {
            const stmt = String(payload?.stmt || '');
            const childMatch = stmt.match(/parent_id = '([^']+)'/);
            if (childMatch) {
                const rows = childMatch[1] === 'list-1' ? [{ id: 'task-1' }] : [];
                return { ok: true, data: { code: 0, data: rows } };
            }
            const idMatch = stmt.match(/WHERE id = '([^']+)'/);
            return { ok: true, data: { code: 0, data: rowsById[idMatch?.[1]] || [] } };
        },
    });
    vm.runInContext(`${kernelBlock}\nthis.resolveKernelTarget = resolveTomatoTaskTargetFromKernel;`, context);

    const directTask = await context.resolveKernelTarget('task-1');
    assert.equal(directTask.kind, 'task');
    assert.equal(directTask.context.taskId, 'task-1');
    assert.equal(directTask.context.attrHostId, 'task-1');

    const taskList = await context.resolveKernelTarget('list-1');
    assert.equal(taskList.kind, 'task');
    assert.equal(taskList.context.attrHostId, 'task-1', 'a task NodeList must resolve to its first NodeListItem');

    const documentBlock = await context.resolveKernelTarget('doc-1');
    assert.equal(documentBlock.kind, 'block');
    assert.equal(documentBlock.requestedId, 'doc-1', 'a document block must remain a direct block target');

    const plainList = await context.resolveKernelTarget('plain-list');
    assert.equal(plainList.kind, 'block');
    assert.equal(plainList.requestedId, 'plain-list', 'a non-task list must keep its own block ID');

    const queryContext = vm.createContext({
        Date,
        Set,
        JSON,
        Math,
        Number,
        String,
        Array,
        TASK_START_DATE_ATTR: 'custom-start-date',
        TASK_COMPLETION_TIME_ATTR: 'custom-completion-time',
        TASK_REPEAT_RULE_ATTR: 'custom-task-repeat-rule',
        TASK_REPEAT_STATE_ATTR: 'custom-task-repeat-state',
        Logger: { warn() {}, error() {} },
        isSyncEnabled: () => false,
        flushReminderTransaction: async () => true,
        escapeSqlString: value => String(value || '').replace(/'/g, "''"),
        __isCompletedReminderTaskBlockRow: () => false,
        __sanitizeReminderData: (data, meta) => ({ ...data, blockId: meta.blockId }),
        resolveTomatoTaskTarget: async id => id === 'legacy-list'
            ? { kind: 'task', context: { taskId: 'task-a', attrHostId: 'task-a' } }
            : { kind: 'block' },
        resolveReminderBlockAttrContext: async () => ({ reminderBlockId: 'task-a' }),
        readReminderFromResolvedContext: async () => ({
            blockId: 'task-a',
            blockName: '同日任务 A',
            startDate: '2026-08-18',
            times: ['09:00'],
            enabled: true,
        }),
    });
    const directRows = [
        {
            id: 'task-a', type: 'i', content: '同日任务 A', markdown: '* [ ] 同日任务 A', root_id: 'doc-1',
            reminder_data: JSON.stringify({ blockName: '同日任务 A', startDate: '2026-08-18', times: ['09:00'], enabled: true }),
        },
        {
            id: 'task-b', type: 'i', content: '同日任务 B', markdown: '* [ ] 同日任务 B', root_id: 'doc-1',
            reminder_data: JSON.stringify({ blockName: '同日任务 B', startDate: '2026-08-18', times: ['09:00'], enabled: true }),
        },
        {
            id: 'task-c', type: 'i', content: '本周任务 C', markdown: '* [ ] 本周任务 C', root_id: 'doc-1',
            reminder_data: JSON.stringify({ blockName: '本周任务 C', startDate: '2026-08-20', times: ['09:00'], enabled: true }),
        },
    ];
    queryContext.postJSON = async () => ({ ok: true, data: { code: 0, data: directRows } });
    vm.runInContext(`${queryBlock}\nthis.queryReminders = queryAllReminderBlocks;`, queryContext);

    const sameDateReminders = await queryContext.queryReminders();
    assert.deepEqual(Array.from(sameDateReminders, reminder => reminder.blockId), ['task-a', 'task-b', 'task-c'],
        'different task IDs must survive the query even when their dates and times match');

    queryContext.postJSON = async () => ({
        ok: true,
        data: {
            code: 0,
            data: [
                {
                    id: 'legacy-list', type: 'l', content: '', markdown: '', root_id: 'doc-1',
                    reminder_data: JSON.stringify({ blockName: '旧宿主镜像', startDate: '2026-08-18', times: ['09:00'], enabled: true }),
                },
                directRows[0],
                directRows[1],
            ],
        },
    });
    const migratedReminders = await queryContext.queryReminders();
    assert.deepEqual(Array.from(migratedReminders, reminder => reminder.blockId), ['task-a', 'task-b'],
        'a legacy list mirror must not duplicate its canonical task reminder');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
