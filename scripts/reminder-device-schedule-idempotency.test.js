'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('const __buildReminderSchedulePlanKey =');
const helperEnd = source.indexOf('const __isReminderDeviceScheduleEntryCompleted =', helperStart);
const reconcileStart = source.indexOf('async function __reconcileReminderDeviceSchedule');
const reconcileEnd = source.indexOf('const __reminderDeviceScheduleSyncFlights =', reconcileStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'device schedule helpers must remain extractable');
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart, 'device schedule reconcile must remain extractable');

const target = {
    occurrenceKey: '2026-07-27 09:00',
    dateKey: '2026-07-27',
    timeKey: '09:00',
    atMs: Date.now() + 86400000,
};
let registrySchedule = null;
let cancelCalls = [];
let sendCalls = 0;
let nextNotificationId = 900;

const context = vm.createContext({
    Date,
    JSON,
    Map,
    Number,
    String,
    DEVICE_NOTIFICATION_CHANNEL: 'timer',
    REMINDER_DEVICE_SCHEDULE_WINDOW_DAYS: 30,
    SYNC_DEVICE_ID: 'device-a',
    Logger: { info() {} },
    reminderSettings: { enabled: true, systemNotificationEnabled: true },
    isMobileDevice: () => true,
    shouldPreferDeviceNotificationBackend: () => true,
    normalizeNotificationId: (value) => Number.isInteger(Number(value)) ? Number(value) : null,
    __getReminderScheduleSignature: () => 'schedule-v1',
    __getReminderDeviceSchedule: (reminder) => reminder.notificationSchedules?.['device-a'] || null,
    __getReminderCurrentDeviceRegistrySchedule: () => registrySchedule,
    __hasValidReminderDeviceScheduleEntries: (schedule) => Array.isArray(schedule?.entries) && schedule.entries.length > 0,
    __setReminderDeviceSchedule: (reminder, schedule) => {
        reminder.notificationSchedules ||= {};
        if (schedule) reminder.notificationSchedules['device-a'] = schedule;
        else delete reminder.notificationSchedules['device-a'];
    },
    __setReminderDeviceRegistryEntry: (_blockId, schedule) => { registrySchedule = schedule; },
    __collectReminderScheduleTargets: () => [target],
    cancelDeviceNotificationCompat: async (id) => { cancelCalls.push(id); },
    sendDeviceNotificationCompat: async () => { sendCalls += 1; return nextNotificationId++; },
    __getReminderNotificationTitle: () => 'title',
    __getReminderNotificationBody: () => 'body',
});
context.globalThis = context;
vm.runInContext(`${source.slice(helperStart, helperEnd)}\n${source.slice(reconcileStart, reconcileEnd)}\nthis.__test = { __buildReminderSchedulePlanKey, __reconcileReminderDeviceSchedule };`, context);

const buildSchedule = (reminder, id, planKey = '') => ({
    planKey: planKey || context.__test.__buildReminderSchedulePlanKey(reminder, [target]),
    entries: [{ ...target, id, delayInSeconds: 60 }],
});

(async () => {
    const reminder = {
        blockId: 'task-1',
        blockName: 'Task',
        enabled: true,
        notificationSchedules: { 'device-a': buildSchedule({ blockId: 'task-1', blockName: 'Task' }, 101, 'stale') },
    };
    registrySchedule = buildSchedule(reminder, 202);

    const restored = await context.__test.__reconcileReminderDeviceSchedule(reminder, { now: new Date() });
    assert.equal(restored.reason, 'registry-restored');
    assert.equal(restored.nativeChanged, false);
    assert.equal(reminder.notificationSchedules['device-a'].entries[0].id, 202);
    assert.deepEqual(cancelCalls, [], 'restoring local metadata must not cancel a native notification');
    assert.equal(sendCalls, 0, 'restoring local metadata must not schedule a duplicate notification');

    const unchanged = await context.__test.__reconcileReminderDeviceSchedule(reminder, { now: new Date() });
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.reason, 'unchanged');
    assert.deepEqual(cancelCalls, []);
    assert.equal(sendCalls, 0);

    registrySchedule = null;
    const seeded = await context.__test.__reconcileReminderDeviceSchedule(reminder, { now: new Date() });
    assert.equal(seeded.reason, 'registry-seeded');
    assert.equal(registrySchedule.entries[0].id, 202);
    assert.deepEqual(cancelCalls, []);
    assert.equal(sendCalls, 0);

    reminder.notificationSchedules['device-a'] = buildSchedule(reminder, 301, 'old-attr');
    registrySchedule = buildSchedule(reminder, 301, 'old-registry');
    cancelCalls = [];
    sendCalls = 0;
    const replaced = await context.__test.__reconcileReminderDeviceSchedule(reminder, { now: new Date() });
    assert.equal(replaced.reason, 'updated');
    assert.deepEqual(cancelCalls, [301], 'the union of stale metadata must be canceled once per notification id');
    assert.equal(sendCalls, 1);

    console.log('reminder device schedule idempotency tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
