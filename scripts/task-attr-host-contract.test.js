'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

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
assert.match(queryBlock, /seenReminderIds/, 'canonical and legacy reminder rows must be deduplicated');

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
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
