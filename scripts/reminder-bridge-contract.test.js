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

assert.match(bridge, /version:\s*2/, 'reminder bridge must publish subscription-capable v2');
for (const method of ['get', 'upsert', 'upsertDraft', 'remove', 'setOccurrenceDone', 'taskContextChanged', 'listOccurrences']) {
    assert.match(bridge, new RegExp(`\\b${method}:`), `reminder bridge must expose ${method}`);
}
assert.match(bridge, /capabilities:[\s\S]*?listOccurrences:\s*true/, 'v2 bridge must advertise occurrence projection');
assert.match(bridge, /capabilities:[\s\S]*?draftDialog:\s*true/, 'reminder bridge must advertise pre-create draft dialogs');
assert.match(bridge, /capabilities:[\s\S]*?upsertDraft:\s*true/, 'reminder bridge must advertise draft persistence');
assert.match(bridge, /listOccurrences:\s*__listReminderOccurrencesForSubscription/, 'subscription projection must use the read-only occurrence adapter');
assert.match(bridge, /upsert:[\s\S]*?saveBlockReminder\(/, 'upsert must delegate persistence to the Tomato writer');
assert.match(bridge, /dialogOptions\.draft\s*===\s*true[\s\S]*?showReminderDialog\('',/, 'draft dialog must not require a block ID');
assert.match(bridge, /upsertDraft:[\s\S]*?__saveReminderDraft\(/, 'draft persistence must reuse the existing Tomato draft writer');
assert.match(source, /if \(isDraftMode\)[\s\S]*?closeDialog\(\{\s*action:\s*'save'/, 'draft dialog save must return data instead of persisting directly');
assert.match(bridge, /remove:[\s\S]*?deleteBlockReminder\(/, 'remove must delegate cleanup to the Tomato writer');
assert.doesNotMatch(bridge, /mirror-cleanup|preferDirect/, 'task reminder bridge must not bypass canonical task storage');

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
assert.match(refreshBlock, /refreshReminderDockPanel\(options\?\.forceRefresh === true\)/,
    'local task context changes must refresh immediately without forcing cloud sync and a fixed delay');
assert.ok(refreshBlock.indexOf('__invalidateReminderDockCache()') < refreshBlock.indexOf('refreshReminderDockPanel('),
    'task date changes must invalidate the Dock data cache before rendering');

assert.doesNotMatch(source, /__syncReminderLoopToTaskRepeat/, 'Tomato must not keep a second direct task-repeat writer');
assert.match(source, /bridge\.applyFollowDraft\(/, 'follow reminder edits must use Task Horizon bridge v2');
const applyFollowStart = source.indexOf('const __applyFollowTaskReminderDraft = async');
const applyFollowEnd = source.indexOf('\n    const __clearFollowTaskReminderDraft', applyFollowStart);
const applyFollowBlock = source.slice(applyFollowStart, applyFollowEnd);
assert.doesNotMatch(applyFollowBlock, /repeatRule:/, 'a reminder draft must not send task-owned repeat rules back to Task Horizon');
assert.match(source, /任务提醒联动接口未就绪/, 'missing bridge v2 must fail explicitly instead of downgrading to independent mode');

const subscriptionStart = source.indexOf('const __listReminderOccurrencesForSubscription = async');
const subscriptionEnd = source.indexOf('\n    const __getLastDueReminderDateTime', subscriptionStart);
assert.ok(subscriptionStart >= 0 && subscriptionEnd > subscriptionStart, 'subscription occurrence adapter must remain extractable');
const subscriptionBlock = source.slice(subscriptionStart, subscriptionEnd);
assert.match(subscriptionBlock, /queryAllReminderBlocks\(false,\s*\{[\s\S]*?throwOnError:\s*true,[\s\S]*?excludeCompletedTaskBlocks:\s*true,[\s\S]*?limit:\s*20000/, 'subscription reads must fail closed, exclude completed task blocks, and avoid the short UI query');
assert.match(subscriptionBlock, /getNextReminderDateTime\(reminder, cursor\)/, 'subscription projection must reuse authoritative reminder recurrence logic');
assert.match(subscriptionBlock, /stableIdentity/, 'follow-task current occurrences must expose a stable ICS identity');
assert.match(subscriptionBlock, /truncated:\s*true/, 'subscription projection must report truncation instead of silently dropping instances');
assert.match(source, /tomato-reminder-updated/, 'reminder writes must notify the calendar subscription publisher');
assert.match(source, /const __isCompletedReminderTaskBlockRow[\s\S]*?\^\[xX\]\$/, 'completed task rows must be recognized before malformed reminder JSON is parsed');

const completedRowStart = source.indexOf('const __isCompletedReminderTaskBlockRow =');
const completedRowEnd = source.indexOf('\n    const __sanitizeReminderData', completedRowStart);
assert.ok(completedRowStart >= 0 && completedRowEnd > completedRowStart, 'completed task row guard must remain extractable');
const completedRowContext = vm.createContext({});
vm.runInContext(`${source.slice(completedRowStart, completedRowEnd)}\nthis.isCompletedRow = __isCompletedReminderTaskBlockRow;`, completedRowContext);
assert.equal(completedRowContext.isCompletedRow({ type: 'i', markdown: '- [X] 已完成任务' }), true);
assert.equal(completedRowContext.isCompletedRow({ type: 'i', markdown: '- [ ] 未完成任务' }), false);
assert.equal(completedRowContext.isCompletedRow({ type: 'p', markdown: '- [X] 普通段落' }), false);

const clearStart = source.indexOf('const __clearFollowTaskReminderDraft = async');
const clearEnd = source.indexOf('\n    const __saveReminderDraft', clearStart);
assert.ok(clearStart >= 0 && clearEnd > clearStart, 'follow reminder cleanup adapter must remain extractable');
const clearBlock = source.slice(clearStart, clearEnd);
assert.match(clearBlock, /bridge\.clearFollowDraft\(/, 'follow reminder deletion must use the ownership-safe Task Horizon detach bridge');

const deleteStart = source.indexOf('async function deleteBlockReminder');
const deleteEnd = source.indexOf('\n    async function queryAllReminderBlocks', deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'reminder deletion block must remain extractable');
const deleteBlock = source.slice(deleteStart, deleteEnd);
assert.match(deleteBlock, /__clearFollowTaskReminderDraft\(reminderId, existingReminder\)/, 'all reminder deletion paths must enter follow-task cleanup');
assert.ok(deleteBlock.indexOf('__clearFollowTaskReminderDraft(') < deleteBlock.indexOf("'/api/attr/setBlockAttrs'"), 'the ownership-safe detach must run before removing the reminder record');

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
    assert.equal(followClearCalls, 1, 'follow reminder deletion must request an ownership-safe detach exactly once');
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
