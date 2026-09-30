'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(process.env.TOMATO_TEST_SOURCE || path.resolve(__dirname, '../tomato.js'), 'utf8');
const between = (a, b) => {
    const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
    assert.ok(start >= 0 && end > start, a);
    return source.slice(start, end);
};
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function cacheHarness(render = false, globals = {}) {
    const requests = [], painted = [], timers = [];
    const context = vm.createContext({ Date, Array, Promise, Map, Set,
        queryAllReminderBlocks: (forceRefresh, options) => {
            const request = { ...deferred(), forceRefresh, options };
            requests.push(request);
            return request.promise;
        },
        setTimeout: fn => timers.push(fn),
        ...globals,
    });
    vm.runInContext(between('    const __reminderDockDataCache =', '    const __queueSaveReminderSettings =') +
        between('    const __invalidateReminderDockCache =', '    const __ensureReminderDockListDom =') +
        '\nthis.api = { invalidate: __invalidateReminderDockCache, read: __getAllRemindersForDock, cache: __reminderDockDataCache };', context);
    if (render) {
        // Preserve the real renderer's sequence guard without needing the host DOM.
        context.paint = value => painted.push(value);
        vm.runInContext(`async function __renderReminderDockListNow(sortBy, forceRefresh) {
            const seq = ++__reminderDockRenderSeq;
            const rows = await __getAllRemindersForDock(forceRefresh);
            if (seq === __reminderDockRenderSeq) paint(rows);
        }` + between('    async function renderReminderDockList(', '    function refreshReminderDockPanel(') +
            '\nthis.api.render = renderReminderDockList;', context);
    }
    return { api: context.api, context, requests, painted, timers };
}

test('completion and undo paint committed check-ins even while SQL still has the previous history', async () => {
    let savedHistory = [{ scheduledDate: '2026-09-28' }];
    let sqlHistory = savedHistory;
    const calls = [];
    const h = cacheHarness(true, {
        TASK_START_DATE_ATTR: 'custom-task-start-date',
        TASK_COMPLETION_TIME_ATTR: 'custom-task-completion-time',
        TASK_REPEAT_RULE_ATTR: 'custom-task-repeat-rule',
        TASK_REPEAT_STATE_ATTR: 'custom-task-repeat-state',
        Logger: { warn() {}, error() {} },
        isSyncEnabled: () => true,
        SyncManager: { triggerSiyuanSync: () => { calls.push('cloud-sync'); } },
        __sanitizeReminderData: (data, meta) => ({
            ...data, blockId: meta.blockId,
            taskRepeatState: JSON.parse(meta.taskRepeatState),
        }),
        postJSON: async endpoint => {
            calls.push(endpoint);
            if (endpoint === '/api/sqlite/flushTransaction') {
                sqlHistory = savedHistory;
                return { ok: true, data: { code: 0 } };
            }
            assert.equal(endpoint, '/api/query/sql');
            return { ok: true, data: { code: 0, data: [{
                id: 'habit', type: 'i', reminder_data: '{}',
                task_repeat_rule: JSON.stringify({ enabled: true, trigger: 'checkin' }),
                task_repeat_state: JSON.stringify({ checkinHistory: sqlHistory }),
            }] } };
        },
    });
    vm.runInContext(between('    async function flushReminderTransaction()', '    async function saveBlockReminder(') +
        between('    async function queryAllReminderBlocks(', '    const __getReminderDockMeta ='), h.context);
    await h.api.render('time', false);
    for (const checked of [true, false]) {
        savedHistory = checked
            ? [{ scheduledDate: '2026-09-28' }, { scheduledDate: '2026-09-30' }]
            : [{ scheduledDate: '2026-09-28' }];
        h.api.invalidate();
        await h.api.render('time', false);
        assert.deepEqual(JSON.parse(JSON.stringify(h.painted.at(-1)[0].taskRepeatState.checkinHistory)),
            savedHistory, `${checked ? 'completion' : 'undo'} must paint the saved history on its first refresh`);
    }
    assert.deepEqual(calls, ['/api/query/sql', '/api/sqlite/flushTransaction', '/api/query/sql',
        '/api/sqlite/flushTransaction', '/api/query/sql']);
    await h.api.read(false);
    assert.equal(calls.length, 5, 'switching views may reuse the current committed snapshot');
    h.api.cache.fetchedAtMs = 0;
    await h.api.read(false);
    assert.equal(calls.length, 6, 'ordinary polling need not flush again');
    assert.equal(calls.at(-1), '/api/query/sql');
});

test('completion starts a fresh read while the old list query is still pending', async () => {
    const h = cacheHarness();
    const before = h.api.read(false);
    h.api.invalidate();
    const after = h.api.read(false);
    assert.equal(h.requests.length, 2, 'a read started before saving must not be reused');
    h.requests[1].resolve([{ done: true }]);
    assert.deepEqual(await after, [{ done: true }]);
    h.requests[0].resolve([{ done: false }]);
    assert.deepEqual(await before, [{ done: true }], 'late query must join the committed state');
    assert.deepEqual(h.api.cache.allReminders, [{ done: true }]);
});

test('rapid completion and undo cannot restore an obsolete completed list', async () => {
    const h = cacheHarness();
    h.api.invalidate();
    const completed = h.api.read(false);
    h.api.invalidate();
    const undone = h.api.read(false);
    h.requests[0].resolve([{ done: true }]);
    await Promise.resolve(); await Promise.resolve();
    const waiting = h.api.cache.inFlight;
    assert.ok(waiting, 'finishing an old query must not clear the current request');
    h.requests[1].resolve([{ done: false }]);
    assert.deepEqual(await undone, [{ done: false }]);
    assert.deepEqual(await completed, [{ done: false }]);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.forceRefresh === false && request.options.flush === true),
        'both mutations require a fresh local SQL snapshot without cloud synchronization');
});

test('a mutation can repaint without waiting for an older render to finish', async () => {
    const h = cacheHarness(true);
    const oldRender = h.api.render('time', false);
    h.api.invalidate();
    const freshRender = h.api.render('time', false);
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve([{ done: true }]);
    await freshRender;
    assert.deepEqual(h.painted, [[{ done: true }]], 'committed state must paint before the old query resolves');
    h.requests[0].resolve([{ done: false }]);
    await oldRender;
    assert.deepEqual(h.painted, [[{ done: true }]], 'old render must not overwrite the completed view');
});

test('task changes request a repaint before reading and syncing device notifications', async () => {
    const read = deferred(), notifications = deferred();
    const calls = [];
    const context = vm.createContext({
        getBlockReminder: () => { calls.push('read'); return read.promise; },
        __syncReminderDeviceSchedule: () => { calls.push('notifications'); return notifications.promise; },
        __invalidateReminderDockCache: () => calls.push('invalidate'),
        refreshReminderDockPanel: () => calls.push('paint'),
        updateReminderBadge: () => calls.push('badge'),
        scheduleWechatReminderReconcile: () => calls.push('wechat'),
    });
    vm.runInContext(between('    async function __refreshReminderAfterTaskContextChanged(', '    // 手动触发检查') +
        '\nthis.refresh = __refreshReminderAfterTaskContextChanged;', context);
    const refresh = context.refresh('habit', { reason: 'task-checkin' });
    assert.deepEqual(calls.slice(0, 2), ['invalidate', 'paint']);
    read.resolve({ blockId: 'habit' }); await new Promise(setImmediate);
    assert.ok(calls.includes('notifications'));
    assert.ok(calls.indexOf('paint') < calls.indexOf('notifications'));
    notifications.resolve();
    assert.equal((await refresh).ok, true);
});

test('forced refresh still paints its own newly loaded result', async () => {
    const h = cacheHarness(true);
    const render = h.api.render('time', true);
    h.requests[0].resolve([{ done: true }]);
    await render;
    assert.deepEqual(h.painted, [[{ done: true }]]);
});
