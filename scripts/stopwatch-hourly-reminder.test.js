'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${startMarker.trim()} must remain extractable`);
    return source.slice(start, end);
}

const flagBlock = extract(
    '    const isStopwatchHourlyReminderEnabled = () => {',
    '\n    const isSyncEnabled = () => {'
);
const reminderBlock = extract(
    "    let stopwatchHourlyReminderSessionKey = '';",
    '    function getDistractionToastText('
);
const tickBlock = extract(
    '    async function handleTimerTick()',
    '    function assertTimerReady()'
);

assert.match(source, /stopwatchHourlyReminderEnabled: false/, 'the hourly reminder must default to off');
assert.match(
    source,
    /userSettings\.main\.stopwatchHourlyReminderEnabled = userSettings\.main\.stopwatchHourlyReminderEnabled === true/,
    'the hourly reminder flag must normalize to a boolean'
);
assert.match(
    source,
    /notifyStopwatchHourlyProgress\(newElapsedSeconds, syncState\);/,
    'the stopwatch tick must evaluate the hourly reminder'
);
assert.match(source, /mkToggleRow\('正计时每小时提醒'/, 'the settings UI must expose a single hourly reminder toggle');
assert.match(reminderBlock, /timerMode !== 'stopwatch'/, 'only focus stopwatch sessions may remind');
assert.match(reminderBlock, /isTimerPaused/, 'paused timers must not remind');
assert.match(reminderBlock, /isMobileDevice\(\)/, 'the reminder must stay desktop only');
assert.match(reminderBlock, /showMiniToast\(body, STOPWATCH_HOURLY_TOAST_DURATION_MS\)/, 'the in-app hint must use the longer non-blocking toast');
assert.match(reminderBlock, /timeoutType: 'default'/, 'the desktop notification must auto dismiss');
assert.doesNotMatch(reminderBlock, /requireInteraction: true/, 'the desktop notification must not require confirmation');
assert.match(
    indexSource,
    /timeoutType: String\(options\?\.timeoutType \|\| "never"\)/,
    'the desktop notification bridge must forward the requested timeout type'
);

function createHarness(options = {}) {
    const storage = options.storage instanceof Map ? options.storage : new Map(options.storage || []);
    const sent = [];
    const toasts = [];
    const toastDurations = [];
    const scheduled = [];
    const platformAvailable = options.platformAvailable !== false;
    const notificationResults = Array.isArray(options.notificationResults)
        ? options.notificationResults.slice()
        : [];
    const syncState = {
        status: options.status || 'RUNNING',
        activeTimer: {
            sessionId: options.sessionId === undefined ? 'session-a' : options.sessionId,
            startedAtMs: options.startedAtMs === undefined ? 1_000 : options.startedAtMs,
            timerMode: 'stopwatch',
            status: options.status || 'RUNNING',
        },
    };
    const context = vm.createContext({
        JSON,
        Math,
        Number,
        Promise,
        String,
        STOPWATCH_HOURLY_REMINDER_STORAGE_KEY: 'tomato-stopwatch-hourly-reminder-v1',
        STOPWATCH_HOURLY_TOAST_DURATION_MS: 3000,
        STOPWATCH_HOURLY_NOTIFICATION_RETRY_DELAY_MS: 15000,
        DEVICE_NOTIFICATION_CHANNEL: 'tomato-timer',
        localStorage: {
            getItem: (key) => (storage.has(key) ? storage.get(key) : null),
            setItem: (key, value) => storage.set(key, String(value)),
        },
        document: { hidden: options.hidden === true },
        userSettings: { main: { stopwatchHourlyReminderEnabled: options.enabled !== false } },
        timerMode: options.timerMode || 'stopwatch',
        isRunning: options.isRunning !== false,
        isTimerPaused: options.isTimerPaused === true,
        __tomatoDestroyed: options.destroyed === true,
        currentSessionId: null,
        stopwatchStartTimeMs: 0,
        isMobileDevice: () => options.mobile === true,
        showMiniToast: (text, durationMs) => {
            toasts.push(String(text));
            toastDurations.push(Number(durationMs));
        },
        __tomatoTrackTimeout: (callback, delayMs) => {
            scheduled.push({ callback, delayMs });
            return scheduled.length;
        },
        getPlatformUtilsCompat: () => platformAvailable ? {
            sendNotification: (payload) => {
                sent.push({ title: payload.title, body: payload.body, opts: payload, via: 'platform' });
                const result = notificationResults.length ? notificationResults.shift() : 1;
                return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
            },
        } : null,
        sendDeviceNotificationCompat: (title, body, opts) => {
            sent.push({ title, body, opts, via: 'compat' });
            const result = notificationResults.length ? notificationResults.shift() : 1;
            return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        },
        syncState,
    });
    context.globalThis = context;
    vm.runInContext(`${flagBlock}\n${reminderBlock}\nthis.notify = notifyStopwatchHourlyProgress;`, context);
    return { context, storage, sent, toasts, toastDurations, scheduled, syncState };
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

async function testDisabledByDefaultSendsNothing() {
    const harness = createHarness({ enabled: false });
    harness.context.notify(3 * 3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 0, 'a disabled switch must not send a desktop notification');
    assert.equal(harness.toasts.length, 0, 'a disabled switch must not show an in-app hint');
}

async function testFiresOncePerHourBoundary() {
    const harness = createHarness();
    const { context, syncState, sent, toasts } = harness;

    context.notify(3599, syncState);
    await flush();
    assert.equal(sent.length, 0, '1 hour must not trigger early');

    context.notify(3600, syncState);
    await flush();
    assert.equal(sent.length, 1, 'crossing 1 hour must send one desktop notification');
    assert.equal(toasts.length, 1, 'crossing 1 hour must show one in-app hint');
    assert.match(toasts[0], /1 小时/);
    assert.equal(harness.toastDurations[0], 3000, 'the hourly in-app hint must remain visible for 3 seconds');
    assert.equal(sent[0].via, 'platform', 'desktop reminders must prefer SiYuan platformUtils over legacy bridges');
    assert.equal(sent[0].opts.timeoutType, 'default', 'the desktop notification must use the auto dismiss timeout');
    assert.notEqual(sent[0].opts.requireInteraction, true);

    context.notify(3600, syncState);
    context.notify(3601, syncState);
    await flush();
    assert.equal(sent.length, 1, 'the same hour must only remind once');

    context.notify(7200, syncState);
    await flush();
    assert.equal(sent.length, 2, 'the next hour boundary must remind again');
    assert.match(toasts[1], /2 小时/);
}

async function testSkippedHoursCollapseIntoOneReminder() {
    const harness = createHarness();
    harness.context.notify(5 * 3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 1, 'a long gap must still produce a single reminder');
    assert.match(harness.toasts[0], /5 小时/);
}

async function testPausedBreakAndMobileStaySilent() {
    const paused = createHarness({ isTimerPaused: true });
    paused.context.notify(3600, paused.syncState);
    const completed = createHarness({ status: 'COMPLETED' });
    completed.context.notify(3600, completed.syncState);
    const stopped = createHarness({ isRunning: false });
    stopped.context.notify(3600, stopped.syncState);
    const breakMode = createHarness({ timerMode: 'stopwatch-break' });
    breakMode.context.notify(3600, breakMode.syncState);
    const mobile = createHarness({ mobile: true });
    mobile.context.notify(3600, mobile.syncState);
    await flush();
    for (const [label, harness] of [
        ['paused', paused],
        ['completed', completed],
        ['stopped', stopped],
        ['break', breakMode],
        ['mobile', mobile],
    ]) {
        assert.equal(harness.sent.length, 0, `${label} timers must not send a desktop notification`);
        assert.equal(harness.toasts.length, 0, `${label} timers must not show an in-app hint`);
    }
}

async function testHiddenWindowKeepsDesktopNotification() {
    const harness = createHarness({ hidden: true });
    harness.context.notify(3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 1, 'a hidden window must still notify the desktop');
    assert.equal(harness.toasts.length, 0, 'a hidden window must not queue a stale in-app hint');
}

async function testRestartTruncatesAtTheCrossedHour() {
    const storage = new Map();
    const first = createHarness({ storage });
    first.context.notify(3600, first.syncState);
    await flush();
    assert.equal(first.sent.length, 1, 'the first run must remind at 1 hour');

    const restarted = createHarness({ storage: new Map(storage) });
    restarted.context.notify(3600, restarted.syncState);
    await flush();
    assert.equal(restarted.sent.length, 0, 'a restart inside the same hour must not repeat the reminder');

    restarted.context.notify(3 * 3600, restarted.syncState);
    await flush();
    assert.equal(restarted.sent.length, 1, 'a restart after missed hours must catch up exactly once');
    assert.match(restarted.toasts[0], /3 小时/);
}

async function testMissingSessionIdentityStaysSilent() {
    const harness = createHarness({ sessionId: '', startedAtMs: 0 });
    harness.context.notify(3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 0, 'a timer without any session identity must not remind');
    assert.equal(harness.storage.size, 0, 'a timer without any session identity must not persist reminder state');
}

async function testStartTimestampFallsBackAsIdentity() {
    const harness = createHarness({ sessionId: '', startedAtMs: 42_000 });
    harness.context.notify(3600, harness.syncState);
    harness.context.notify(3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 1, 'a legacy timer without a session id must dedupe by its start timestamp');
}

async function testDesktopNotificationRetriesOnceAfterFailure() {
    const harness = createHarness({ notificationResults: [-1, 7] });
    harness.context.notify(3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 1, 'the first desktop notification attempt must run immediately');
    assert.equal(harness.scheduled.length, 1, 'a failed desktop notification must schedule one retry');
    assert.equal(harness.scheduled[0].delayMs, 15000, 'the retry must use the bounded delay');

    harness.scheduled.shift().callback();
    await flush();
    assert.equal(harness.sent.length, 2, 'the scheduled retry must send the desktop notification again');
    assert.equal(harness.scheduled.length, 0, 'a successful retry must not schedule another attempt');
    assert.equal(harness.toasts.length, 1, 'desktop retries must not repeat the in-app hint');
}

async function testLegacyFallbackStillRequestsAutoDismiss() {
    const harness = createHarness({ platformAvailable: false });
    harness.context.notify(3600, harness.syncState);
    await flush();
    assert.equal(harness.sent.length, 1, 'the legacy bridge must remain available as a fallback');
    assert.equal(harness.sent[0].via, 'compat');
    assert.equal(harness.sent[0].opts.timeoutType, 'default', 'the fallback must also request auto dismissal');
}

async function testLimitBoundaryRemindsBeforeCompletion() {
    const calls = [];
    const nowMs = 3_600_001;
    const context = vm.createContext({
        Date: class extends Date { static now() { return nowMs; } },
        Math,
        Number,
        __globalAppResumeSyncLock: false,
        isSyncEnabled: () => false,
        isTimerPaused: false,
        timerMode: 'stopwatch',
        stopwatchStartTimeMs: 1,
        startTime: 1,
        syncState: { status: 'RUNNING' },
        elapsedSeconds: 3599,
        getStopwatchLimitSeconds: () => 3600,
        notifyStopwatchHourlyProgress: () => { calls.push('remind'); },
        finalizeExpiredTimerIfNeeded: async () => {
            calls.push('finalize');
            return true;
        },
    });
    vm.runInContext(`${tickBlock}\nthis.tick = handleTimerTick;`, context);
    await context.tick();
    assert.deepEqual(calls, ['remind', 'finalize'], 'the final whole-hour reminder must run before automatic completion');
}

(async () => {
    await testDisabledByDefaultSendsNothing();
    await testFiresOncePerHourBoundary();
    await testSkippedHoursCollapseIntoOneReminder();
    await testPausedBreakAndMobileStaySilent();
    await testHiddenWindowKeepsDesktopNotification();
    await testRestartTruncatesAtTheCrossedHour();
    await testMissingSessionIdentityStaysSilent();
    await testStartTimestampFallsBackAsIdentity();
    await testDesktopNotificationRetriesOnceAfterFailure();
    await testLegacyFallbackStillRequestsAutoDismiss();
    await testLimitBoundaryRemindsBeforeCompletion();
    console.log('stopwatch hourly reminder tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
