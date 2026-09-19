'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
function extract(start, end) {
    const left = source.indexOf(start);
    const right = source.indexOf(end, left);
    assert.ok(left >= 0 && right > left);
    return source.slice(left, right);
}
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE blocks (id TEXT PRIMARY KEY, parent_id TEXT, type TEXT, subtype TEXT, sort INTEGER, created TEXT);
    INSERT INTO blocks VALUES ('doc', '', 'd', '', 0, ''),
        ('list', 'doc', 'l', 't', 1, ''), ('task', 'list', 'i', 't', 1, ''),
        ('sibling', 'list', 'i', 't', 2, ''), ('paragraph', 'task', 'p', '', 1, ''),
        ('plain-list', 'doc', 'l', 'u', 2, ''), ('plain-item', 'plain-list', 'i', 'u', 1, '');`);
const attrs = new Map([['task', { 'custom-tomato-minutes': '103.51' }], ['list', { 'custom-tomato-minutes': '40.12' }]]);
const events = [];
const started = [];
const highlighted = [];
const context = vm.createContext({
    Element: class {},
    findTomatoBlockElementById: () => null,
    escapeSqlString: (value) => String(value).replace(/'/g, "''"),
    postJSON: async (_url, { stmt }) => ({ ok: true, data: { code: 0, data: db.prepare(stmt).all() } }),
    currentTaskBlockId: null, currentTaskBlockName: null, currentDatabaseBlockId: null,
    localAssociationChangedAtMs: 0, lastCompletedAssociationFocusSnapshot: null,
    activeRoutineButtonIndex: null, activeRoutineButtonBlockId: null,
    syncState: { integrationEnvelope: {} }, focusRestoreSource: 'block-menu',
    __sanitizeTaskAssociationName: (value) => String(value || '').trim(),
    __resolveTaskAssociationName: async (id, name) => name || `title:${id}`,
    buildTaskAssociationSnapshot: (value) => ({ ...value, associationVersion: 1 }),
    isTaskAssociationSyncEnabled: () => true, isSyncEnabled: () => false,
    clearRoutineButtonRunningHighlight() {}, updateTaskBlockIcon() {}, updateTaskBlockTooltip() {},
    __taskHorizonOnTomatoAssociationChanged: (event) => events.push(event),
    window: {}, Logger: { info() {}, warn() {}, error(...args) { throw new Error(args.join(' ')); } },
    userSettings: {}, timerMode: 'countdown',
    getTomatoAccountingPolicy: () => ({ tomatoSpentAttrMode: 'minutes' }),
    ensureTaskBlockTomatoTimeConfig: () => ({ enableHourAttr: false, enableMinuteAttr: true }),
    withTomatoTaskAttrLock: async (_id, work) => work(),
    readTomatoAttrContextAttrs: async ({ attrHostId }) => ({ ...(attrs.get(attrHostId) || {}) }),
    writeTomatoAttrContextAttrs: async ({ attrHostId }, patch) => { attrs.set(attrHostId, { ...attrs.get(attrHostId), ...patch }); return true; },
    assertTimerReady() {}, clearTimelineActiveLayers() {}, finalizeCurrentSegmentBeforeTransition() {},
    requireTimerPersistence: async () => {}, updateDisplay() {}, setFocusRestoreSource() {},
    startTimer: async () => started.push({ ...context.syncState.integrationEnvelope.taskAssociation }),
    hasRestorableFocusSource: () => true, highlightTaskBlock: (id) => highlighted.push(id),
    startHighlightKeepAlive() {}, setTimeout: (callback) => callback(),
    isMobileDevice: () => false,
});
vm.runInContext([
    extract('function resolveTomatoTaskAttrContextFromDom(', 'async function getTomatoBlockAttrs('),
    extract('async function setTaskAssociation(', 'async function rollbackFailedTimerStart('),
    extract('async function switchToCountdownAndStartWithTask(', 'async function switchToStopwatchAndStart('),
    extract('async function switchToStopwatchAndStartWithTask(', 'async function startBreakMode('),
    extract('function getTaskBlockLi(', 'async function startTimerFromTaskBlock('),
    extract('async function startTimerFromTaskBlock(', '// ========== DOM 查询缓存管理'),
    extract('async function updateTaskBlockTomatoTime(', 'function normalizeTaskBlockTomatoCountValue('),
].join('\n'), context);

(async () => {
    for (const mode of ['countdown', 'stopwatch']) {
        await context.startTimerFromTaskBlock({ dataset: { nodeId: 'list' }, textContent: 'container title + sibling' }, 25, mode);
        const association = started.at(-1);
        assert.equal(association.taskBlockId, 'task', `${mode} container menu must associate the inner task`);
        assert.equal(association.attrHostId, 'task');
        assert.equal(association.taskBlockName, 'title:task', 'container text must not replace the inner task title');
        assert.equal(highlighted.at(-1), 'task');
        assert.equal(events.at(-1).taskBlockId, 'task');
        assert.equal(await context.updateTaskBlockTomatoTime(association.taskBlockId, 60, { attrHostId: association.attrHostId }), true,
            'the association snapshot must pass the accounting host-identity check');
    }
    assert.equal(attrs.get('task')['custom-tomato-minutes'], '105.51');
    assert.equal(attrs.get('list')['custom-tomato-minutes'], '40.12', 'existing outer totals must not be blindly added or overwritten');
    const makeElement = (id, className, type, subtype) => ({
        dataset: { nodeId: id, type, subtype }, className,
        classList: { contains: (name) => name === className },
        textContent: `DOM:${id}`, matches: () => false,
        closest() { return this.parentList || null; },
        querySelector: (selector) => selector === ':scope > .p' ? { textContent: `DOM:${id}` } : null,
    });
    const listElement = makeElement('list', 'list', 'NodeList', 't');
    const taskElement = makeElement('task', 'li', 'NodeListItem', 't');
    const ordinaryElement = makeElement('plain-item', 'li', 'NodeListItem', 'u');
    taskElement.parentList = listElement;
    ordinaryElement.parentList = listElement;
    listElement.querySelectorAll = () => [ordinaryElement, taskElement];
    listElement.querySelector = (selector) => selector.includes('[data-subtype="t"]') ? taskElement : ordinaryElement;
    await context.startTimerFromTaskBlock(listElement, 25);
    assert.equal(started.at(-1).taskBlockId, 'task', 'DOM container menus must prefer the first task even when an ordinary item precedes it');
    assert.equal(started.at(-1).taskBlockName, 'DOM:task');
    listElement.querySelectorAll = () => [taskElement];
    await context.startTimerFromTaskBlock(taskElement, 25);
    assert.equal(started.at(-1).taskBlockId, 'task');
    assert.equal(started.at(-1).taskBlockName, 'DOM:task', 'singleton DOM tasks must not be promoted back to their list');
    await context.setTaskAssociation('paragraph', 'paragraph title', null);
    assert.equal(context.currentTaskBlockId, 'task');
    await context.setTaskAssociation('sibling', 'sibling title', 'database-row');
    assert.equal(context.currentTaskBlockId, 'sibling', 'direct sibling starts must retain their identity');
    assert.equal(context.currentDatabaseBlockId, 'database-row', 'database association must be retained');
    for (const id of ['doc', 'plain-list', 'plain-item']) {
        await context.setTaskAssociation(id, id, null);
        assert.equal(context.currentTaskBlockId, id, 'ordinary blocks must keep direct associations');
        assert.equal(context.syncState.integrationEnvelope.taskAssociation.attrHostId, id);
    }
    await context.setTaskAssociation(null, null, null);
    assert.equal(context.currentTaskBlockId, null);
    assert.equal(context.syncState.integrationEnvelope.taskAssociation, null);
    console.log('task container association tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
