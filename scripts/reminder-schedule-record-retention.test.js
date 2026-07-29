'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const normalizeStart = source.indexOf('const __normalizeReminderScheduleRecordLedger =');
const normalizeEnd = source.indexOf('const __getReminderScheduleRecordEntrySignature =', normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'reminder schedule record normalization must remain extractable');

const nowMs = Date.parse('2026-07-30T00:00:00Z');
const retentionMs = 30 * 24 * 60 * 60 * 1000;
const context = vm.createContext({
    Array,
    Date,
    Number,
    Set,
    String,
    REMINDER_DEVICE_SCHEDULE_RECORD_RETENTION_MS: retentionMs,
    __sanitizeReminderNotificationSchedules: (value) => value || {},
});
vm.runInContext(source.slice(normalizeStart, normalizeEnd) + '\nthis.normalizeLedger = __normalizeReminderScheduleRecordLedger;', context);

const ledger = context.normalizeLedger({
    records: [
        {
            entityId: 'expired-task',
            retainedAtMs: nowMs - retentionMs - 1,
            notificationSchedules: { mobile: { entries: [{ id: 1 }] } },
        },
        {
            entityId: 'active-task',
            retainedAtMs: nowMs - retentionMs + 1,
            notificationSchedules: { mobile: { entries: [{ id: 2 }] } },
        },
        {
            entityId: 'canceled-task',
            retainedAtMs: nowMs - 1000,
            notificationSchedules: {
                mobile: {
                    status: 'canceled',
                    canceledAt: '2026-07-29T00:00:00Z',
                    entries: [{ id: 3 }],
                },
            },
        },
    ],
}, nowMs);

assert.deepEqual(
    Array.from(ledger.records, (record) => record.entityId),
    ['active-task', 'canceled-task'],
    'only records older than 30 days may be pruned',
);
assert.equal(ledger.records[1].notificationSchedules.mobile.status, 'canceled', 'canceled metadata must remain until retention expires');

assert.match(source, /__retainReminderDeviceScheduleRecords\([\s\S]*?reminderBlockId,[\s\S]*?scheduleRecordToRetain\.reminder,[\s\S]*?'reminder-edited'/, 'reminder edits must retain the previous appointment record');
assert.ok(source.includes("__retainReminderDeviceScheduleRecords(reminderId, existingReminder, 'reminder-deleted'"), 'reminder deletion must retain the previous appointment record');
assert.match(source, /__syncAllReminderDeviceSchedules[\s\S]*?__reconcileReminderScheduleRecordLedger\(\)/, 'full device sync must consume retained cancellation records');
assert.match(source, /__syncReminderDeviceSchedulesFromList[\s\S]*?__reconcileReminderScheduleRecordLedger\(\)/, 'list device sync must consume retained cancellation records');
assert.match(source, /record\.notificationSchedules\[SYNC_DEVICE_ID\][\s\S]*?status:\s*'canceled'/, 'mobile cancellation must be acknowledged without deleting the record');

console.log('reminder schedule record retention tests passed');
