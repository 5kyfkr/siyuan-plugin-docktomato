'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tomato.js'), 'utf8');
const between = (a, b) => {
    const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
    assert.ok(start >= 0 && end > start, a);
    return source.slice(start, end);
};
const clone = value => JSON.parse(JSON.stringify(value));
let current = 'round-1', advances = 0, taskFails = false, saveFails = false, restores = 0;
let stored = { blockId: 'task', taskId: 'task', repeatMode: 'followTaskRepeat', interval: 'once', trigger: 'due',
    startDate: '2026-09-12', taskCompletionTime: '2026-09-12', taskRepeatRule: { enabled: true, trigger: 'complete', type: 'daily' },
    times: ['09:00', '18:00'], completedOccurrences: [], taskCompletionOwner: null };
const receipts = new Map();
const bridge = {
    capabilities: { completionReceipt: true, restoreCompletion: true },
    async completeFromReminder(payload) {
        if (taskFails) return { ok: false };
        if (receipts.has(payload.taskOccurrenceId)) return { ok: true, completion: { ...receipts.get(payload.taskOccurrenceId), outcome: 'alreadyApplied' } };
        if (payload.taskOccurrenceId !== current) return { ok: false };
        advances++;
        const completion = { taskId: 'task', operationId: payload.operationId, completionId: 'completion-' + advances,
            occurrenceId: current, completedAt: '2026-09-11T01:00:00.123Z', previousDates: { completionTime: '2026-09-12' }, nextDates: { completionTime: '2026-09-12' }, outcome: 'committed' };
        receipts.set(current, completion);
        current = 'round-' + (advances + 1);
        return { ok: true, completion };
    },
    async restoreCompletion(payload) {
        restores++;
        current = 'restored-round';
        // A real task receipt calls Tomato back. This must not deadlock with
        // the reminder's own mutation lane.
        await context.restore('task', { restoredCompletionId: payload.owner.completionId });
        return { ok: true };
    },
};
const context = vm.createContext({ Date, String, Number, Array, Set, Map, Promise, Object, JSON,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat', REMINDER_REPEAT_MODE_MANUAL: 'manual',
    getTaskHorizonSharedApi: () => ({ reminderBridge: bridge }),
    __normalizeReminderTaskRepeatState: value => ({ occurrenceCount: 1, lastAdvancedAt: '', lastCompletedAt: '', ...(value || {}) }),
    __normalizeReminderTaskCompletionOwner: value => value,
    __getReminderRepeatMode: value => value.repeatMode,
    __getReminderScheduleSignature: value => value.signature || 'current-schedule',
    __isFollowTaskCheckinReminder: () => false,
    __getReminderCompletedOccurrences: value => value.completedOccurrences || [],
    __reminderOccurrenceKey: (date, time) => date + ' ' + time,
    __parseTime: value => ({ key: value }),
    getBlockReminder: async () => ({ ...clone(stored), taskRepeatState: { occurrenceId: current } }),
    saveBlockReminder: async (_id, value) => { if (saveFails) return false; stored = clone(value); return true; },
    __syncReminderDeviceSchedule: async () => {},
    Logger: { warn() {} },
});
vm.runInContext([
    between('const __getFollowTaskOccurrenceId =', 'const __getReminderExcludedSet ='),
    between('const __reminderOccurrenceMutations =', 'const __recordFollowTaskReminderCompletionOwner ='),
    between('const __restoreFollowTaskReminderCompletion =', 'const __canUndoReminderCompletionEntry ='),
    between('const __canUndoReminderCompletionEntry =', 'const isRemindersGloballyEnabled ='),
    between('const __restoreReminderTaskCompletion =', 'const __getReminderCompletionDateKey ='),
    'this.mark = __markReminderOccurrenceCompleted; this.undo = __unmarkReminderOccurrenceCompleted; this.restore = __restoreReminderTaskCompletion; this.completed = __getReminderCompletedSet;',
].join('\n'), context);
async function run() {
    const old = { taskOccurrenceId: current };
    assert.equal(await context.mark('task', '2026-09-12', '09:00', { ...old, scheduleSignature: 'stale-schedule' }), false);
    assert.equal(advances, 0, 'an old view of edited reminder times must not complete the current task round');
    taskFails = true;
    assert.equal(await context.mark('task', '2026-09-12', '09:00', old), false);
    assert.equal(stored.completedOccurrences.length, 0, 'task failure cannot be reported as a completed reminder');
    taskFails = false; saveFails = true;
    assert.equal(await context.mark('task', '2026-09-12', '09:00', old), false);
    assert.equal(advances, 1);
    saveFails = false;
    assert.equal(await context.mark('task', '2026-09-12', '09:00', old), true);
    assert.equal(advances, 1, 'retry must repair the reminder without consuming the next task round');
    assert.equal(stored.completedOccurrences.length, 2, 'the task receipt settles the old round times together');
    const nextRoundReminder = { ...stored, taskRepeatState: { occurrenceId: current } };
    assert.equal(context.completed(nextRoundReminder).size, 0, 'the same date in a new round must remain unfinished');
    const oldRoundReminder = { ...stored, taskRepeatState: { occurrenceId: old.taskOccurrenceId } };
    assert.equal(context.completed(oldRoundReminder).size, 2);
    await Promise.race([
        context.undo('task', '2026-09-12', '09:00', old).then(value => assert.equal(value, true)),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('cross-lane deadlock')), 1000); timer.unref(); }),
    ]);
    assert.equal(restores, 1);
    assert.equal(stored.completedOccurrences.length, 0);
    assert.equal(stored.taskCompletionOwner, null);
    console.log('follow reminder receipt, retry, same-date matching and undo behavior passed');
}
async function testTimerSession() {
    let settlements = 0, clears = 0, fail = true;
    const timer = vm.createContext({ String, Object,
        syncState: { activeTimer: { sessionId: 'new-timer' } },
        getEffectiveTaskAssociation: () => ({ taskBlockId: 'task' }),
        timerMode: 'countdown', hasActiveTimerSegment: () => true,
        currentTaskBlockId: 'task', currentTaskBlockName: 'Task', currentDatabaseBlockId: '', focusRestoreSource: '',
        isRunning: true, isTimerPaused: false, lastCompletedAssociationFocusSnapshot: null,
        completeCurrentTomato: async () => { settlements++; if (fail) throw new Error('disk failed'); },
        setTaskAssociation: async () => { clears++; },
        clearTaskBlockHighlight() {}, stopHighlightKeepAlive() {}, updateTaskBlockIcon() {}, updateTaskBlockTooltip() {}, updateDisplay() {},
        Logger: { warn() {} },
    });
    vm.runInContext(between('async function stopAssociatedTaskAfterDone(', 'function createButtonGroup('), timer);
    for (const expectedSessionId of ['old-timer', '']) {
        const stale = await timer.stopAssociatedTaskAfterDone('task', { expectedSessionId });
        assert.equal(stale.reason, 'stale-session');
    }
    assert.equal(settlements, 0, 'a late task completion cannot stop a newer focus session');
    const failed = await timer.stopAssociatedTaskAfterDone('task', { expectedSessionId: 'new-timer' });
    assert.equal(failed.reason, 'timer-settle-failed');
    assert.equal(clears, 0, 'failed accounting must retain the task association for recovery');
    fail = false;
    const completed = await timer.stopAssociatedTaskAfterDone('task', { expectedSessionId: 'new-timer' });
    assert.equal(completed.stopped, true);
    assert.equal(clears, 1);
}
Promise.all([run(), testTimerSession()]).catch(error => { console.error(error); process.exitCode = 1; });
