'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('const __getReminderMondayStart = (');
const end = source.indexOf('const __collectReminderOccurrencesInRange = (', start);
assert.ok(start >= 0 && end > start, 'reminder preview helper block must remain extractable');

const normalizeDateKey = (value) => {
    if (value instanceof Date) {
        const part = (number) => String(number).padStart(2, '0');
        return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`;
    }
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};

const context = {
    Date,
    Math,
    Number,
    Set,
    String,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    REMINDER_REPEAT_MODE_MANUAL: 'manual',
    toDateSafe: (value) => value instanceof Date ? new Date(value.getTime()) : new Date(value),
    formatDateKey: normalizeDateKey,
    __normalizeReminderDateKey: normalizeDateKey,
    __parseTime: (value) => {
        const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
        return match ? { hh: Number(match[1]), mm: Number(match[2]), key: value } : null;
    },
    __getStartDateKey: (reminder) => normalizeDateKey(reminder?.startDate),
    __normalizeReminderInterval: (value) => String(value || 'once'),
    __normalizeReminderWeekdays: (value) => {
        const normalized = Array.from(new Set((Array.isArray(value) ? value : []).map(Number))).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6).sort((a, b) => a - b);
        return normalized;
    },
    __parseReminderTaskRepeatRule: (value) => value && typeof value === 'object' ? value : null,
    __normalizeReminderCalendarMode: (value) => String(value || 'solar'),
    __getReminderEvery: (reminder) => Math.max(1, Number(reminder?.every) || 1),
    __getReminderRepeatMode: (reminder) => String(reminder?.repeatMode || 'manual'),
    __doesReminderFollowTaskSchedule: (reminder) => reminder?.repeatMode === 'followTaskRepeat',
    __getReminderFollowTaskAnchorKey: (reminder) => normalizeDateKey(reminder?.taskCompletionTime || reminder?.startDate),
    __reminderOccurrenceKey: (dateKey, timeKey) => `${String(dateKey || '').trim()} ${String(timeKey || '').trim()}`.trim(),
    __getReminderExcludedSet: (reminderValue) => new Set((reminderValue?.excludedOccurrences || []).map((item) => `${item.date} ${item.time}`)),
    __isReminderOccurrenceSuppressed: (reminderValue, dateKey, timeKey) => {
        return (reminderValue?.excludedOccurrences || []).some((item) => `${item.date} ${item.time}` === `${dateKey} ${timeKey}`);
    },
    __hasReminderFollowTaskRepeat: (reminderValue) => reminderValue?.repeatMode === 'followTaskRepeat' && reminderValue?.taskRepeatRule?.enabled === true,
    __normalizeReminderTaskRepeatState: (value) => ({ occurrenceCount: Math.max(1, Number(value?.occurrenceCount) || 1) }),
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.__test = { getNextReminderDateTime, __getNextFollowTaskReminderPreviewDateTime };`, context);

const reminder = {
    enabled: true,
    repeatMode: 'followTaskRepeat',
    interval: 'once',
    times: ['09:00'],
    startDate: '2026-07-18',
    taskCompletionTime: '2026-07-18',
    taskRepeatRule: {
        enabled: true,
        type: 'daily',
        every: 1,
        monthlyMode: 'date',
        calendarMode: 'solar',
        until: '',
        anchorDate: '2026-07-18',
    },
};
const afterCurrent = new Date('2026-07-18T09:01:00');
assert.equal(context.__test.getNextReminderDateTime(reminder, afterCurrent), null, 'runtime follow logic must remain unchanged before task advancement');
const preview = context.__test.__getNextFollowTaskReminderPreviewDateTime(reminder, afterCurrent);
assert.ok(preview instanceof Date && !Number.isNaN(preview.getTime()));
assert.equal(normalizeDateKey(preview), '2026-07-19');
assert.equal(preview.getHours(), 9);
assert.equal(preview.getMinutes(), 0);

const fsrsReminder = {
    ...reminder,
    taskRepeatRule: {
        enabled: true,
        type: 'fsrs',
        trigger: 'complete',
        anchorDate: '2026-07-18',
    },
};
const fsrsCurrent = context.__test.getNextReminderDateTime(fsrsReminder, new Date('2026-07-18T08:00:00'));
assert.equal(normalizeDateKey(fsrsCurrent), '2026-07-18', 'FSRS reminders must expose the task current due occurrence');
assert.equal(
    context.__test.getNextReminderDateTime(fsrsReminder, afterCurrent),
    null,
    'FSRS reminders must not fabricate a fixed future occurrence after the current due time'
);
assert.equal(
    context.__test.__getNextFollowTaskReminderPreviewDateTime(fsrsReminder, afterCurrent),
    null,
    'FSRS follow previews must wait for the next task review result'
);

const deletedCurrentFollow = {
    ...reminder,
    excludedOccurrences: [{ date: '2026-07-18', time: '09:00' }],
};
const nextFollowAfterDeletedCurrent = context.__test.getNextReminderDateTime(deletedCurrentFollow, new Date('2026-07-18T08:00:00'));
assert.ok(nextFollowAfterDeletedCurrent instanceof Date && !Number.isNaN(nextFollowAfterDeletedCurrent.getTime()));
assert.equal(normalizeDateKey(nextFollowAfterDeletedCurrent), '2026-07-19', 'deleted follow occurrence must project the next task recurrence');
assert.equal(nextFollowAfterDeletedCurrent.getHours(), 9);
assert.equal(nextFollowAfterDeletedCurrent.getMinutes(), 0);

const weeklyDeletedCurrent = {
    ...reminder,
    startDate: '2026-07-20',
    taskCompletionTime: '2026-07-20',
    taskRepeatRule: {
        ...reminder.taskRepeatRule,
        type: 'weekly',
        weekdays: [1, 3, 5],
        anchorDate: '2026-07-20',
    },
    excludedOccurrences: [{ date: '2026-07-20', time: '09:00' }],
};
assert.equal(
    normalizeDateKey(context.__test.getNextReminderDateTime(weeklyDeletedCurrent, new Date('2026-07-20T08:00:00'))),
    '2026-07-22',
    'follow-task preview must preserve selected weekdays'
);

const emptyWeeklyDeletedCurrent = {
    ...weeklyDeletedCurrent,
    taskRepeatRule: {
        ...weeklyDeletedCurrent.taskRepeatRule,
        weekdays: [],
    },
};
assert.equal(
    normalizeDateKey(context.__test.getNextReminderDateTime(emptyWeeklyDeletedCurrent, new Date('2026-07-20T08:00:00'))),
    '2026-07-27',
    'empty follow-task weekdays must use the task due weekday'
);

const deletedSeveralFollowOccurrences = {
    ...reminder,
    excludedOccurrences: Array.from({ length: 10 }, (_, offset) => ({
        date: `2026-07-${String(18 + offset).padStart(2, '0')}`,
        time: '09:00',
    })),
};
const nextFollowAfterSeveralDeletes = context.__test.getNextReminderDateTime(
    deletedSeveralFollowOccurrences,
    new Date('2026-07-18T08:00:00')
);
assert.ok(nextFollowAfterSeveralDeletes instanceof Date && !Number.isNaN(nextFollowAfterSeveralDeletes.getTime()));
assert.equal(normalizeDateKey(nextFollowAfterSeveralDeletes), '2026-07-28', 'consecutive single deletions must skip every stored exception');

const independent = {
    enabled: true,
    repeatMode: 'manual',
    interval: 'daily',
    every: 1,
    times: ['09:00'],
    startDate: '2026-07-18',
    excludedOccurrences: [{ date: '2026-07-18', time: '09:00' }],
};
const nextAfterExcluded = context.__test.getNextReminderDateTime(independent, new Date('2026-07-18T08:00:00'));
assert.ok(nextAfterExcluded instanceof Date && !Number.isNaN(nextAfterExcluded.getTime()));
assert.equal(normalizeDateKey(nextAfterExcluded), '2026-07-19', 'deleting one recurring occurrence must retain the next occurrence');

assert.match(source, /followRule\.type === 'fsrs'\) return 'FSRS 间隔重复'/, 'the reminder dock must label adaptive task repeats explicitly');
