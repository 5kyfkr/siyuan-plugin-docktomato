'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('const __resolveReminderDialogRepeatMode =');
const end = source.indexOf('const __applyFollowTaskReminderDraft =', start);
assert.ok(start >= 0 && end > start, 'follow reminder pure policy block must remain extractable');

const normalizeDateKey = (value) => {
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};
const parseRule = (value) => {
    if (!value || typeof value !== 'object' || value.enabled === false || value.type === 'none') return value && typeof value === 'object' ? { ...value, enabled: false } : null;
    return {
        enabled: true,
        trigger: value.trigger || 'due',
        type: value.type,
        every: Number(value.every) || 1,
        weekdays: Array.isArray(value.weekdays) ? value.weekdays.slice() : [],
        monthlyMode: value.monthlyMode || 'date',
        calendarMode: value.calendarMode || 'solar',
        until: value.until || '',
        maxOccurrences: Number(value.maxOccurrences) || 0,
        anchorDate: value.anchorDate || '',
    };
};

const context = vm.createContext({
    JSON,
    Set,
    String,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    REMINDER_REPEAT_MODE_MANUAL: 'manual',
    __getReminderRepeatMode: (reminder) => String(reminder?.repeatMode || 'manual'),
    __normalizeReminderDateKey: normalizeDateKey,
    __parseReminderTaskRepeatRule: parseRule,
    __normalizeReminderTaskRepeatState: (value) => ({ occurrenceCount: Math.max(1, Number(value?.occurrenceCount) || 1) }),
    __normalizeReminderTaskCompletionOwner: (value) => value && typeof value === 'object' ? { ...value } : null,
});
vm.runInContext(`${source.slice(start, end)}\nthis.__test = { __resolveReminderDialogRepeatMode, __buildFollowReminderRecord, __buildIndependentReminderRecord };`, context);

const { __resolveReminderDialogRepeatMode: resolveMode, __buildFollowReminderRecord: buildFollow, __buildIndependentReminderRecord: buildIndependent } = context.__test;
assert.equal(resolveMode(null, { taskOwned: true }), 'followTaskRepeat', 'Task Horizon must default new reminders to follow mode');
assert.equal(resolveMode(null, {}), 'manual', 'standalone reminders must retain the independent default');
assert.equal(resolveMode({ repeatMode: 'manual', interval: 'daily' }, { taskOwned: true }), 'manual', 'an explicitly independent reminder must stay independent');
assert.equal(resolveMode({ repeatMode: 'followTaskRepeat', interval: 'daily' }, {}), 'followTaskRepeat', 'a follow reminder must not downgrade because of its interval');

const rule = { enabled: true, trigger: 'due', type: 'daily', every: 1, monthlyMode: 'date', calendarMode: 'solar', until: '', maxOccurrences: 5, anchorDate: '2026-07-18' };
const owner = { occurrenceKey: '2026-07-18 09:00', dateKey: '2026-07-18', timeKey: '09:00' };
const existing = { taskCompletionTime: '2026-07-18', taskRepeatRule: rule, times: ['09:00'], taskCompletionOwner: owner };
const draft = {
    blockId: 'mirror',
    blockName: 'stale title',
    interval: 'weekly',
    endDate: '2026-12-31',
    maxOccurrences: 10,
    taskCompletionTime: '2025-01-01',
    times: ['09:00'],
};
const canonical = { taskId: 'task-1', attrHostId: 'host-1', taskTitle: 'Canonical title', startDate: '2026-07-01', completionTime: '2026-07-18', repeatRule: rule, repeatState: { occurrenceCount: 2 } };
const follow = buildFollow(draft, canonical, existing);
assert.equal(follow.repeatMode, 'followTaskRepeat');
assert.equal(follow.interval, 'once', 'follow records must not keep an independent root schedule');
assert.equal(follow.endDate, '');
assert.equal(follow.maxOccurrences, 0);
assert.equal(follow.taskCompletionTime, '2026-07-18');
assert.equal(follow.taskRepeatRule.maxOccurrences, 5);
assert.equal(follow.taskRepeatState.occurrenceCount, 2);
assert.equal(follow.blockName, 'Canonical title');
assert.equal(follow.syncTaskDone, true);
assert.equal(follow.taskCompletionOwner.occurrenceKey, owner.occurrenceKey, 'unchanged schedules may preserve their completion owner');

const moved = buildFollow(draft, { ...canonical, completionTime: '2026-07-19' }, existing);
assert.equal(moved.taskCompletionOwner, null, 'changing task-linked scheduling fields must clear a stale completion owner');

const independent = buildIndependent({ ...draft, repeatMode: 'followTaskRepeat', taskRepeatRule: rule, syncTaskDone: true });
assert.equal(independent.repeatMode, 'manual');
assert.equal(independent.interval, 'weekly');
assert.equal(independent.endDate, '2026-12-31');
assert.equal(independent.taskCompletionTime, '');
assert.equal(independent.taskRepeatRule, null);
assert.equal(independent.syncTaskDone, false);

const sanitizeStart = source.indexOf('const __getReminderTaskOwnTitle =');
const sanitizeEnd = source.indexOf('const __getReminderDeviceScheduleRegistry =', sanitizeStart);
assert.ok(sanitizeStart >= 0 && sanitizeEnd > sanitizeStart, 'reminder title sanitization must remain extractable');
const sanitizeContext = vm.createContext({
    Array,
    JSON,
    Number,
    Object,
    String,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    REMINDER_REPEAT_MODE_MANUAL: 'manual',
    __normalizeReminderRepeatMode: (value, fallback) => String(value || fallback),
    __normalizeReminderInterval: (value) => String(value || 'once'),
    __normalizeReminderWeekdays: (value) => Array.isArray(value) ? value.slice() : [],
    __normalizeReminderMaxOccurrences: (value) => Number(value) || 0,
    __getReminderCountEndDate: () => '',
    __normalizeReminderDateKey: normalizeDateKey,
    __parseReminderTaskRepeatRule: parseRule,
    __normalizeReminderTaskRepeatState: (value) => value || {},
    __normalizeReminderTaskCompletionOwner: (value) => value || null,
    __normalizeReminderMonthlyMode: (value) => String(value || 'date'),
    __normalizeReminderCalendarMode: (value) => String(value || 'solar'),
    __sanitizeReminderNotificationSchedules: (value) => value || {},
});
vm.runInContext(`${source.slice(sanitizeStart, sanitizeEnd)}\nthis.sanitizeReminder = __sanitizeReminderData;`, sanitizeContext);
const sanitizedParentReminder = sanitizeContext.sanitizeReminder({
    repeatMode: 'followTaskRepeat',
    blockName: 'v2.7.5 子任务甲 子任务乙',
    blockContent: 'v2.7.5 子任务甲 子任务乙',
    times: ['09:00'],
}, {
    blockId: 'host-1',
    blockContent: 'v2.7.5 子任务甲 子任务乙',
    blockMarkdown: '- [ ] v2.7.5\n\n  - [ ] 子任务甲\n  - [ ] 子任务乙',
});
assert.equal(sanitizedParentReminder.blockName, 'v2.7.5', 'follow reminder names must use only the parent task markdown line');
assert.equal(sanitizedParentReminder.blockContent, 'v2.7.5');

const dialogStart = source.indexOf('function showReminderDialog');
const dialogEnd = source.indexOf('\n    let lastCheckedDate', dialogStart);
const dialogBlock = source.slice(dialogStart, dialogEnd);
assert.doesNotMatch(dialogBlock, /!canFollow[\s\S]*?repeatMode\s*=\s*REMINDER_REPEAT_MODE_MANUAL/, 'dialog fields must never force follow mode back to independent');
assert.match(dialogBlock, /nameInput\.readOnly = follow/, 'follow mode must not maintain a second editable task title');
assert.match(dialogBlock, /__saveReminderDraft\(/, 'dialog saves must use the shared reminder save coordinator');
assert.match(source, /const __saveReminderDraft[\s\S]*?__applyFollowTaskReminderDraft\([\s\S]*?saveBlockReminder\(/, 'the save coordinator must update canonical task fields before reminder persistence');
assert.match(source, /b\.markdown[\s\S]*?blockMarkdown: block\.markdown/, 'reminder queries must provide markdown for parent-only title extraction');

console.log('reminder follow field stability tests passed');
