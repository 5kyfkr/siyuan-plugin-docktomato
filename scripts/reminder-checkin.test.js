'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.TOMATO_TEST_SOURCE || path.resolve(__dirname, '../tomato.js'), 'utf8');
const between = (a, b) => {
    const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
    assert.ok(start >= 0 && end > start, a);
    return source.slice(start, end);
};
const arrow = name => between(`    const ${name} =`, '\n    };') + '\n    };';
const dateKey = value => value instanceof Date
    ? [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-')
    : String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
const parseTime = value => /^\d{2}:\d{2}$/.test(String(value))
    ? { hh: Number(value.slice(0, 2)), mm: Number(value.slice(3)), key: value } : null;
const context = vm.createContext({
    Date, console, Set, Map,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat', REMINDER_REPEAT_MODE_MANUAL: 'manual',
    formatDateKey: dateKey, __normalizeReminderDateKey: dateKey, __parseTime: parseTime,
    toDateSafe: value => new Date(value),
    __parseReminderTaskRepeatRule: value => typeof value === 'string' ? JSON.parse(value) : value,
    __getReminderRepeatMode: value => value?.repeatMode || 'manual',
    __doesReminderFollowTaskSchedule: value => value?.repeatMode === 'followTaskRepeat',
    __getStartDateKey: value => dateKey(value.startDate),
    __normalizeReminderInterval: value => value,
    __normalizeReminderCalendarMode: value => value || 'solar',
    __getReminderEvery: value => Math.max(1, Number(value.every) || 1),
    __getReminderMonthlyMode: value => value.monthlyMode || 'date',
    __reminderOccurrenceKey: (date, time) => `${date} ${time}`,
    __isReminderOccurrenceBeforeScheduleEffectiveAt: () => false,
});
const names = ['__normalizeReminderTaskRepeatState', '__getReminderFollowTaskAnchorKey', '__isFollowTaskCheckinReminder',
    '__getReminderCompletedOccurrences', '__getReminderCompletedSet', '__getReminderExcludedSet',
    '__isReminderOccurrenceCompleted', '__isReminderOccurrenceSuppressed', '__isCompletedReminderTaskBlockRow'];
vm.runInContext(names.map(arrow).join('\n') + '\n' +
    between('    const __normalizeReminderMaxOccurrences =', '    const __normalizeReminderRepeatMode =') +
    between('    const __normalizeReminderWeekdays =', '    const __getReminderWeekdaysLabel =') +
    between('    const __getReminderMondayStart =', '    const __collectReminderOccurrencesInRange =') +
    arrow('__getLastDueReminderDateTime') + '\nthis.api = { next: getNextReminderDateTime, last: __getLastDueReminderDateTime, completed: __getReminderCompletedOccurrences, isCompletedRow: __isCompletedReminderTaskBlockRow, isCheckinDate: __isCheckinReminderDate };', context);
const coreStart = source.indexOf('function __createMonthRepeatCore');
const coreEnd = source.indexOf('\n', source.indexOf('const __monthRepeatCore ='));
vm.runInContext(source.slice(coreStart, coreEnd), context);
const reminder = {
    blockId: 'habit', enabled: true, repeatMode: 'followTaskRepeat', interval: 'once',
    startDate: '2026-09-01', taskCompletionTime: '2026-09-01', times: ['09:00', '18:00'],
    taskRepeatRule: { enabled: true, trigger: 'checkin', type: 'weekly', every: 1, weekdays: [1, 3, 5], anchorDate: '2026-09-28', until: '', maxOccurrences: 0 },
    taskRepeatState: { checkinHistory: [] }, completedOccurrences: [],
};
const nextKey = (r, at) => dateKey(context.api.next(r, new Date(at)));
assert.equal(nextKey(reminder, '2026-09-28T08:00:00'), '2026-09-28');
assert.equal(nextKey(reminder, '2026-09-29T08:00:00'), '2026-09-30', 'Wednesday must not depend on Monday completion or raw task due date');
assert.equal(nextKey(reminder, '2026-10-01T08:00:00'), '2026-10-02');
assert.equal(context.api.isCheckinDate(reminder, '2026-09-28'), true);
assert.equal(context.api.isCheckinDate(reminder, '2026-09-29'), false);
assert.equal(context.api.isCheckinDate(reminder, '2026-09-30'), true);
assert.equal(context.api.isCheckinDate(reminder, '2026-10-02'), true);
assert.equal(dateKey(context.api.last(reminder, new Date('2026-09-30T12:00:00'))), '2026-09-30');
reminder.taskRepeatState.checkinHistory.push({ scheduledDate: '2026-09-30', checkedAt: '2026-09-30T08:00:00' });
assert.equal(context.api.completed(reminder).length, 2, 'one daily check-in completes every reminder time on that day');
assert.equal(nextKey(reminder, '2026-09-30T08:00:00'), '2026-10-02');
assert.equal(context.api.isCheckinDate(reminder, '2026-09-30'), true, 'completed dates must remain available for calendar history');
assert.equal(dateKey(context.api.last(reminder, new Date('2026-09-30T12:00:00'))), '2026-09-28', 'completed day must not remain overdue');
reminder.completedOccurrences = [{ date: '2026-09-30', time: '09:00' }];
reminder.taskRepeatState.checkinHistory = [];
assert.equal(nextKey(reminder, '2026-09-30T08:00:00'), '2026-09-30', 'undo must override old reminder completion metadata');
assert.equal(nextKey({ ...reminder, taskRepeatRule: { ...reminder.taskRepeatRule, maxOccurrences: 2 } }, '2026-10-01T00:00:00'), '');
assert.equal(context.api.isCheckinDate({ ...reminder, taskRepeatRule: { ...reminder.taskRepeatRule, maxOccurrences: 2 } }, '2026-10-02'), false);
assert.equal(nextKey({ ...reminder, taskRepeatRule: { ...reminder.taskRepeatRule, maxOccurrences: 10, until: '2026-09-30' } }, '2026-10-01T00:00:00'), '', 'an earlier end date must still apply');
const checkedBlock = { type: 'i', markdown: '- [X] Habit', task_repeat_rule: reminder.taskRepeatRule };
assert.equal(context.api.isCompletedRow(checkedBlock), false, 'today checked note must retain later check-in reminders');
assert.equal(context.api.isCompletedRow({ ...checkedBlock, task_repeat_rule: null }), true, 'ordinary completed tasks stay excluded');
assert.equal(context.api.isCompletedRow({ ...checkedBlock, task_repeat_rule: { ...reminder.taskRepeatRule, enabled: false } }), true);
context.__normalizeReminderRepeatMode = value => value;
context.__getReminderTaskOwnTitle = () => 'habit';
context.__normalizeReminderTaskRepeatTrigger = value => value;
context.__normalizeReminderMonthlyMode = value => value || 'date';
context.__normalizeReminderTaskCompletionOwner = () => null;
context.__sanitizeReminderNotificationSchedules = value => value || {};
vm.runInContext(arrow('__sanitizeReminderData') + '\nthis.api.sanitize = __sanitizeReminderData;', context);
const freshReminder = context.api.sanitize(reminder, { taskRepeatState: { checkinHistory: [{ scheduledDate: '2026-09-28', checkedAt: '2026-09-28T12:00:00' }] } });
assert.equal(freshReminder.completedOccurrences.length, 2, 'calendar readers must receive projected daily completions');
assert.equal(freshReminder.completedOccurrences[0].date, '2026-09-28', 'canonical task history must override stale stored reminder completions');

const ui = vm.createContext({ repeatMode: 'followTaskRepeat', REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    taskContext: { taskRepeatRule: reminder.taskRepeatRule }, dateInput: { value: '2026-01-01' }, dateLabel: {},
    monthDayAnchorKey: '', selectedCalendarMode: 'solar', syncMonthlyModeVisibility() {} });
vm.runInContext(between('        const syncDateLabel = () => {', '\n        syncDateLabel();') + '\nthis.sync = syncDateLabel;', ui);
ui.sync(); assert.equal(ui.dateInput.disabled, true); assert.equal(ui.dateInput.value, '2026-09-28');
ui.repeatMode = 'manual'; ui.sync(); assert.equal(ui.dateInput.disabled, false, 'independent reminders retain editable dates');

let bridgeReady = true, failSave = false;
const calls = [];
context.getTaskHorizonSharedApi = () => ({ reminderBridge: bridgeReady ? {
    setCheckinFromReminder: async payload => { calls.push(payload); if (failSave) throw new Error('write failed'); return { ok: true, applied: true }; },
} : {} });
context.resolveReminderTaskAttrContext = async () => ({ taskId: 'habit' });
context.__withReminderOccurrenceMutation = (_id, run) => run();
context.getBlockReminder = async () => reminder;
context.saveBlockReminder = () => { throw new Error('check-in must not duplicate completion history in reminder storage'); };
vm.runInContext(arrow('__setFollowTaskReminderCheckin') + arrow('__markReminderOccurrenceCompleted') + arrow('__unmarkReminderOccurrenceCompleted') +
    '\nthis.api.mark = __markReminderOccurrenceCompleted; this.api.undo = __unmarkReminderOccurrenceCompleted;', context);
(async () => {
    assert.equal(await context.api.mark('habit', '2026-09-28', '09:00'), true);
    assert.equal(await context.api.mark('habit', '2026-09-30', '18:00'), true);
    assert.equal(await context.api.undo('habit', '2026-09-28', '09:00'), true, 'historical undo must not depend on the latest ordinary completion owner');
    assert.deepEqual(calls.map(x => [x.occurrenceKey, x.checked]), [['2026-09-28 09:00', true], ['2026-09-30 18:00', true], ['2026-09-28 09:00', false]]);
    bridgeReady = false;
    assert.equal(await context.api.mark('habit', '2026-09-28', '09:00'), false);
    bridgeReady = true; failSave = true;
    assert.equal(await context.api.undo('habit', '2026-09-28', '09:00'), false, 'failed check-in writes must not report success');
    console.log('check-in reminder schedule, daily projection, completion and historical undo tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
