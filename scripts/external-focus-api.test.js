'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createRuntime, attachFloatTimerControls, extract, deferred } = require('./timer-journal-queue.test');
const call = (runtime, script) => vm.runInContext(script, runtime.context);
const request = JSON.stringify({ context: { consumer: 'siyuan-checkin', itemId: 'read', itemUnit: '分钟', tomatoMode: 'minutes' } });
const start = runtime => call(runtime, `__dockTomato.focus.start(${request})`);
const completed = runtime => runtime.events.filter(event => event.type === 'tomato:focus-session-completed');

function setup(enabled = true, mode = 'countdown', storage, options) {
    const runtime = createRuntime(storage, options);
    const timer = attachFloatTimerControls(runtime, mode, 'desktop');
    const events = [];
    const notificationReasons = [];
    Object.assign(runtime.context, {
        __tomatoTimerReady: true, TextEncoder,
        __getDefaultTomatoTimeMinutes: () => 30,
        lastCompletedAssociationFocusSnapshot: null, taskAssociationCleared: false,
        localAssociationChangedAtMs: 0,
        syncActiveRoutineButtonFromState() {},
        async reconcileTrackedTimerNotification(reason) { notificationReasons.push(reason); },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    });
    Object.assign(runtime.context.window, { dispatchEvent: event => events.push(event) });
    call(runtime, `
        globalThis.__dockTomato = { stats: {sentinel:true} };
        ${extract('    // Optional focus API,', '    // ========== 配置项')}
        ${extract('    function updateFromSyncState()', '    function buildTimerRuntimeSignature(')}
        ${extract('    function applyAcceptedSyncStateToTimer(', '    // ========== 正计时模式专用状态')}
        userSettings.main.enableFocusIntegration = ${enabled};
        refreshDockTomatoFocusAPI();
    `);
    return { ...runtime, timer, events, notificationReasons };
}
function setEnabled(runtime, enabled) {
    call(runtime, `userSettings.main.enableFocusIntegration = ${enabled}; refreshDockTomatoFocusAPI();`);
}
const assertCode = (promise, code) => assert.rejects(promise, error => error.code === code);

module.exports = { setup, call, start, setEnabled, completed };

if (require.main === module) (async () => {
    for (const durationMinutes of [undefined, 15, 45, 60, 90]) {
        const r = setup();
        const input = JSON.stringify({ ...JSON.parse(request), durationMinutes });
        const result = await call(r, `__dockTomato.focus.start(${input})`);
        const expectedMinutes = durationMinutes ?? 30;
        assert.equal(result.durationMinutes, expectedMinutes);
        assert.equal(JSON.parse(r.storage.file).nextState.activeTimer.plannedDurationSec, expectedMinutes * 60);
        assert.equal(r.context.currentDuration, expectedMinutes);
        assert.equal(r.context.remainingSeconds, expectedMinutes * 60);
        call(r, 'applyDockTomatoFocusRuntime();');
        assert.equal(r.context.currentDuration, expectedMinutes, 'state refresh must preserve the requested duration');
    }
    {
        const r = setup(false);
        assert.equal(call(r, 'typeof __dockTomato.focus'), 'undefined');
        assert.equal(r.events.at(-1).detail.available, false);
        await r.timer.toggle();
        r.timer.advance(30 * 60000);
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true }), true);
        assert.equal(completed(r).length, 0);
        assert.equal(r.api.journal.queuedHistory()[0].integrationContext, undefined);
        assert.equal(call(r, '__dockTomato.stats.sentinel'), true);
    }
    {
        const r = setup();
        call(r, '__tomatoTimerReady = false; refreshDockTomatoFocusAPI();');
        assert.equal(call(r, '__dockTomato.focus.getStatus().ready'), false);
        await assertCode(start(r), 'DOCK_TOMATO_NOT_READY');
        call(r, '__tomatoTimerReady = true; refreshDockTomatoFocusAPI();');
        await assertCode(call(r, '__dockTomato.focus.start({context:[]})'), 'DOCK_TOMATO_INVALID_CONTEXT');
        await assertCode(call(r, '__dockTomato.focus.start({durationMinutes:0})'), 'DOCK_TOMATO_INVALID_DURATION');
        const result = await start(r);
        const persisted = JSON.parse(r.storage.file).nextState;
        assert.equal(result.sessionId, persisted.activeTimer.focusSessionId);
        assert.equal(result.sessionId, persisted.integrationEnvelope.externalFocusSessionId);
        assert.equal(result.context.itemId, 'read');
        assert.deepEqual(r.notificationReasons, ['external-start']);
        call(r, 'syncState = SyncManager.getState(); applyDockTomatoFocusRuntime();');
        assert.equal(call(r, '__dockTomato.focus.getStatus().context.itemId'), 'read');
        await assertCode(start(r), 'DOCK_TOMATO_TIMER_BUSY');
        r.timer.advance(10 * 60000);
        await call(r, `__dockTomato.focus.pause({sessionId:${JSON.stringify(result.sessionId)}})`);
        assert.equal(r.api.manager.getState().status, 'PAUSED');
        assert.equal(r.context.isTimerPaused, true);
        assert.deepEqual(r.notificationReasons, ['external-start', 'external-pause']);
        r.timer.advance(5 * 60000);
        await r.timer.toggle();
        r.timer.advance(20 * 60000);
        const completedAt = new r.context.Date().toISOString();
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true, endTimeMs: r.context.Date.now() }), true);
        assert.deepEqual(Array.from(r.api.journal.queuedHistory(), entry => entry.durationMin), [10, 20]);
        assert.equal(completed(r).length, 1);
        assert.equal(completed(r)[0].detail.durationMinutes, 30);
        assert.equal(completed(r)[0].detail.completedAt, completedAt);
        assert.equal(completed(r)[0].detail.sessionId, result.sessionId);
        assert.equal(JSON.parse(r.storage.file).nextState.integrationEnvelope.externalFocusSessionId, undefined);
        call(r, 'applyDockTomatoFocusRuntime();');
        assert.equal((await start(r)).active, true, 'a completed session must release the start lock');
    }
    {
        const r = setup();
        await start(r); r.timer.advance(10 * 60000);
        await call(r, '__dockTomato.focus.pause()');
        r.timer.advance(5 * 60000);
        const endedAt = new r.context.Date().toISOString();
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true, plannedDurationOverride: 'elapsed' }), true);
        assert.equal(completed(r).length, 1, 'manual completion while paused must reach the consumer');
        assert.equal(completed(r)[0].detail.durationMinutes, 10);
        assert.equal(completed(r)[0].detail.plannedDurationMinutes, 30);
        assert.equal(completed(r)[0].detail.completedAt, endedAt);
        assert.deepEqual(Array.from(r.api.journal.queuedHistory(), entry => entry.durationMin), [10, 0]);
        assert.equal(r.api.journal.queuedHistory()[1].end, endedAt);
        assert.equal(r.api.manager.getState().status, 'IDLE');
    }
    {
        const r = setup(true, 'stopwatch');
        await r.timer.toggle(); r.timer.advance(3 * 60000);
        const status = call(r, '__dockTomato.focus.getStatus()');
        await call(r, `__dockTomato.focus.pause({sessionId:${JSON.stringify(status.sessionId)}})`);
        assert.equal(r.api.manager.getState().status, 'PAUSED');
        assert.equal(r.api.journal.queuedHistory()[0].durationMin, 3);
        assert.equal(completed(r).length, 0);
    }
    {
        const storage = { file: null, local: new Map(), history: new Map() };
        const firstWindow = setup(true, 'countdown', storage, { device: 'window-a' });
        const secondWindow = setup(true, 'countdown', storage, { device: 'window-b' });
        let tail = Promise.resolve();
        const writer = {
            async assert() {},
            run(action) { const next = tail.then(action); tail = next.catch(() => {}); return next; },
        };
        firstWindow.context.__dockTomatoTimerWriter = writer;
        secondWindow.context.__dockTomatoTimerWriter = writer;
        const results = await Promise.allSettled([start(firstWindow), start(secondWindow)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(firstWindow.events.concat(secondWindow.events).filter(event => event.type === 'tomato:focus-session-started').length, 1);
        const state = JSON.parse(storage.file).nextState;
        assert.equal(state.activeTimer.focusSessionId, state.integrationEnvelope.externalFocusSessionId);
    }
    {
        const r = setup();
        await start(r);
        for (const minutes of [2, 3]) {
            r.timer.advance(minutes * 60000);
            await call(r, '__dockTomato.focus.pause()');
            r.timer.advance(7 * 60000);
            await r.timer.toggle();
        }
        r.timer.advance(25 * 60000);
        await r.context.endRecord(false, false, { isCompleted: true });
        assert.equal(completed(r)[0].detail.durationMinutes, 30);
        assert.deepEqual(Array.from(r.api.journal.queuedHistory(), entry => entry.durationMin), [2, 3, 25]);
    }
    {
        const r = setup();
        const reachedWrite = deferred();
        const gate = deferred();
        r.context.__tomatoEnsureDir = async () => { reachedWrite.resolve(); await gate.promise; return true; };
        const pending = start(r);
        await reachedWrite.promise;
        setEnabled(r, false);
        gate.resolve();
        await assertCode(pending, 'DOCK_TOMATO_INTEGRATION_DISABLED');
        assert.equal(r.storage.file, null, 'disable during directory/writer preparation must prevent the write');
        assert.equal(r.context.isRunning, false);
    }
    {
        const r = setup();
        const originalWriter = r.context.__tomatoPutFileText;
        r.context.__tomatoPutFileText = async () => false;
        await assert.rejects(start(r), /JOURNAL_PERSIST_FAILED/);
        assert.equal(r.context.isRunning, false, 'failed persistence must not start the live timer');
        assert.equal(r.events.some(event => event.type === 'tomato:focus-session-started'), false);
        r.context.__tomatoPutFileText = originalWriter;
        assert.equal((await start(r)).active, true);
    }
    {
        const r = setup();
        const gate = deferred();
        r.context.initAudio = () => gate.promise;
        const localStart = call(r, 'startTimer()');
        await assertCode(start(r), 'DOCK_TOMATO_TIMER_BUSY');
        gate.resolve(); await localStart;
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        assert.equal(r.api.manager.getState().integrationEnvelope.externalFocusSessionId, undefined);
    }
    {
        const r = setup();
        await start(r);
        r.timer.advance(60000);
        r.context.__tomatoPutFileText = async () => false;
        await assert.rejects(call(r, '__dockTomato.focus.pause()'), /JOURNAL_PERSIST_FAILED/);
        assert.equal(r.context.isRunning, true, 'a failed pause must leave the live timer running');
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        assert.equal(r.events.some(event => event.type === 'tomato:focus-session-paused'), false);
    }
    {
        const r = setup();
        await start(r);
        r.timer.advance(30 * 60000);
        const gate = deferred();
        const queueGate = r.api.executor._enqueue(() => gate.promise);
        const first = r.context.endRecord(false, false, { isCompleted: true });
        const duplicate = r.context.endRecord(false, false, { isCompleted: true });
        assert.equal(completed(r).length, 0, 'no completion event before durable commit');
        gate.resolve(); await queueGate;
        await Promise.all([first, duplicate]);
        assert.equal(completed(r).length, 1, 'duplicate finalization must not repeat completion');
        assert.equal(r.api.journal.queuedHistory().length, 1);
    }
    {
        const r = setup();
        await start(r);
        r.timer.advance(30 * 60000);
        const writer = r.context.__tomatoPutFileText;
        r.context.__tomatoPutFileText = async () => false;
        r.context.console = { ...console, error() {} };
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true }), false);
        assert.equal(completed(r).length, 0);
        r.context.__tomatoPutFileText = writer;
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true }), true);
        assert.equal(completed(r).length, 1);
    }
    {
        const r = setup();
        await start(r); r.timer.advance(60000);
        assert.equal(await r.context.endRecord(true, false), true);
        assert.equal(completed(r).length, 0, 'abandon/reset is not a completed focus session');
        assert.equal(r.api.manager.getState().integrationEnvelope.externalFocusSessionId, undefined);
    }
    {
        const r = setup();
        await start(r);
        const facade = call(r, '__dockTomato.focus');
        call(r, '__tomatoDestroyed = true; refreshDockTomatoFocusAPI();');
        assert.equal(r.events.at(-1).detail.available, false);
        assert.equal(call(r, 'typeof __dockTomato.focus'), 'undefined');
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        await assertCode(facade.pause(), 'DOCK_TOMATO_INTEGRATION_DISABLED');
    }
    {
        const r = setup();
        const gate = deferred();
        r.context.initAudio = () => gate.promise;
        const first = start(r);
        await assertCode(start(r), 'DOCK_TOMATO_TIMER_BUSY');
        await call(r, 'startTimer()');
        assert.equal(r.api.manager.getState().status, 'IDLE', 'local start must not mutate a pending external start');
        gate.resolve();
        assert.equal((await first).active, true);
        assert.equal(r.events.filter(event => event.type === 'tomato:focus-session-started').length, 1);
    }
    {
        const r = setup();
        const gate = deferred();
        r.context.initAudio = () => gate.promise;
        const pending = start(r);
        const oldFacade = call(r, '__dockTomato.focus');
        setEnabled(r, false);
        setEnabled(r, true);
        gate.resolve();
        await assertCode(pending, 'DOCK_TOMATO_INTEGRATION_DISABLED');
        assert.throws(() => oldFacade.getStatus(), error => error.code === 'DOCK_TOMATO_INTEGRATION_DISABLED');
        assert.equal(r.api.manager.getState().status, 'IDLE');
        assert.equal((await start(r)).active, true);
        setEnabled(r, false);
        assert.equal(r.context.isRunning, true, 'disabling integration must leave the timer running');
        r.timer.advance(30 * 60000);
        assert.equal(await r.context.endRecord(false, false, { isCompleted: true }), true);
        assert.equal(completed(r).length, 0);
        assert.equal(r.api.journal.queuedHistory()[0].integrationContext, undefined);
    }
    {
        const r = setup();
        await start(r);
        await assertCode(call(r, '__dockTomato.focus.pause({sessionId:"wrong"})'), 'DOCK_TOMATO_SESSION_MISMATCH');
        await assertCode(call(r, '__dockTomato.focus.pause({sessionId:""})'), 'DOCK_TOMATO_SESSION_MISMATCH');
        assert.equal(r.context.isRunning, true);
        const state = r.api.manager.getState();
        state.activeTimer.phase = 'break'; state.activeTimer.mode = 'break'; state.mode = 'break';
        r.api.manager.localState = state;
        call(r, 'applyDockTomatoFocusRuntime();');
        await assertCode(call(r, `__dockTomato.focus.pause({sessionId:${JSON.stringify(state.activeTimer.focusSessionId)}})`), 'DOCK_TOMATO_SESSION_MISMATCH');
        assert.equal(r.context.isRunning, true);
    }
    {
        const r = setup();
        const result = await start(r);
        r.timer.advance(60000);
        const gate = deferred();
        const queueGate = r.api.executor._enqueue(() => gate.promise);
        const pending = call(r, `__dockTomato.focus.pause({sessionId:${JSON.stringify(result.sessionId)}})`);
        const next = r.api.machine.createFocusState({ focusSessionId: 'new-session', plannedDurationSec: 1800 }, r.api.manager.getState());
        r.api.manager.localState = next;
        call(r, 'applyDockTomatoFocusRuntime();');
        gate.resolve(); await queueGate;
        await assertCode(pending, 'DOCK_TOMATO_SESSION_MISMATCH');
        assert.equal(r.api.manager.getState().activeTimer.focusSessionId, 'new-session');
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        assert.equal(r.context.isRunning, true);
        assert.equal(r.api.journal.queuedHistory().length, 0);
    }
    {
        const r = setup();
        await start(r); r.timer.advance(60000);
        const gate = deferred();
        const queueGate = r.api.executor._enqueue(() => gate.promise);
        const pending = call(r, '__dockTomato.focus.pause()');
        setEnabled(r, false); gate.resolve(); await queueGate;
        await assertCode(pending, 'DOCK_TOMATO_INTEGRATION_DISABLED');
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        assert.equal(r.context.isRunning, true);
    }
    console.log('external focus API runtime tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
