'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const countStart = source.indexOf('const __normalizeReminderMaxOccurrences =');
const countEnd = source.indexOf('const __normalizeReminderRepeatMode =', countStart);
const weekdayStart = source.indexOf('const __normalizeReminderWeekdays =');
const weekdayEnd = source.indexOf('const __getReminderWeekdaysLabel =', weekdayStart);
const scheduleStart = source.indexOf('const __getReminderMondayStart = (');
const scheduleEnd = source.indexOf('const __collectReminderOccurrencesInRange = (', scheduleStart);
assert.ok(countStart >= 0 && countEnd > countStart, 'count helper block must remain extractable');
assert.ok(weekdayStart >= 0 && weekdayEnd > weekdayStart, 'weekday normalizer must remain extractable');
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'schedule helper block must remain extractable');

const normalizeDateKey = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const pad = (number) => String(number).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};

const normalizeInterval = (value) => {
    const raw = String(value || '').toLowerCase();
    return ['once', 'daily', 'workday', 'weekly', 'monthly', 'yearly'].includes(raw) ? raw : 'once';
};

const buildMonthlyDate = (anchor, monthOffset) => {
    const total = anchor.getFullYear() * 12 + anchor.getMonth() + Number(monthOffset || 0);
    const year = Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(anchor.getDate(), lastDay));
};

const context = {
    Date,
    Math,
    Number,
    Set,
    String,
    REMINDER_REPEAT_MODE_MANUAL: 'manual',
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    toDateSafe: (value) => value instanceof Date ? new Date(value.getTime()) : new Date(value),
    formatDateKey: normalizeDateKey,
    __normalizeReminderDateKey: normalizeDateKey,
    __normalizeReminderInterval: normalizeInterval,
    __parseTime: (value) => {
        const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
        return match ? { hh: Number(match[1]), mm: Number(match[2]), key: String(value) } : null;
    },
    __getStartDateKey: (reminder) => normalizeDateKey(reminder?.startDate),
    __parseReminderTaskRepeatRule: (value) => value && typeof value === 'object' ? value : null,
    __normalizeReminderCalendarMode: (value) => String(value || 'solar'),
    __getReminderEvery: (reminder) => Math.max(1, Number(reminder?.every) || 1),
    __getReminderMonthlyMode: (reminder) => String(reminder?.monthlyMode || 'date'),
    __getReminderRepeatMode: (reminder) => String(reminder?.repeatMode || 'manual'),
    __doesReminderFollowTaskSchedule: (reminder) => reminder?.repeatMode === 'followTaskRepeat',
    __getReminderFollowTaskAnchorKey: (reminder) => normalizeDateKey(reminder?.taskCompletionTime || reminder?.startDate),
    __isReminderOccurrenceSuppressed: () => false,
    __isReminderWorkdayOccurrence: (candidate) => candidate.getDay() !== 0 && candidate.getDay() !== 6,
    __buildReminderMonthlyDate: buildMonthlyDate,
    __buildReminderMonthlyWeekdayDate: buildMonthlyDate,
    __normalizeReminderTaskRepeatState: (value) => ({ occurrenceCount: Math.max(1, Number(value?.occurrenceCount) || 1) }),
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source.slice(countStart, countEnd), context);
vm.runInContext(source.slice(weekdayStart, weekdayEnd), context);
vm.runInContext(`${source.slice(scheduleStart, scheduleEnd)}\nthis.__test = { __normalizeReminderMaxOccurrences, __normalizeReminderWeekdays, __getReminderCountEndDate, getNextReminderDateTime, __getNextFollowTaskReminderPreviewDateTime };`, context);

const { __normalizeReminderMaxOccurrences: normalizeMax, __getReminderCountEndDate: getEndDate, __getNextFollowTaskReminderPreviewDateTime: getFollowPreview } = context.__test;
assert.equal(normalizeMax(0), 0);
assert.equal(normalizeMax(999), 200);
assert.deepEqual(Array.from(context.__test.__normalizeReminderWeekdays([], '2026-07-20')), [], 'empty weekday selections must remain empty');
assert.equal(getEndDate({ interval: 'daily', every: 1, startDate: '2026-07-18' }, 1), '2026-07-18');
assert.equal(getEndDate({ interval: 'daily', every: 2, startDate: '2026-07-18' }, 5), '2026-07-26');
assert.equal(getEndDate({ interval: 'weekly', every: 1, startDate: '2026-07-18' }, 3), '2026-08-01');
assert.equal(getEndDate({ interval: 'weekly', every: 1, weekdays: [1, 3, 5], startDate: '2026-07-20' }, 5), '2026-07-29');
assert.equal(getEndDate({ interval: 'weekly', every: 2, weekdays: [1, 3], startDate: '2026-07-20' }, 3), '2026-08-03');
assert.equal(getEndDate({ interval: 'monthly', every: 1, monthlyMode: 'date', calendarMode: 'solar', startDate: '2026-01-31' }, 3), '2026-03-31');

const exhaustedFollow = {
    enabled: true,
    repeatMode: 'followTaskRepeat',
    interval: 'once',
    times: ['09:00'],
    startDate: '2026-07-18',
    taskCompletionTime: '2026-07-18',
    taskRepeatRule: { enabled: true, type: 'daily', every: 1, maxOccurrences: 3, until: '', anchorDate: '2026-07-18' },
    taskRepeatState: { occurrenceCount: 3 },
};
assert.equal(getFollowPreview(exhaustedFollow, new Date('2026-07-18T09:01:00')), null, 'follow preview must stop at the task count limit');

const weeklyNext = context.__test.getNextReminderDateTime({
    enabled: true,
    repeatMode: 'manual',
    interval: 'weekly',
    every: 1,
    weekdays: [1, 3, 5],
    startDate: '2026-07-20',
    times: ['09:00'],
}, new Date('2026-07-20T10:00:00'));
assert.equal(normalizeDateKey(weeklyNext), '2026-07-22', 'weekly recurrence must use the next selected weekday');

const emptyWeeklyNext = context.__test.getNextReminderDateTime({
    enabled: true,
    repeatMode: 'manual',
    interval: 'weekly',
    every: 1,
    weekdays: [],
    startDate: '2026-07-20',
    times: ['09:00'],
}, new Date('2026-07-20T10:00:00'));
assert.equal(normalizeDateKey(emptyWeeklyNext), '2026-07-27', 'empty weekday recurrence must follow the start date weekday');

assert.match(source, /endCountInput\.max = '200'/, 'dialog count input must cap at 200');
assert.match(source, /option value="count"/, 'dialog must expose count ending as a separate mode');
assert.match(source, /__normalizeReminderMaxOccurrences\(reminder\?\.maxOccurrences\)/, 'schedule signature must include the count limit');
assert.match(source, /\[\[1, '一'\], \[2, '二'\], \[3, '三'\], \[4, '四'\], \[5, '五'\], \[6, '六'\], \[0, '日'\]\]/, 'dialog must render Monday-first weekday controls');
assert.doesNotMatch(source, /selectedWeekdays\.length <= 1/, 'dialog must allow clearing every weekday');

console.log('reminder repeat count tests passed');
