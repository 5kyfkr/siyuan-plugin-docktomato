'use strict';

const assert = require('node:assert/strict');
const stats = require('../kernel.js');

const records = Array.from({ length: 1000 }, (_, index) => ({
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:25:00.000Z',
    durationSec: 1500,
    mode: 'countdown',
    sessionId: `session-${index}`,
    taskBlockId: `task-${index}`,
}));
const options = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-03-02T00:00:00.000Z',
    bucket: 'day',
};

const started = Date.now();
const result = stats.queryFocus(records, options);
const elapsedMs = Date.now() - started;
const associationBucketCount = result.associations.reduce((sum, item) => sum + item.buckets.length, 0);
const serializedBytes = Buffer.byteLength(JSON.stringify(result));

assert.equal(result.associations.length, 1000);
assert.equal(associationBucketCount, 1000, 'association buckets must be sparse rather than association x range');
assert.ok(serializedBytes < 3 * 1024 * 1024, `statistics payload is too large: ${serializedBytes}`);
assert.ok(elapsedMs < 1000, `statistics aggregation is unexpectedly slow: ${elapsedMs}ms`);

const totalsOnly = stats.queryFocus(records, { ...options, includeAssociations: false });
assert.deepEqual(totalsOnly.associations, []);
assert.equal(totalsOnly.totals.focusSessionCount, 1000);

const scoped = stats.queryFocus(records, { ...options, candidateIDs: ['task-9'] });
assert.equal(scoped.associations.length, 1);
assert.deepEqual(scoped.associations[0].candidateIds, ['task-9']);
assert.equal(scoped.totals.focusSessionCount, 1000,
    'candidate filtering must retain legacy global totals unless scoped totals are explicitly requested');

const scopedTotals = stats.queryFocus(records, {
    ...options,
    candidateIDs: ['task-9'],
    candidateIDsConstrainTotals: true,
});
assert.equal(scopedTotals.associations.length, 1);
assert.equal(scopedTotals.totals.focusSessionCount, 1,
    'scoped totals must exclude unrelated sessions before aggregation');
assert.equal(Math.round(scopedTotals.totals.focusSec), 1500);
const emptyScopedTotals = stats.queryFocus(records, {
    ...options,
    candidateIDs: [],
    candidateIDsConstrainTotals: true,
});
assert.equal(emptyScopedTotals.totals.sessionCount, 0,
    'an explicitly empty scoped query must produce zero totals');
assert.deepEqual(emptyScopedTotals.associations, []);

const ordered = stats.queryFocus([
    { ...records[0], start: '2026-01-02T00:00:00.000Z', end: '2026-01-02T00:25:00.000Z', taskBlockId: 'ordered-task' },
    { ...records[0], start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T00:25:00.000Z', taskBlockId: 'ordered-task' },
], options);
assert.deepEqual(ordered.associations[0].buckets.map((item) => item.key), ['2026-01-01', '2026-01-02']);

assert.throws(() => stats.queryFocus([], {
    from: '2020-01-01T00:00:00.000Z',
    to: '2025-01-01T00:00:00.000Z',
    bucket: 'hour',
}), (error) => error?.code === 'STATS_RANGE_TOO_LARGE');

const longAssociationRecords = Array.from({ length: 100 }, (_, index) => ({
    start: '2026-01-01T00:00:00.000Z',
    end: '2027-01-01T00:00:00.000Z',
    durationSec: 365 * 24 * 60 * 60,
    mode: 'stopwatch',
    sessionId: `long-session-${index}`,
    taskBlockId: `long-task-${index}`,
}));
assert.throws(() => stats.queryFocus(longAssociationRecords, {
    from: '2026-01-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
    bucket: 'day',
}), (error) => error?.code === 'STATS_RESULT_TOO_LARGE' && error?.details?.maxResultCells === 10000,
'association x bucket output must fail before allocating an oversized result');

const longRoutineRecords = Array.from({ length: 100 }, (_, index) => ({
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-03-02T00:00:00.000Z',
    durationSec: 60 * 24 * 60 * 60,
    mode: 'stopwatch',
    routineButtonId: `long-routine-${index}`,
    routineButtonGroupId: `long-group-${index}`,
}));
assert.throws(() => stats.queryRoutine(longRoutineRecords, {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-03-02T00:00:00.000Z',
    bucket: 'day',
}), (error) => error?.code === 'STATS_RESULT_TOO_LARGE' && error?.details?.maxResultCells === 10000,
'routine bucket output must fail before allocating an oversized result');

const stressOptions = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
    bucket: 'day',
};
const stressAggregator = stats.createFocusAggregator(stressOptions);
for (let index = 0; index < 50000; index += 1) {
    stressAggregator.add({
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T00:01:00.000Z',
        durationSec: 60,
        mode: 'stopwatch',
        sessionId: `stress-${index}`,
        taskBlockId: 'stress-task',
    });
}
const stressResult = stressAggregator.finish();
const stressPayload = JSON.stringify(stressResult);
assert.equal(stressResult.totals.sessionCount, 50000);
assert.equal(stressResult.associations.length, 1);
assert.ok(!stressPayload.includes('sessionKeys'), 'v2 payload must not copy session identifiers');
assert.ok(Buffer.byteLength(stressPayload) < 16 * 1024, 'same-cell session volume must not inflate the DTO');
assert.throws(() => stressAggregator.add({
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:01:00.000Z',
    durationSec: 60,
    mode: 'stopwatch',
    sessionId: 'stress-over-limit',
    taskBlockId: 'stress-task',
}), (error) => error?.code === 'STATS_SESSION_LIMIT_EXCEEDED'
    && error?.details?.maxUniqueSessions === 50000);

const scopedStressAggregator = stats.createFocusAggregator({
    ...stressOptions,
    candidateIDs: ['scoped-target'],
    candidateIDsConstrainTotals: true,
});
for (let index = 0; index < 50000; index += 1) {
    scopedStressAggregator.add({
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T00:01:00.000Z',
        durationSec: 60,
        mode: 'stopwatch',
        sessionId: `unrelated-${index}`,
        taskBlockId: `unrelated-task-${index}`,
    });
}
scopedStressAggregator.add({
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:01:00.000Z',
    durationSec: 60,
    mode: 'stopwatch',
    sessionId: 'scoped-target-session',
    taskBlockId: 'scoped-target',
});
const scopedStressResult = scopedStressAggregator.finish();
assert.equal(scopedStressResult.totals.sessionCount, 1,
    'unrelated unique sessions must not consume the scoped session-map budget');
assert.equal(scopedStressResult.associations.length, 1);

const scanBudgetAggregator = stats.createFocusAggregator(stressOptions);
for (let index = 0; index < 250000; index += 1) scanBudgetAggregator.add(null);
assert.throws(() => scanBudgetAggregator.add(null), (error) => error?.code === 'STATS_SCAN_LIMIT_EXCEEDED'
    && error?.details?.maxScannedRecords === 250000);

const multiAssociationSession = stats.queryFocus([
    { ...records[0], sessionId: 'multi-task', taskBlockId: 'task-a' },
    {
        ...records[0],
        start: '2026-01-01T00:25:00.000Z',
        end: '2026-01-01T00:50:00.000Z',
        sessionId: 'multi-task',
        taskBlockId: 'task-b',
    },
], options);
assert.equal(multiAssociationSession.totals.sessionCount, 1, 'a stopwatch session split across tasks remains one total session');
assert.equal(multiAssociationSession.associations.length, 2, 'each task segment must retain its own duration association');
assert.deepEqual(multiAssociationSession.associations.map((item) => item.sessionCount), [1, 1],
    'each participating task must retain one association-level session');
assert.equal(multiAssociationSession.meta.multiAssociationSessionCount, 1,
    'multi-task sessions must be visible as bounded diagnostic metadata instead of failing the query');

const multiYear = stats.queryFocus([], {
    from: '2020-01-01T00:00:00.000Z',
    to: '2025-01-01T00:00:00.000Z',
    bucket: 'day',
});
assert.ok(multiYear.buckets.length > 1800, 'multi-year daily queries must remain supported within the bucket budget');

console.log(`stats performance contract tests passed (${elapsedMs}ms, ${serializedBytes} bytes)`);
