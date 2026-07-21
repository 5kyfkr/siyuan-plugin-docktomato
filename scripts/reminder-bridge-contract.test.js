'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const bridgeStart = source.indexOf('globalThis.__tomatoReminder = {');
const bridgeEnd = source.indexOf('\n    async function __getReminderTaskContext', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, 'Tomato reminder bridge must remain extractable');
const bridge = source.slice(bridgeStart, bridgeEnd);

assert.match(bridge, /version:\s*1/, 'reminder bridge must publish a version');
for (const method of ['get', 'upsert', 'remove', 'setOccurrenceDone', 'taskContextChanged']) {
    assert.match(bridge, new RegExp(`\\b${method}:`), `reminder bridge must expose ${method}`);
}
assert.match(bridge, /upsert:[\s\S]*?saveBlockReminder\(/, 'upsert must delegate persistence to the Tomato writer');
assert.match(bridge, /remove:[\s\S]*?deleteBlockReminder\(/, 'remove must delegate cleanup to the Tomato writer');
assert.match(bridge, /action:\s*'mirror-cleanup'/, 'canonical writes must clean a stale task-block reminder mirror');

const markStart = source.indexOf('const __markReminderOccurrenceCompleted = async');
const markEnd = source.indexOf('\n    const __recordFollowTaskReminderCompletionOwner', markStart);
assert.ok(markStart >= 0 && markEnd > markStart, 'occurrence completion block must remain extractable');
const markBlock = source.slice(markStart, markEnd);
assert.match(markBlock, /const alreadyCompleted = set\.has\(k\)/, 'completion must detect an already applied occurrence');
assert.match(markBlock, /if \(alreadyCompleted\) return true;[\s\S]*?__syncTaskCompletionFromReminder\(/, 'an already completed occurrence must return before requesting task completion again');

const completeFollowStart = source.indexOf('const __completeFollowTaskReminder = async');
const completeFollowEnd = source.indexOf('\n    const __getReminderScheduleEffectiveAtMs', completeFollowStart);
const completeFollowBlock = source.slice(completeFollowStart, completeFollowEnd);
assert.match(completeFollowBlock, /skipTaskSync:\s*true/, 'task-originated completion must not loop back into Task Horizon');

const refreshStart = source.indexOf('async function __refreshReminderAfterTaskContextChanged');
const refreshEnd = source.indexOf('\n    // 手动触发检查', refreshStart);
const refreshBlock = source.slice(refreshStart, refreshEnd);
assert.match(refreshBlock, /__syncReminderDeviceSchedule\(/, 'task date changes must reconcile device notifications');
assert.match(refreshBlock, /scheduleWechatReminderReconcile\(/, 'task date changes must reconcile WeChat reminders');

assert.doesNotMatch(source, /__syncReminderLoopToTaskRepeat/, 'Tomato must not keep a second direct task-repeat writer');
assert.match(source, /bridge\.applyFollowDraft\(/, 'follow reminder edits must use Task Horizon bridge v2');
assert.match(source, /任务提醒联动接口未就绪/, 'missing bridge v2 must fail explicitly instead of downgrading to independent mode');

const clearStart = source.indexOf('const __clearFollowTaskReminderDraft = async');
const clearEnd = source.indexOf('\n    const __saveReminderDraft', clearStart);
assert.ok(clearStart >= 0 && clearEnd > clearStart, 'follow reminder cleanup adapter must remain extractable');
const clearBlock = source.slice(clearStart, clearEnd);
assert.match(clearBlock, /bridge\.clearFollowDraft\(/, 'follow reminder deletion must use Task Horizon bridge v2');

const deleteStart = source.indexOf('async function deleteBlockReminder');
const deleteEnd = source.indexOf('\n    async function queryAllReminderBlocks', deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'reminder deletion block must remain extractable');
const deleteBlock = source.slice(deleteStart, deleteEnd);
assert.match(deleteBlock, /__clearFollowTaskReminderDraft\(reminderId, existingReminder\)/, 'all reminder deletion paths must enter follow-task cleanup');
assert.ok(deleteBlock.indexOf('__clearFollowTaskReminderDraft(') < deleteBlock.indexOf("'/api/attr/setBlockAttrs'"), 'task-linked fields must be cleared before the reminder record');

(async () => {
    let followClearCalls = 0;
    const clearContext = vm.createContext({
        REMINDER_REPEAT_MODE_FOLLOW_TASK: 'follow-task',
        __getReminderRepeatMode: (value) => value?.repeatMode || 'manual',
        getTaskHorizonSharedApi: () => ({
            reminderBridge: {
                version: 2,
                clearFollowDraft: async (payload) => {
                    followClearCalls += 1;
                    return { ok: true, changed: true, payload };
                },
            },
        }),
    });
    vm.runInContext(`${clearBlock}\nthis.clearFollowTaskDraft = __clearFollowTaskReminderDraft;`, clearContext);
    const independentClear = await clearContext.clearFollowTaskDraft('task-1', { repeatMode: 'manual' });
    assert.equal(independentClear.skipped, true, 'independent reminder deletion must not touch task fields');
    assert.equal(followClearCalls, 0);
    const followClear = await clearContext.clearFollowTaskDraft('host-1', {
        repeatMode: 'follow-task',
        taskId: 'task-1',
        blockId: 'host-1',
    });
    assert.equal(followClear.ok, true);
    assert.equal(followClearCalls, 1, 'follow reminder deletion must clear task fields exactly once');
    assert.equal(followClear.payload.taskId, 'task-1');

    let reminder = { blockId: 'task-1', completedOccurrences: [] };
    let saveCount = 0;
    let taskSyncCount = 0;
    const context = vm.createContext({
        Date,
        __reminderOccurrenceKey: (dateKey, timeKey) => `${dateKey} ${timeKey}`,
        getBlockReminder: async () => reminder,
        __getReminderCompletedSet: (value) => new Set((value.completedOccurrences || []).map((item) => `${item.date} ${item.time}`)),
        __cancelReminderOccurrenceNotifications: async () => {},
        saveBlockReminder: async (_blockId, next) => {
            saveCount += 1;
            reminder = next;
            return true;
        },
        __syncReminderDeviceSchedule: async () => {},
        refreshReminderDockPanel: () => {},
        updateReminderBadge: () => {},
        __syncTaskCompletionFromReminder: async () => {
            taskSyncCount += 1;
            return true;
        },
    });
    vm.runInContext(`${markBlock}\nthis.markOccurrenceDone = __markReminderOccurrenceCompleted;`, context);

    assert.equal(await context.markOccurrenceDone('task-1', '2026-07-18', '09:00'), true);
    assert.equal(saveCount, 1, 'a new occurrence must be persisted once');
    assert.equal(taskSyncCount, 1, 'a new occurrence must request task completion once');

    assert.equal(await context.markOccurrenceDone('task-1', '2026-07-18', '09:00'), true);
    assert.equal(saveCount, 1, 'repeating the same completion must not write again');
    assert.equal(taskSyncCount, 1, 'repeating the same completion must not request task completion again');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
