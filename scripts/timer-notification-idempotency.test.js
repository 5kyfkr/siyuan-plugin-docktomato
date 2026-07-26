'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const stateStart = source.indexOf('function getNotificationSchedulesMap');
const stateEnd = source.indexOf('function isOfficialMobileNotificationRuntime', stateStart);
const reconcileStart = source.indexOf('function shouldShowTimerNotificationCancelToast');
const reconcileEnd = source.indexOf('function showSystemNotification', reconcileStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart, 'timer notification state helpers must remain extractable');
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart, 'timer notification reconcile must remain extractable');

const storage = new Map();
let sendCalls = 0;
let cancelCalls = [];
let persistCalls = 0;
let nextId = 500;
const startAt = Date.now();
const syncState = {
    status: 'RUNNING',
    mode: 'countdown',
    duration: 1800,
    startTime: startAt,
    notificationSchedules: {},
};

const context = vm.createContext({
    Date,
    JSON,
    Number,
    Set,
    String,
    syncState,
    SYNC_DEVICE_ID: 'device-a',
    TIMER_DEVICE_SCHEDULE_REGISTRY_KEY: 'timer-registry',
    DEVICE_NOTIFICATION_CHANNEL: 'timer',
    localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
    },
    timerMode: 'countdown',
    currentDuration: 30,
    startTime: startAt,
    isRunning: true,
    isTimerPaused: false,
    remainingSeconds: 1800,
    __tomatoInitBootstrapping: false,
    normalizeNotificationId: (value) => Number.isInteger(Number(value)) ? Number(value) : null,
    isOfficialMobileNotificationRuntime: () => true,
    shouldUseScheduledTimerNotificationBackend: () => true,
    shouldPreferDeviceNotificationBackend: () => true,
    showMiniToast: () => {},
    persistNotificationScheduleState: async () => { persistCalls += 1; },
    cancelDeviceNotificationCompat: async (id) => { cancelCalls.push(id); return true; },
    sendDeviceNotificationCompat: async () => {
        sendCalls += 1;
        await Promise.resolve();
        return nextId++;
    },
});
context.globalThis = context;
vm.runInContext(`${source.slice(stateStart, stateEnd)}\n${source.slice(reconcileStart, reconcileEnd)}\nthis.__test = { buildTimerNotificationKey, setLocalTimerNotificationSchedule, reconcileTrackedTimerNotification };`, context);

const desiredKey = context.__test.buildTimerNotificationKey(syncState);
const schedule = (id, timerKey = desiredKey) => ({ id, timerKey, status: 'scheduled', mode: 'countdown' });

(async () => {
    syncState.notificationSchedules['device-a'] = schedule(66, 'stale');
    context.__test.setLocalTimerNotificationSchedule(schedule(77));

    await context.__test.reconcileTrackedTimerNotification('re-entry', true);
    await context.__test.reconcileTrackedTimerNotification('re-entry-again', true);
    assert.equal(syncState.notificationSchedules['device-a'].id, 77, 'the local native schedule must repair stale synced metadata');
    assert.equal(sendCalls, 0, 'an unchanged timer key must not schedule again');
    assert.deepEqual(cancelCalls, [], 'an unchanged timer key must not cancel the native notification');
    assert.equal(persistCalls, 0, 'metadata repair must not create a sync write loop');

    context.__test.setLocalTimerNotificationSchedule(null);
    await context.__test.reconcileTrackedTimerNotification('registry-migration', true);
    assert.equal(sendCalls, 0, 'legacy synced metadata should seed an empty local mirror');
    assert.deepEqual(cancelCalls, []);

    syncState.startTime = startAt + 1000;
    context.startTime = syncState.startTime;
    sendCalls = 0;
    cancelCalls = [];
    const [first, second] = await Promise.all([
        context.__test.reconcileTrackedTimerNotification('changed-a', false),
        context.__test.reconcileTrackedTimerNotification('changed-b', false),
    ]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(sendCalls, 1, 'same-key concurrent reconciles must share one native scheduling call');
    assert.deepEqual(cancelCalls, [77], 'the previous local native schedule must be canceled once');

    console.log('timer notification idempotency tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
