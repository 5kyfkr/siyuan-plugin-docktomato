'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const suppressionStart = source.indexOf('const __getReminderExcludedSet =');
const suppressionEnd = source.indexOf('\n    const __getReminderEvery =', suppressionStart);
assert.ok(suppressionStart >= 0 && suppressionEnd > suppressionStart, 'occurrence suppression policy must remain extractable');
const suppressionBlock = source.slice(suppressionStart, suppressionEnd);

const suppressionContext = vm.createContext({
    Set,
    __reminderOccurrenceKey: (dateKey, timeKey) => `${dateKey} ${timeKey}`,
    __getReminderCompletedSet: (reminder) => new Set((reminder.completedOccurrences || []).map((item) => `${item.date} ${item.time}`)),
});
vm.runInContext(`${suppressionBlock}\nthis.__test = { __getReminderExcludedSet, __isReminderOccurrenceSuppressed };`, suppressionContext);

const reminder = {
    completedOccurrences: [{ date: '2026-07-17', time: '09:00' }],
    excludedOccurrences: [{ date: '2026-07-18', time: '09:00' }],
};
assert.equal(suppressionContext.__test.__isReminderOccurrenceSuppressed(reminder, '2026-07-17', '09:00'), true);
assert.equal(suppressionContext.__test.__isReminderOccurrenceSuppressed(reminder, '2026-07-18', '09:00'), true);
assert.equal(suppressionContext.__test.__isReminderOccurrenceSuppressed(reminder, '2026-07-19', '09:00'), false);

const deleteStart = source.indexOf('const __deleteReminderOccurrence = async');
const deleteEnd = source.indexOf('\n    const __recordFollowTaskReminderCompletionOwner', deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'single-occurrence deletion must remain extractable');
const deleteBlock = source.slice(deleteStart, deleteEnd);

let storedReminder = { blockId: 'task-1', completedOccurrences: [], excludedOccurrences: [] };
let saveCount = 0;
let cancelCount = 0;
const deleteContext = vm.createContext({
    Date,
    __reminderOccurrenceKey: (dateKey, timeKey) => `${dateKey} ${timeKey}`,
    __getReminderExcludedSet: suppressionContext.__test.__getReminderExcludedSet,
    getBlockReminder: async () => storedReminder,
    __cancelReminderOccurrenceNotifications: async () => { cancelCount += 1; },
    saveBlockReminder: async (_blockId, next) => {
        saveCount += 1;
        storedReminder = next;
        return true;
    },
    refreshReminderDockPanel: () => {},
    updateReminderBadge: () => {},
});
vm.runInContext(`${deleteBlock}\nthis.deleteOccurrence = __deleteReminderOccurrence;`, deleteContext);

const dialogStart = source.indexOf('function showMobileConfirmDialog');
const dialogEnd = source.indexOf('\n    // 关闭移动端弹窗', dialogStart);
const dialogBlock = source.slice(dialogStart, dialogEnd);
assert.match(dialogBlock, /tomy-mobile-confirm-modal/, 'delete scope must use the plugin dialog skin');
assert.match(dialogBlock, /\.tomy-mobile-confirm-btn\.danger/, 'the plugin dialog must expose a destructive choice style');
assert.doesNotMatch(dialogBlock, /new Dialog|b3-dialog__|b3-button/, 'delete scope must not use SiYuan dialog styling');

const scopeStart = source.indexOf('const __chooseReminderDeleteScope = async');
const scopeEnd = source.indexOf('\n    const __getReminderFollowTaskAnchorKey', scopeStart);
const scopeBlock = source.slice(scopeStart, scopeEnd);
assert.match(scopeBlock, /仅删除当前/);
assert.match(scopeBlock, /删除全部/);
assert.match(scopeBlock, /showMobileConfirmDialog\(/, 'recurring deletion must use the plugin choice dialog');

const recurringStart = source.indexOf('const __isRecurringReminder =');
const recurringEnd = source.indexOf('\n    const __resolveReminderDeleteOccurrenceContext', recurringStart);
const recurringContext = vm.createContext({
    __hasReminderFollowTaskRepeat: (value) => value?.followRepeat === true,
    __normalizeReminderInterval: (value) => String(value || 'once'),
});
vm.runInContext(`${source.slice(recurringStart, recurringEnd)}\nthis.isRecurring = __isRecurringReminder;`, recurringContext);
assert.equal(recurringContext.isRecurring({ interval: 'once' }), false);
assert.equal(recurringContext.isRecurring({ interval: 'daily' }), true);
assert.equal(recurringContext.isRecurring({ interval: 'once', followRepeat: true }), true);

const resolveStart = source.indexOf('const __resolveReminderDeleteOccurrenceContext =');
const resolveEnd = source.indexOf('\n    const __chooseReminderDeleteScope', resolveStart);
const resolveContext = vm.createContext({
    Date,
    String,
    __normalizeReminderDateKey: (value) => String(value || '').slice(0, 10),
    getNextReminderDateTime: () => new Date('2026-07-20T09:30:00'),
    __getLastDueReminderDateTime: () => null,
    formatDateKey: (value) => String(value.toISOString()).slice(0, 10),
});
vm.runInContext(`${source.slice(resolveStart, resolveEnd)}\nthis.resolveOccurrence = __resolveReminderDeleteOccurrenceContext;`, resolveContext);
assert.deepEqual(
    JSON.parse(JSON.stringify(resolveContext.resolveOccurrence({}, { dateKey: '2026-07-18', timeKey: '08:00' }))),
    { dateKey: '2026-07-18', timeKey: '08:00' },
);
assert.deepEqual(
    JSON.parse(JSON.stringify(resolveContext.resolveOccurrence({}, { nowDate: new Date('2026-07-18T08:00:00') }))),
    { dateKey: '2026-07-20', timeKey: '09:30' },
    'editor deletion without dock context must resolve the nearest scheduled occurrence',
);

const dockDeleteStart = source.indexOf('const deleteReminder = async () => {');
const dockDeleteEnd = source.indexOf('\n            refs.moreBtn.onclick', dockDeleteStart);
const dockDeleteBlock = source.slice(dockDeleteStart, dockDeleteEnd);
assert.match(dockDeleteBlock, /__chooseReminderDeleteScope\(/);
assert.match(dockDeleteBlock, /__deleteReminderOccurrence\(/);
assert.match(dockDeleteBlock, /deleteBlockReminder\(/);
assert.match(source, /__openReminderDockActionMenu\(refs\.moreBtn,[\s\S]*删除提醒/,
    'dock deletion must remain available from the overflow menu');

const editDeleteStart = source.indexOf("deleteBtn.textContent = '删除提醒';");
const editDeleteEnd = source.indexOf('\n        const saveBtn =', editDeleteStart);
const editDeleteBlock = source.slice(editDeleteStart, editDeleteEnd);
assert.match(editDeleteBlock, /__chooseReminderDeleteScope\(existingReminder/,
    'the reminder editor delete button must ask for recurring deletion scope');
assert.match(editDeleteBlock, /__deleteReminderOccurrence\(/,
    'the reminder editor must support deleting only its current occurrence');
assert.match(editDeleteBlock, /deleteBlockReminder\(/,
    'the reminder editor must retain whole-series deletion');
assert.match(source, /const editReminder[\s\S]*occurrenceDateKey:\s*dateKey[\s\S]*occurrenceTimeKey:\s*timeKey/,
    'opening the editor from a dock occurrence must preserve that occurrence identity');

(async () => {
    assert.equal(await deleteContext.deleteOccurrence('task-1', '2026-07-18', '09:00'), true);
    assert.equal(saveCount, 1);
    assert.equal(cancelCount, 1);
    assert.equal(storedReminder.completedOccurrences.length, 0, 'deleting an occurrence must not mark it completed');
    assert.equal(storedReminder.excludedOccurrences.length, 1);
    assert.equal(storedReminder.excludedOccurrences[0].date, '2026-07-18');
    assert.equal(storedReminder.excludedOccurrences[0].time, '09:00');

    assert.equal(await deleteContext.deleteOccurrence('task-1', '2026-07-19', '09:00'), true);
    assert.equal(saveCount, 2, 'deleting the next occurrence must append another exception');
    assert.equal(cancelCount, 2);
    assert.equal(storedReminder.excludedOccurrences.length, 2);
    assert.equal(storedReminder.excludedOccurrences[0].date, '2026-07-19');

    assert.equal(await deleteContext.deleteOccurrence('task-1', '2026-07-19', '09:00'), true);
    assert.equal(saveCount, 2, 'repeating the same occurrence deletion must be idempotent');
    assert.equal(cancelCount, 2);
    console.log('reminder occurrence deletion tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
