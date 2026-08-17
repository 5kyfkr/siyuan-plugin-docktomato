const assert = require('node:assert/strict');
const stats = require('../kernel.js');

const from = '2026-01-05T00:00:00+08:00';
const to = '2026-01-07T00:00:00+08:00';
const records = [
    {
        start: '2026-01-05T23:50:00+08:00',
        end: '2026-01-06T00:10:00+08:00',
        durationSec: 600,
        durationMin: 20,
        mode: 'countdown',
        sessionId: 'shared',
        plannedDuration: 25,
        isCompleted: true,
        distractionCount: 2,
        taskBlockId: 'task-a',
    },
    {
        start: '2026-01-06T00:10:00+08:00',
        end: '2026-01-06T00:20:00+08:00',
        durationSec: 600,
        mode: 'break',
        sessionId: 'shared',
        isCompleted: true,
        taskBlockId: 'task-a',
    },
    {
        start: '2026-01-06T10:00:00+08:00',
        end: '2026-01-06T10:30:00+08:00',
        durationMin: 30,
        mode: 'stopwatch',
        distractionCount: 1,
        databaseBlockId: 'task-b',
    },
];

const focus = stats.queryFocus(records, { from, to, bucket: 'day' });
assert.equal(focus.contractVersion, 2);
assert.equal(Object.hasOwn(focus.totals, 'sessionKeys'), false, 'v2 must not expose session key arrays');
assert.equal(Math.round(focus.totals.countdownSec), 600, 'durationSec must win over durationMin');
assert.equal(Math.round(focus.totals.stopwatchSec), 1800);
assert.equal(Math.round(focus.totals.breakSec), 600);
assert.equal(focus.totals.focusSessionCount, 2);
assert.equal(focus.totals.breakSessionCount, 1, 'break reusing a focus session id must remain separate');
assert.equal(focus.totals.distractionCount, 3);
assert.equal(focus.buckets.length, 2);
assert.equal(Math.round(focus.buckets[0].countdownSec), 300);
assert.equal(Math.round(focus.buckets[1].countdownSec), 300);
assert.equal(focus.buckets[0].countdownSessionCount, 0, 'a cross-day session count belongs to its end day only');
assert.equal(focus.buckets[1].countdownSessionCount, 1);
assert.equal(focus.buckets[0].plannedCountdownMin, 0);
assert.equal(focus.buckets[1].plannedCountdownMin, 25, 'planned minutes must not be duplicated across buckets');
assert.equal(focus.associations.length, 2);
assert.deepEqual(focus.associations[0].candidateIds, ['task-a']);

const sessions = stats.listSessions(records, { from, to, limit: 2 });
assert.equal(sessions.total, 3);
assert.equal(sessions.items.length, 2);
assert.equal(sessions.nextCursor, 2);

const routine = stats.queryRoutine([
    {
        start: '2026-01-05T10:00:00+08:00',
        end: '2026-01-05T11:00:00+08:00',
        durationSec: 3600,
        mode: 'stopwatch',
        routineButtonId: 'routine-a',
        routineButtonName: '阅读',
        routineButtonGroupId: 'growth',
    },
    {
        start: '2026-01-05T10:30:00+08:00',
        end: '2026-01-05T11:30:00+08:00',
        durationSec: 3600,
        mode: 'countdown',
        routineButtonId: 'routine-b',
        routineButtonName: '写作',
        routineButtonGroupId: 'growth',
    },
], {
    from: '2026-01-05T10:00:00+08:00',
    to: '2026-01-05T12:00:00+08:00',
    bucket: 'hour',
    routineGroups: [{ id: 'growth', name: '成长' }],
    routineButtons: [
        { id: 'routine-a', name: '阅读', groupId: 'growth' },
        { id: 'routine-b', name: '写作', groupId: 'growth' },
    ],
});
assert.equal(routine.groups[0].label, '成长');
assert.equal(Math.round(routine.groups[0].totalSec), 7200);
assert.equal(Math.round(routine.totals.coveredSec), 5400, 'covered time must use interval union');
assert.equal(Math.round(routine.totals.unrecordedSec), 1800);
assert.equal(routine.buckets.length, 2);
assert.equal(Math.round(routine.buckets[0].totals.coveredSec), 3600);
assert.equal(Math.round(routine.buckets[1].totals.coveredSec), 1800);

const legacy = stats.queryFocus([{
    start: '2026-01-05T12:00:00+08:00',
    end: '2026-01-05T12:10:00+08:00',
    durationMin: 10,
    mode: 'countdown',
}, {
    start: '2026-01-05T12:20:00+08:00',
    end: '2026-01-05T12:30:00+08:00',
    durationMin: 10,
    mode: 'countdown',
}], { from, to });
assert.equal(legacy.totals.countdownSessionCount, 2, 'legacy records without session ids remain independent');

console.log('stats core contract tests passed');
