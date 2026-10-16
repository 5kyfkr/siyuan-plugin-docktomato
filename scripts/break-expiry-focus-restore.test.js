'use strict';

const assert = require('node:assert/strict');
const { setup, call } = require('./external-focus-api.test');
const { extract, deferred } = require('./timer-journal-queue.test');
const clone = value => JSON.parse(JSON.stringify(value));

function setupBreakFlow(mode = 'countdown', storage, options) {
    const runtime = setup(false, mode, storage, options);
    const nodes = [];
    const handlers = new Map();
    const feedback = [];
    const animations = [];
    runtime.context.Logger.warn = (...args) => feedback.push(args.map(String).join(' '));
    const createNode = tag => ({
        tag, children: [], style: {}, textContent: '', dataset: {},
        classList: { toggle() {}, add() {}, remove() {} },
        appendChild(node) {
            if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
            this.children.push(node); node.parentNode = this; nodes.push(node);
        },
        append(...children) { children.forEach(node => this.appendChild(node)); },
        replaceChildren(...children) {
            this.children.forEach(node => { node.parentNode = null; });
            this.children = []; this.append(...children);
        },
        querySelectorAll(tag) {
            const descendants = this.children.flatMap(node => [node, ...(node.querySelectorAll?.('*') || [])]);
            return tag === '*' ? descendants : descendants.filter(node => node.tag === tag);
        },
        remove() {
            this.removed = true;
            if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        },
        focus() {},
        setAttribute(name, value) { this[name] = value; },
    });
    Object.assign(runtime.context, {
        isTimerFinalizing: false, activeEndDialog: null, activeEndDialogClose: null,
        DEVICE_NOTIFICATION_CHANNEL: 'test',
        pendingFocusCountdownDuration: null, lastTomatoConfig: { mode, duration: 30 },
        document: {
            hidden: true,
            body: createNode('body'),
            head: createNode('head'),
            createElement: createNode,
            createTextNode: text => ({ tag: '#text', textContent: text }),
            getElementById: id => nodes.find(node => node.id === id && !node.removed) || null,
        },
        EventManager: {
            add: (_node, event, handler) => handlers.set(event, handler),
            removeByContext: () => handlers.clear(),
        },
        setInterval: () => 1,
        stopBackgroundAudio() {}, stopHighlightKeepAlive() {}, stopAllAudio() {},
        hideProgressBar() {}, clearRoutineButtonRunningHighlight() {}, endTimerFocus() {},
        ensureTomatoDialogActionStyles() {}, showSystemNotification() {},
        getCurrentFocusRestoreOptions: () => ({}), getTomatoDurations: () => [25],
        formatTime: seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
        showMiniToast: message => feedback.push(message), playEndSound: async () => {},
        progressBar: {
            style: { width: '50%', setProperty() {} },
            classList: { add: value => animations.push(value), remove() {} },
        },
    });
    runtime.context.userSettings.appearance = { enableNeonEffect: true, theme: 'neon' };
    call(runtime, `
        ${extract('    // Inline timer icons.', '    function __createMonthRepeatCore()')}
        ${extract('    function buildEndDialogId(', '    // 🔧 性能优化：存储 MutationObserver')}
        ${extract('    async function withTimerFinalizationLock(', '    function waitForTimerPersistence(')}
        ${extract('    function getExpiredTimerSnapshot(', '    let lastKnownHistoryMaxEndMinute')}
        ${extract('    async function finalizeExpiredTimerIfNeeded(', '    function runTimerTickSafely()')}
        ${extract('    function finalizeCurrentSegmentBeforeTransition()', '    async function switchToCountdownAndStart(')}
        ${extract('    async function startBreakMode(', '    async function startStopwatchBreakMode(')}
        ${extract('    async function startStopwatchBreakMode(', '    async function setActiveCountdownDuration(')}
        ${extract('    async function finishBreakFromContinuation()', '    async function abandonCurrentTomato(')}
        ${extract('    function showToastDialog(', '    function removeProgressBarEffects()')}
        this.expire = source => finalizeExpiredTimerIfNeeded(source || 'test', SyncManager.getState());
        this.finishBreak = finishBreakFromContinuation;
    `);
    return { ...runtime, nodes, handlers, feedback, animations };
}

async function startFocus(runtime) {
    runtime.context.currentTaskBlockId = 'task-a';
    runtime.context.currentTaskBlockName = '原任务';
    runtime.context.currentDatabaseBlockId = 'database-a';
    await call(runtime, 'startTimer({confirm:false})');
    runtime.timer.advance(10 * 60000);
    return clone(runtime.api.manager.getState().activeTimer);
}

const currentButtons = runtime => {
    const dialog = runtime.nodes.findLast(node => node.id === 'tomy-tomato-toast' && !node.removed);
    assert.ok(dialog, `break end dialog must render: ${runtime.feedback.join('; ')}`);
    return dialog.querySelectorAll('button');
};
const assertPausedFocus = (runtime, original, mode) => {
    const state = runtime.api.manager.getState();
    assert.equal(state.status, 'PAUSED');
    assert.equal(state.activeTimer.phase, 'focus');
    assert.equal(state.activeTimer.timerMode, mode);
    assert.equal(state.activeTimer.sessionId, original.sessionId);
    assert.equal(state.activeTimer.focusSessionId, original.focusSessionId);
    assert.equal(state.activeTimer.accumulatedMs, 10 * 60000);
    assert.equal(state.activeTimer.segmentStartMs, null);
    assert.equal(state.openRecordId, null);
    assert.equal(state.continuation, null);
    assert.equal(state.integrationEnvelope.taskAssociation.taskBlockId, 'task-a');
    assert.equal(runtime.context.currentTaskBlockName, '原任务');
    assert.equal(runtime.context.isRunning, false);
    assert.equal(runtime.context.isTimerPaused, true);
    assert.equal(mode === 'countdown' ? runtime.context.remainingSeconds : runtime.context.elapsedSeconds, mode === 'countdown' ? 1200 : 600);
    assert.equal(JSON.parse(runtime.storage.file).nextState.activeTimer.sessionId, original.sessionId);
};

async function testNaturalExpiry(mode, sync, dismissAction) {
    const r = setupBreakFlow(mode, undefined, { sync });
    const original = await startFocus(r);
    await call(r, 'startBreakMode(5, {confirm:false})');
    assert.equal(r.api.manager.getState().mode, 'break');
    r.timer.advance(7 * 60000); // Delayed wake must still end the break at its due time.
    assert.deepEqual(await Promise.all([r.context.expire('resume-test'), r.context.expire('duplicate-tick')]), [true, false]);
    assertPausedFocus(r, original, mode);
    assert.deepEqual(Array.from(r.api.journal.queuedHistory(), record => [record.mode, record.durationMin]), [[mode, 10], ['break', 5]]);
    assert.deepEqual(r.animations, [], 'restored focus must not receive a completion animation');
    const buttons = currentButtons(r);
    assert.ok(buttons.some(button => button.dataset.action === 'continue-focus'));
    assert.equal(buttons.filter(button => button.dataset.action === 'continue-focus').length, 1, 'restored progress must expose one continuation action');
    assert.ok(buttons.every(button => !button.dataset.duration), 'restored progress must not expose fresh-duration presets');
    const beforeDismiss = clone(r.api.manager.getState().activeTimer);
    if (dismissAction === 'escape') {
        r.handlers.get('keydown')({ key: 'Escape' });
        await r.api.executor._tail;
        await new Promise(resolve => setImmediate(resolve));
    } else if (dismissAction === 'backdrop') {
        const backdrop = r.nodes.findLast(node => node.id === 'tomy-tomato-backdrop');
        backdrop.onclick({ target: backdrop });
        await r.api.executor._tail;
        await new Promise(resolve => setImmediate(resolve));
    } else {
        await buttons.find(button => button.textContent === '我知道了').onclick();
    }
    assert.deepEqual(clone(r.api.manager.getState().activeTimer), beforeDismiss, 'dismissing must not reset progress or start a timer');
    assert.equal(await r.context.expire('repeat-sync'), false, 'repeated expiry must not finalize the restored focus');
    r.timer.advance(3 * 60000);
    assertPausedFocus(r, original, mode);
    await call(r, 'startTimer({confirm:false})');
    r.timer.advance(2 * 60000);
    await call(r, 'pauseTimer()');
    assert.equal(r.api.manager.getState().activeTimer.accumulatedMs, 12 * 60000);
    assert.deepEqual(Array.from(r.api.journal.queuedHistory(), record => record.durationMin), [10, 5, 2], 'rest and time waiting to continue must not enter focus history');
}

async function testContinueButton() {
    const r = setupBreakFlow();
    const original = await startFocus(r);
    await call(r, 'startBreakMode(5, {confirm:false})');
    r.timer.advance(5 * 60000);
    await r.context.expire();
    r.timer.advance(3 * 60000);
    await currentButtons(r).find(button => button.dataset.action === 'continue-focus').onclick();
    assert.equal(r.api.manager.getState().status, 'RUNNING');
    assert.equal(r.api.manager.getState().activeTimer.sessionId, original.sessionId);
    assert.equal(r.api.manager.getState().activeTimer.accumulatedMs, 10 * 60000);
    assert.equal(r.api.journal.queuedHistory().length, 2, 'continue must not create a second break record');
    assert.equal(r.nodes.filter(node => node.id === 'tomy-tomato-toast' && !node.removed).length, 0);
}

async function testReloadDuringBreak() {
    const first = setupBreakFlow();
    const original = await startFocus(first);
    await call(first, 'startBreakMode(5, {confirm:false})');
    const reloaded = setupBreakFlow('countdown', first.storage);
    await reloaded.api.executor.recoverJournal({ deferNetwork: true });
    call(reloaded, 'syncState = SyncManager.getState(); applyAcceptedSyncStateToTimer(syncState);');
    assert.equal(reloaded.context.preBreakState, null, 'reload must rely on the durable snapshot');
    reloaded.timer.advance(first.context.Date.now() - reloaded.context.Date.now() + 7 * 60000);
    await reloaded.context.expire('sync-init-expired');
    assertPausedFocus(reloaded, original, 'countdown');
    assert.equal(reloaded.api.journal.queuedHistory().length, 2);
}

async function testStandaloneBreak() {
    const r = setupBreakFlow();
    await call(r, 'startBreakMode(5, {confirm:false})');
    r.timer.advance(5 * 60000);
    await r.context.expire();
    assert.equal(r.api.manager.getState().status, 'IDLE');
    assert.equal(r.api.manager.getState().activeTimer, null);
    assert.equal(currentButtons(r).some(button => button.dataset.action === 'continue-focus'), false);
}

async function testRestoreFailureAndRace() {
    const r = setupBreakFlow();
    await startFocus(r);
    await call(r, 'startBreakMode(5, {confirm:false})');
    r.timer.advance(5 * 60000);
    const execute = r.api.executor.execute.bind(r.api.executor);
    r.api.executor.execute = async (command, builder) => command.transitionId.startsWith('finish-break')
        ? { ok: false, blocked: true, state: r.api.manager.getState() }
        : execute(command, builder);
    await r.context.expire();
    assert.equal(r.api.manager.getState().status, 'IDLE');
    assert.ok(r.api.manager.getState().continuation.focusTimerSnapshot);
    assert.equal(r.context.isTimerPaused, false, 'blocked restore must not claim success');
    assert.ok(r.feedback.some(message => message.includes('重试恢复专注')));
    r.api.executor.execute = execute;
    assert.equal(await r.context.finishBreak(), true, 'saved continuation must remain retryable');

    for (const phase of ['focus', 'break']) {
        const raced = setupBreakFlow();
        const original = await startFocus(raced);
        await call(raced, 'startBreakMode(5, {confirm:false})');
        await call(raced, 'stopTimer({skipEndRecord:true})');
        const gate = deferred();
        const queued = raced.api.executor._enqueue(() => gate.promise);
        const replacement = raced.api.executor.execute({ transitionId: 'replacement', deferNetwork: true }, state => ({
            ...raced.api.machine.createFocusState({ phase, timerMode: 'countdown', plannedDurationSec: 1500,
                focusSessionId: phase === 'break' ? original.focusSessionId : 'replacement-focus' }, state),
            continuation: phase === 'break' ? state.continuation : null,
        }));
        const restore = raced.context.finishBreak();
        gate.resolve();
        await queued;
        await replacement;
        assert.equal(await restore, false);
        assert.equal(raced.api.manager.getState().activeTimer.phase, phase, 'queued restore must not overwrite a newer timer');
        assert.equal(raced.api.manager.getState().status, 'RUNNING');
    }
}

(async () => {
    for (const mode of ['countdown', 'stopwatch']) {
        for (const sync of [true, false]) {
            await testNaturalExpiry(mode, sync, 'button');
        }
    }
    await testNaturalExpiry('countdown', true, 'escape');
    await testNaturalExpiry('stopwatch', true, 'backdrop');
    await testContinueButton();
    await testReloadDuringBreak();
    await testStandaloneBreak();
    await testRestoreFailureAndRace();
    console.log('break expiry focus restore tests passed');
})().catch(error => {
    process.nextTick(() => { throw error; });
});
