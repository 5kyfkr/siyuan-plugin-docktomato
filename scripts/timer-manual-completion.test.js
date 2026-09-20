'use strict';

const assert = require('node:assert/strict');
const { setup, call, start, completed } = require('./external-focus-api.test');
const { extract, deferred } = require('./timer-journal-queue.test');

function attachManualCompletion(runtime) {
    const ended = [];
    Object.assign(runtime.context, {
        isTimerFinalizing: false,
        stopBackgroundAudio() {}, clearRoutineButtonRunningHighlight() {},
        stopHighlightKeepAlive() {}, clearTaskBlockHighlight() {},
        hideProgressBar() {}, showToast() {},
    });
    call(runtime, `
        ${extract('    async function withTimerFinalizationLock(', '    function waitForTimerPersistence(')}
        ${extract('    async function commitTimerState(', '    // ✅ 修复版本：更新任务块')}
        ${extract('    async function resetCurrentMode(', '    function isCurrentTaskAssociation(')}
        ${extract('    function endTimerFocus(', '    function getActiveTimerFocusSnapshot(')}
    `);
    const dispatch = runtime.context.window.dispatchEvent;
    runtime.context.window.dispatchEvent = event => {
        if (event.type === 'tomato:focus-ended') ended.push(runtime.api.manager.getState().status);
        dispatch(event);
    };
    return ended;
}

function attachLongPress(runtime, surface) {
    const handlers = new Map();
    let longPress;
    const nativeTimeout = runtime.context.setTimeout;
    Object.assign(runtime.context, {
        container: {},
        timelineBar: { addEventListener: (event, handler) => handlers.set(event, handler) },
        EventManager: { add: (_node, event, handler) => handlers.set(event, handler) },
        showContextMenu() {},
        setTimeout: (callback, ms) => {
            if (ms === 500) { longPress = callback; return 0; }
            return nativeTimeout(callback, ms);
        },
    });
    const source = surface === 'status-bar'
        ? extract('        let isRightClick = false, longPressTimer = null;', '        container.appendChild(timeDisplay);')
        : extract('        let isRightClick = false;', '        let touchLongPressTimer = null;');
    call(runtime, `{ ${source} }`);
    return async () => {
        handlers.get('mousedown')({ button: 2 });
        assert.equal(typeof longPress, 'function');
        longPress();
        for (let attempt = 0; runtime.context.isTimerFinalizing && attempt < 20; attempt++) {
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.equal(runtime.context.isTimerFinalizing, false);
    };
}

module.exports = { attachManualCompletion, attachLongPress };

if (require.main === module) (async () => {
    for (const surface of ['status-bar', 'timeline']) {
        for (const paused of [false, true]) {
            const r = setup();
            const ended = attachManualCompletion(r);
            const hold = attachLongPress(r, surface);
            const first = await start(r);
            r.timer.advance(10 * 60000);
            if (paused) {
                await call(r, '__dockTomato.focus.pause()');
                r.timer.advance(5 * 60000);
            }
            await hold();
            assert.equal(r.api.manager.getState().status, 'IDLE');
            assert.equal(r.context.isRunning, false);
            assert.equal(r.context.isTimerPaused, false);
            assert.equal(completed(r).length, 1);
            assert.equal(completed(r)[0].detail.durationMinutes, 10);
            assert.ok(r.api.journal.queuedHistory().every(record => record.wasReset === false));
            assert.deepEqual(ended, ['IDLE'], 'focus-ended listeners must observe the committed idle state');
            assert.notEqual((await start(r)).sessionId, first.sessionId);
        }
    }
    {
        const r = setup(false, 'stopwatch');
        const ended = attachManualCompletion(r);
        await r.timer.toggle(); r.timer.advance(3 * 60000);
        await call(r, 'completeCurrentTimer()');
        const record = r.api.journal.queuedHistory()[0];
        assert.equal(record.durationMin, 3);
        assert.equal(record.wasReset, false);
        assert.equal(record.isCompleted, true);
        assert.equal(r.context.elapsedSeconds, 0);
        assert.equal(r.api.manager.getState().status, 'IDLE');
        assert.deepEqual(ended, ['IDLE']);
    }
    {
        const r = setup();
        const ended = attachManualCompletion(r);
        await start(r); r.timer.advance(60000);
        const gate = deferred();
        const queued = r.api.executor._enqueue(() => gate.promise);
        const completion = call(r, 'completeCurrentTimer()');
        assert.equal(ended.length, 0);
        await assert.rejects(start(r), error => error.code === 'DOCK_TOMATO_TIMER_BUSY');
        gate.resolve(); await queued; await completion;
        assert.deepEqual(ended, ['IDLE']);
        assert.equal((await start(r)).active, true);
    }
    {
        const r = setup();
        const ended = attachManualCompletion(r);
        await start(r); r.timer.advance(60000);
        r.context.console = { ...console, error() {} };
        r.context.__tomatoPutFileText = async () => false;
        await assert.rejects(call(r, 'completeCurrentTimer()'), /history was not persisted/);
        assert.equal(ended.length, 0, 'failed completion must not release consumer ownership');
        assert.equal(completed(r).length, 0);
    }
    console.log('manual completion tests passed: right hold on both surfaces, paused focus, stopwatch, committed end notification, restart and failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
