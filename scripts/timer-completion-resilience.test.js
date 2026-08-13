'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${startMarker.trim()} must remain extractable`);
    return source.slice(start, end);
}

const finishBlock = extract(
    '    async function handleTimerEndFromSyncOrLocal(',
    '    function runTimerTickSafely()'
);
const pauseBlock = extract(
    '    async function pauseTimer()',
    '    async function stopTimer('
);
const stopBlock = extract(
    '    async function stopTimer(',
    '    // 🔧 修复：为正计时添加变量'
);

async function testCompletionSurvivesDisplayFailure() {
    const state = { endDialogCalls: 0, soundCalls: 0, stopCalls: 0, toastCalls: 0, recordOptions: null };
    const context = vm.createContext({
        Date,
        Math,
        Promise,
        Number,
        String,
        CONFIG: { MAX_STOPWATCH_SECONDS: 24 * 3600 },
        Logger: { info: () => {}, warn: () => {}, error: () => {} },
        timerMode: 'countdown',
        syncState: { startTime: 1_000, endDialog: null },
        startTime: 1_000,
        currentDuration: 1,
        currentTaskBlockId: null,
        currentTaskBlockName: null,
        pendingBreakSessionId: null,
        currentSessionId: null,
        timerId: 1,
        isRunning: true,
        isTimerPaused: false,
        elapsedSeconds: 0,
        remainingSeconds: 1,
        controlButton: { innerHTML: '' },
        progressBar: null,
        userSettings: { appearance: {} },
        clearInterval: () => {},
        setTimeout,
        recordEndTime: (_reset, _stopwatch, options) => {
            state.recordOptions = options;
            return Promise.resolve(true);
        },
        updateDisplay: () => { throw new Error('display unavailable'); },
        ensureSyncEndDialogOpen: (type, startAtMs, durationSec) => {
            state.endDialogCalls++;
            return { type, startAtMs, durationSec };
        },
        stopTimer: async () => { state.stopCalls++; },
        playEndSound: async () => { state.soundCalls++; },
        showToastDialog: () => { state.toastCalls++; },
        showMiniToast: () => {},
        waitForTimerPersistence: async (promise) => promise,
        withTimerFinalizationLock: async (_name, action) => {
            await action();
            return true;
        },
    });
    vm.runInContext(`${finishBlock}\nthis.finish = handleTimerEndFromSyncOrLocal;`, context);

    await context.finish({ endTimeMs: 61_000, source: 'test' });

    assert.equal(state.stopCalls, 1, 'display failure must not prevent stopTimer');
    assert.equal(state.endDialogCalls, 1, 'countdown completion must still create its synchronized end dialog');
    assert.equal(state.soundCalls, 1, 'countdown completion must still play completion audio');
    assert.equal(state.toastCalls, 1, 'completion feedback must still be attempted');
    assert.equal(state.recordOptions.skipSyncUpdate, true, 'history persistence must not write an obsolete RUNNING state');
}

async function testStopwatchCompletionIsSilent(timerMode) {
    const state = {
        animationCalls: 0,
        dialogCalls: 0,
        endDialogCalls: 0,
        recordCalls: 0,
        soundCalls: 0,
        stopCalls: 0,
        toastCalls: 0,
    };
    const context = vm.createContext({
        Date,
        Math,
        Promise,
        Number,
        String,
        CONFIG: { MAX_STOPWATCH_SECONDS: 24 * 3600 },
        Logger: { info: () => {}, warn: () => {}, error: () => {} },
        timerMode,
        syncState: { startTime: 1_000, endDialog: null },
        startTime: 1_000,
        currentDuration: 1,
        currentTaskBlockId: null,
        currentTaskBlockName: null,
        pendingBreakSessionId: null,
        currentSessionId: null,
        timerId: 1,
        isRunning: true,
        isTimerPaused: false,
        elapsedSeconds: 0,
        remainingSeconds: 1,
        controlButton: { innerHTML: '' },
        progressBar: {
            style: { width: '100%', setProperty: () => { state.animationCalls++; } },
            classList: { add: () => { state.animationCalls++; }, remove: () => { state.animationCalls++; } },
        },
        userSettings: { appearance: { enableNeonEffect: true, theme: 'neon' } },
        clearInterval: () => {},
        setTimeout,
        recordEndTime: () => {
            state.recordCalls++;
            return Promise.resolve(true);
        },
        updateDisplay: () => {},
        ensureSyncEndDialogOpen: () => { state.endDialogCalls++; return {}; },
        stopTimer: async () => { state.stopCalls++; },
        playEndSound: async () => { state.soundCalls++; },
        showToastDialog: () => { state.dialogCalls++; },
        showMiniToast: () => { state.toastCalls++; },
        waitForTimerPersistence: async (promise) => promise,
        withTimerFinalizationLock: async (_name, action) => {
            await action();
            return true;
        },
    });
    vm.runInContext(`${finishBlock}\nthis.finish = handleTimerEndFromSyncOrLocal;`, context);

    await context.finish({ endTimeMs: 24 * 3600 * 1000 + 1_000, source: `test-${timerMode}` });

    assert.equal(state.recordCalls, 1, `${timerMode} cap must save exactly one record`);
    assert.equal(state.stopCalls, 1, `${timerMode} cap must still stop the timer`);
    assert.equal(context.elapsedSeconds, 24 * 3600, `${timerMode} cap must preserve the full 24-hour duration`);
    assert.equal(state.endDialogCalls, 0, `${timerMode} cap must not create an end dialog`);
    assert.equal(state.animationCalls, 0, `${timerMode} cap must not run completion animation`);
    assert.equal(state.soundCalls, 0, `${timerMode} cap must not play completion audio`);
    assert.equal(state.dialogCalls, 0, `${timerMode} cap must not show a completion dialog or system notification`);
    assert.equal(state.toastCalls, 0, `${timerMode} cap must not show fallback feedback`);
}

async function testStopSurvivesCleanupFailure() {
    const context = vm.createContext({
        Promise,
        timerMode: 'countdown',
        timerId: 1,
        isRunning: true,
        isTimerPaused: false,
        startTime: 1_000,
        lastTickTime: 1_000,
        reminderIntervalId: 2,
        currentStartTimestamp: 'start',
        currentStartTimeMs: 1_000,
        stopwatchStartTimestamp: null,
        stopwatchStartTimeMs: 0,
        stopwatchSegmentStartTimestamp: null,
        stopwatchSegmentStartTimeMs: 0,
        stopwatchSegmentBaseElapsedSeconds: 0,
        segmentTaskBlockId: 'task',
        segmentTaskBlockName: 'Task',
        segmentDatabaseBlockId: null,
        currentPauseStart: 1_500,
        syncState: {
            status: 'RUNNING',
            startTime: 1_000,
            stopwatchStartTimeMs: null,
            pausedIntervals: [],
        },
        window: {},
        document: { getElementById: () => null },
        Logger: { info: () => {}, debug: () => {} },
        clearInterval: () => {},
        stopBackgroundAudio: () => { throw new Error('background cleanup failed'); },
        stopHighlightKeepAlive: () => { throw new Error('highlight cleanup failed'); },
        recordEndTime: () => Promise.resolve(true),
        stopAllAudio: () => { throw new Error('audio cleanup failed'); },
        hideProgressBar: () => { throw new Error('progress cleanup failed'); },
        clearRoutineButtonRunningHighlight: () => { throw new Error('routine cleanup failed'); },
        endTimerFocus: () => { throw new Error('focus cleanup failed'); },
        cancelTrackedTimerNotification: async () => { throw new Error('notification cleanup failed'); },
        isSyncEnabled: () => false,
        waitForTimerPersistence: () => {},
    });
    vm.runInContext(`${stopBlock}\nthis.stop = stopTimer;`, context);

    await context.stop({ skipEndRecord: true });

    assert.equal(context.isRunning, false);
    assert.equal(context.isTimerPaused, false);
    assert.equal(context.timerId, null);
    assert.equal(context.startTime, 0);
    assert.equal(context.syncState.status, 'IDLE', 'cleanup failures must not prevent the IDLE transition');
    assert.equal(context.syncState.startTime, null);
}

function createPauseContext(startTime, now, finalizeResult = true) {
    let finalizeCalls = 0;
    const context = vm.createContext({
        Date: { now: () => now },
        Math,
        Array,
        Promise,
        timerMode: 'countdown',
        isRunning: true,
        isTimerPaused: false,
        currentDuration: 1,
        startTime,
        remainingSeconds: 1,
        pausedRemainingSeconds: null,
        elapsedSeconds: 0,
        stopwatchStartTimeMs: 0,
        timerId: 1,
        currentPauseStart: null,
        syncState: { status: 'RUNNING', startTime, pausedIntervals: [] },
        StateCalculator: { calculateTotalPausedTime: () => 0 },
        finalizeExpiredTimerIfNeeded: async () => {
            finalizeCalls++;
            return finalizeResult;
        },
        recordEndTime: () => Promise.resolve(true),
        clearInterval: () => {},
        pauseBackgroundAudio: () => {},
        activeRoutineButtonIndex: null,
        userSettings: { routineButtons: [], timeline: { enabled: false } },
        routineButtonHighlightColor: null,
        window: {},
        document: { getElementById: () => null },
        controlButton: { innerHTML: '' },
        updateDisplay: () => {},
        updateProgressBar: () => {},
        cancelTrackedTimerNotification: async () => {},
        isSyncEnabled: () => false,
        currentDistractionCount: 0,
        Logger: { info: () => {} },
        waitForTimerPersistence: async (promise) => promise,
    });
    vm.runInContext(`${pauseBlock}\nthis.pause = pauseTimer;`, context);
    return { context, getFinalizeCalls: () => finalizeCalls };
}

async function testLastSecondPauseBoundary() {
    const now = 1_000_000;
    const beforeExpiry = createPauseContext(now - 59_800, now);
    await beforeExpiry.context.pause();
    assert.equal(beforeExpiry.context.remainingSeconds, 1, 'a positive sub-second remainder must round up');
    assert.equal(beforeExpiry.context.syncState.status, 'PAUSED');
    assert.equal(beforeExpiry.getFinalizeCalls(), 0);

    const expired = createPauseContext(now - 60_000, now);
    await expired.context.pause();
    assert.equal(expired.getFinalizeCalls(), 1, 'an expired timer must finalize instead of pausing at zero');
    assert.equal(expired.context.isTimerPaused, false);
    assert.equal(expired.context.syncState.status, 'RUNNING', 'pause state must not be written after expiry finalization starts');
}

assert.match(source, /function runTimerTickSafely\(\)[\s\S]*handleTimerTick\(\)\.catch/, 'timer tick rejections must be handled');

(async () => {
    await testCompletionSurvivesDisplayFailure();
    await testStopwatchCompletionIsSilent('stopwatch');
    await testStopwatchCompletionIsSilent('stopwatch-break');
    await testStopSurvivesCleanupFailure();
    await testLastSecondPauseBoundary();
    console.log('timer completion resilience tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
