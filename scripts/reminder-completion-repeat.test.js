'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const between = (first, last) => {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start + first.length);
    assert.ok(start >= 0 && end > start, first);
    return source.slice(start, end);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const dateKey = (value) => value instanceof Date
    ? [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-')
    : String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
let clock = new Date('2026-09-11T12:00:00').getTime();
class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
}
const base = { blockId: 'reminder-1', enabled: true, repeatMode: 'manual', trigger: 'complete', interval: 'monthly', every: 1,
    startDate: '2026-06-08', times: ['09:00', '18:00'], completedOccurrences: [], excludedOccurrences: [] };
const harness = (initial = base) => {
    let stored = clone(initial);
    let saves = 0;
    let failSave = false;
    let sync = async () => {};
    const context = vm.createContext({ Date: ClockDate, Intl, Math, Number, String, JSON, Set, Map, Array, Object, Promise,
        REMINDER_REPEAT_MODE_MANUAL: 'manual', REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
        formatDateKey: dateKey, __normalizeReminderDateKey: dateKey,
        toDateSafe: (value) => new ClockDate(value),
        __getStartDateKey: (value) => dateKey(value.startDate),
        __normalizeReminderInterval: (value) => String(value || 'once'),
        __normalizeReminderCalendarMode: (value) => String(value || 'solar'),
        __normalizeReminderMonthlyMode: (value) => String(value || 'date'),
        __getReminderMonthlyMode: (value) => value.monthlyMode || 'date',
        __getReminderEvery: (value) => Math.max(1, Number(value.every) || 1),
        __getReminderRepeatMode: (value) => value.repeatMode || 'manual',
        __doesReminderFollowTaskSchedule: (value) => value.repeatMode === 'followTaskRepeat',
        __getReminderFollowTaskAnchorKey: (value) => value.taskCompletionTime || value.startDate,
        __getReminderTaskOwnTitle: () => '',
        __normalizeReminderRepeatMode: (value) => value || 'manual',
        __sanitizeReminderNotificationSchedules: (value) => value || {},
        __isReminderOccurrenceBeforeScheduleEffectiveAt: () => false,
        __getReminderExcludedSet: () => new Set(),
        __reminderOccurrenceKey: (date, time) => date + ' ' + time,
        getBlockReminder: async () => clone(stored),
        saveBlockReminder: async (_blockId, next) => { if (failSave) return false; saves += 1; stored = clone(context.sanitize(next)); return true; },
        __cancelReminderOccurrenceNotifications: async () => {}, __syncReminderDeviceSchedule: async () => {},
        refreshReminderDockPanel: () => {}, updateReminderBadge: () => {},
        __syncTaskCompletionFromReminder: (...args) => sync(...args),
    });
    for (const [first, last] of [
        ['function __createMonthRepeatCore', '\n    const __monthRepeatCore ='],
        ['const __parseTime =', 'const __getReminderScheduleSignature ='],
        ['const __normalizeReminderMaxOccurrences =', 'const __normalizeReminderRepeatMode ='],
        ['const __normalizeReminderWeekdays =', 'const __getReminderWeekdaysLabel ='],
        ['const __normalizeReminderTaskRepeatTrigger =', 'const __hasReminderIndependentLoop ='],
        ['const __normalizeReminderTaskRepeatState =', 'const __resolveReminderDialogRepeatMode ='],
        ['const __getReminderCompletedSet =', 'const __getReminderEvery ='],
        ['const __getReminderCompletionDateKey =', 'const __getReminderMondayStart ='],
        ['const __getReminderMondayStart =', 'const __collectReminderOccurrencesInRange ='],
        ['const __getLastDueReminderDateTime =', 'const __getSessionNotifiedSet ='],
        ['const __sanitizeReminderData =', 'const __getReminderDeviceScheduleRegistry ='],
        ['const __reminderOccurrenceMutations =', 'const __recordFollowTaskReminderCompletionOwner ='],
        ['const __canUndoReminderCompletionEntry =', 'const isRemindersGloballyEnabled ='],
    ]) vm.runInContext(between(first, last), context);
    vm.runInContext('const __monthRepeatCore = __createMonthRepeatCore(); this.sanitize = __sanitizeReminderData; this.api = { mark: __markReminderOccurrenceCompleted, undo: __unmarkReminderOccurrenceCompleted, remove: __deleteReminderOccurrence, next: getNextReminderDateTime, last: __getLastDueReminderDateTime, current: __getReminderCompletionDateKey, parse: __parseReminderTaskRepeatRule, countEnd: __getReminderCountEndDate, reconcileDraft: __reconcileReminderCompletionDraft };', context);
    return { api: context.api, get record() { return stored; }, get saves() { return saves; }, set failSave(value) { failSave = value; }, set sync(value) { sync = value; }, sanitize: context.sanitize };
};

async function run() {
    let test = harness();
    assert.equal(test.api.next(test.record, new ClockDate('2026-09-11T12:00:00')), null, 'overdue completion recurrence must not silently skip to another cycle');
    assert.equal(dateKey(test.api.last(test.record, new ClockDate('2026-09-11T12:00:00'))), '2026-06-08');
    assert.equal(test.api.countEnd({ ...base, maxOccurrences: 3 }, 3), '', 'completion count cannot predict an end date');
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00', { occurrenceNumber: 1 }), true);
    assert.equal(test.api.current(test.record), base.startDate, 'partial completion must retain the current cycle');
    assert.equal(test.record.repeatState.occurrenceCount, 1);
    assert.equal(await test.api.mark(base.blockId, base.startDate, '18:00', { occurrenceNumber: 1 }), true);
    assert.equal(test.record.repeatState.lastInstanceDue, '2026-10-11');
    assert.equal(test.record.repeatState.occurrenceCount, 2);
    assert.equal(dateKey(test.api.next(test.record, new ClockDate('2026-09-11T12:00:00'))), '2026-10-11');
    assert.equal(test.api.next(test.record, new ClockDate('2026-11-01')), null, 'reloads must only project the committed current date');
    const saves = test.saves;
    assert.equal(await test.api.mark(base.blockId, base.startDate, '18:00', { occurrenceNumber: 1 }), true);
    assert.equal(test.saves, saves, 'old cycle retries must not write');
    assert.equal(await test.api.undo(base.blockId, base.startDate, '09:00', { occurrenceNumber: 1 }), true);
    assert.equal(test.record.repeatState.occurrenceCount, 1);
    assert.equal(test.api.current(test.record), base.startDate);
    clock = new ClockDate('2026-09-13T12:00:00').getTime();
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00', { occurrenceNumber: 1 }), true);
    assert.equal(test.record.repeatState.lastInstanceDue, '2026-10-13', 're-completion must use the new completion date');
    test = harness();
    assert.deepEqual(await Promise.all(base.times.map(time => test.api.mark(base.blockId, base.startDate, time, { occurrenceNumber: 1 }))), [true, true]);
    assert.equal(test.record.completedOccurrences.length, 2, 'concurrent time completions must not overwrite each other');
    assert.equal(test.record.repeatState.occurrenceCount, 2);
    test = harness({ ...base, interval: 'daily', startDate: '2026-09-14', times: ['09:00'] });
    assert.deepEqual(await Promise.all([1, 2].map(() => test.api.mark(base.blockId, '2026-09-14', '09:00', { occurrenceNumber: 1 }))), [true, true]);
    assert.equal(test.record.repeatState.occurrenceCount, 2, 'early same-date retry must not complete a second cycle');
    assert.equal(test.api.current(test.record), '2026-09-14');
    assert.equal(dateKey(test.api.next(test.record, new ClockDate('2026-09-13'))), '2026-09-14', 'previous cycle completion must not suppress the new same-date cycle');
    test = harness({ ...base, times: ['09:00'], maxOccurrences: 200, repeatState: { occurrenceCount: 200 } });
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00', { occurrenceNumber: 200 }), true);
    assert.equal(test.record.repeatState.occurrenceCount, 201);
    assert.equal(test.api.current(test.record), '', 'the final allowed occurrence must stop');
    assert.equal(await test.api.undo(base.blockId, base.startDate, '09:00', { occurrenceNumber: 200 }), true);
    assert.equal(test.record.repeatState.occurrenceCount, 200);
    assert.equal(test.api.current(test.record), base.startDate);
    test = harness({ ...base, times: ['09:00'], endDate: '2026-09-30' });
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00'), true);
    assert.equal(test.api.current(test.record), '', 'a completion past the interval cutoff must finish the series');
    test = harness();
    test.failSave = true;
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00'), false);
    assert.equal(test.record.completedOccurrences.length, 0);
    test.failSave = false;
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00'), true, 'failed writes must release the mutation queue');
    assert.equal(await test.api.remove(base.blockId, base.startDate, '18:00'), true);
    assert.equal(test.record.repeatState.occurrenceCount, 2, 'excluded times do not prevent an actually completed cycle from advancing');
    test = harness({ ...base, trigger: 'due', times: ['09:00'] });
    assert.equal(await test.api.mark(base.blockId, base.startDate, '09:00'), true);
    assert.equal(test.record.repeatState.occurrenceCount, 1, 'due repetition must retain its old date-led scheduling');
    test = harness({ ...base, repeatMode: 'followTaskRepeat', interval: 'once', trigger: 'due', times: ['09:00'] });
    test.sync = async () => test.api.mark(base.blockId, base.startDate, '09:00', { skipTaskSync: true });
    let timeout;
    try {
        await Promise.race([test.api.mark(base.blockId, base.startDate, '09:00'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('nested follow completion deadlocked')), 1000); })]);
    } finally { clearTimeout(timeout); }
    test = harness({ ...base, repeatState: { occurrenceCount: 8, lastCompletedAt: '2026-09-01', lastInstanceDue: '2026-10-01' }, scheduleUpdatedAt: '2026-10-02T12:00:00' });
    const timeEdit = clone(test.record);
    timeEdit.times = ['10:00'];
    test.api.reconcileDraft(test.record, timeEdit);
    assert.equal(timeEdit.repeatState.occurrenceCount, 8, 'editing reminder times must retain the occurrence count');
    assert.equal(timeEdit.repeatState.lastInstanceDue, '2026-10-01', 'editing times must not rewind to the original start');
    const intervalEdit = { ...clone(test.record), every: 2 };
    test.api.reconcileDraft(test.record, intervalEdit);
    assert.equal(intervalEdit.repeatState.occurrenceCount, 1);
    assert.equal(intervalEdit.repeatState.lastInstanceDue, '2026-10-01', 'changing the interval resets counting without resurrecting the original overdue date');
    const dateEdit = { ...clone(test.record), startDate: '2026-12-01' };
    test.api.reconcileDraft(test.record, dateEdit);
    assert.equal(test.api.current(dateEdit), '2026-12-01');
    assert.equal(dateKey(test.api.last(test.record, new ClockDate('2026-10-03'))), '2026-10-01', 'schedule edits must not hide the incomplete current cycle');
    assert.equal(test.sanitize({ ...base, maxOccurrences: 3, endDate: '2026-06-09' }).endDate, '', 'count mode must ignore a stale due-based cutoff');
    test = harness({ ...base, interval: 'daily', startDate: '2026-09-14', excludedOccurrences: [{ date: '2026-09-14', time: '18:00', occurrenceNumber: 1 }], repeatState: { occurrenceCount: 2, lastInstanceDue: '2026-09-14' } });
    assert.equal(await test.api.mark(base.blockId, '2026-09-14', '09:00', { occurrenceNumber: 2 }), true);
    assert.equal(test.record.repeatState.occurrenceCount, 2, 'an earlier cycle exclusion must not satisfy the new cycle');
    assert.equal(await test.api.mark(base.blockId, '2026-09-14', '18:00', { occurrenceNumber: 2 }), true);
    assert.equal(test.record.repeatState.occurrenceCount, 3);
    assert.equal(await test.api.mark(base.blockId, '2026-09-14', '09:00', { occurrenceNumber: 3 }), true);
    const beforeUndo = clone(test.record);
    assert.equal(await test.api.undo(base.blockId, '2026-09-14', '18:00', { occurrenceNumber: 2 }), false, 'must not rewind a cycle once its successor has completion records');
    assert.deepEqual(test.record, beforeUndo);
    assert.equal(await test.api.mark(base.blockId, '2026-09-14', '01:00', { occurrenceNumber: 3 }), false, 'arbitrary times must not enter completion history');
    for (const type of ['weekly', 'monthly', 'yearly']) {
        const invalid = { trigger: 'complete', enabled: true, type, interval: type, weekdays: [1, 5], monthDays: [10, 20], monthlyMode: 'weekday', monthWeek: { ordinal: 1, weekday: 5 }, calendarMode: 'lunar' };
        for (const value of [test.api.parse(invalid), test.sanitize(invalid)]) {
            assert.deepEqual(Array.from(value.weekdays), []);
            assert.equal(value.monthDays, undefined);
            assert.equal(value.monthWeek, undefined);
            assert.equal(value.monthlyMode, 'date');
            assert.equal(value.calendarMode, 'solar');
        }
    }
    console.log('standalone reminder completion repeat tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
