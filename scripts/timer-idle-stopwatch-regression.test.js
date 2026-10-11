'use strict';

const assert = require('node:assert/strict');
const { setup, call } = require('./external-focus-api.test');
const { attachManualCompletion } = require('./timer-manual-completion.test');
const { extract } = require('./timer-journal-queue.test');
const clone = value => JSON.parse(JSON.stringify(value));
const cases = [];

function attachProductionPersistence(r) {
    call(r, extract('    function restoreCommittedTimerRuntime()', '    async function startTimer('));
    call(r, extract('    function waitForTimerPersistence(', '    function hasExactHistoryDuplicate('));
    call(r, extract('    function isLegacyTimerStateSnapshot(', '    async function recordEndTime('));
}

function assertCleanIdle(state) {
    assert.equal(state.status, 'IDLE');
    assert.equal(state.activeTimer, null);
    assert.equal(state.startTime, null);
    assert.equal(state.stopwatchStartTimeMs, null);
    assert.equal(state.stopwatchDisplayOffset, 0);
    assert.equal(state.currentPauseStart, null);
    assert.equal(state.pausedElapsedSeconds, null);
    assert.deepEqual(Array.from(state.pausedIntervals), []);
}

function dirtyIdle(r, schemaVersion = 2) {
    return {
        ...clone(r.api.manager.getState()),
        stateSchemaVersion: schemaVersion,
        status: 'IDLE', activeTimer: null, mode: 'stopwatch', duration: 0,
        startTime: r.context.Date.now() - 3600000,
        stopwatchStartTimeMs: r.context.Date.now() - 3600000,
        stopwatchDisplayOffset: 120,
        pausedElapsedSeconds: 20, currentPauseStart: r.context.Date.now() - 60000,
        pausedIntervals: [{ start: 1, end: 1001 }],
        sequenceId: 10, stateVersion: 10,
        lastModifiedTime: r.context.Date.now() + 10000,
        lastModifiedDevice: 'device-b', lastCommittedTransitionId: 'association_existing',
    };
}

(async () => {
    for (const syncEnabled of [true, false]) {
        for (const ending of ['resetCurrentMode()', 'completeCurrentTimer()', 'stopTimer()']) {
            const r = setup(false, 'stopwatch', undefined, { sync: syncEnabled });
            attachManualCompletion(r);
            attachProductionPersistence(r);
            const committedIdleStates = [];
            const execute = r.api.executor.execute.bind(r.api.executor);
            r.api.executor.execute = async (command, builder) => {
                const result = await execute(command, builder);
                if (result.state?.status === 'IDLE') committedIdleStates.push(clone(result.state));
                return result;
            };
            await r.timer.toggle();
            r.timer.advance(3600);
            await call(r, ending);
            assert.ok(committedIdleStates.length > 0);
            for (const state of committedIdleStates) assertCleanIdle(state);
            assertCleanIdle(JSON.parse(r.storage.file).nextState);
            assert.equal(r.api.journal.queuedHistory()[0].durationMs, 3600);
            r.timer.advance(60000);
            call(r, 'syncState = SyncManager.getState(); updateFromSyncState();');
            assert.equal(r.context.elapsedSeconds, 0);
            assert.equal(r.context.stopwatchDisplayOffset, 0);
            await call(r, 'resetCurrentMode()');
            assert.equal(r.api.journal.queuedHistory().length, 1, 'idle completion must not add a ghost record');
            const nextStartMs = r.context.Date.now();
            await r.timer.toggle();
            assert.equal(r.api.manager.getState().activeTimer.startedAtMs, nextStartMs);
            assert.equal(r.api.manager.getState().startTime, nextStartMs);
            cases.push({ name: `${ending}, sync=${syncEnabled}`, outcome: 'first IDLE commit clean; refresh zero; repeated completion safe; restart fresh; history 3.6s' });
        }
    }

    for (const schemaVersion of [1, 2]) {
        const r = setup(false, 'stopwatch');
        const dirty = dirtyIdle(r, schemaVersion);
        dirty.continuation = { focusSessionId: 'retained-focus', focusTimerSnapshot: { status: 'PAUSED', accumulatedMs: 123000 } };
        dirty.taskBlockId = 'retained-task';
        dirty.taskBlockName = 'Task';
        dirty.integrationEnvelope = { taskAssociation: { taskBlockId: 'retained-task', taskBlockName: 'Task', databaseBlockId: null } };
        const original = clone(dirty);
        const clean = call(r, `prepareCanonicalStateForSync(${JSON.stringify(dirty)})`);
        assertCleanIdle(clean);
        assert.equal(clean.mode, 'stopwatch');
        assert.equal(clean.duration, 0);
        assert.equal(clean.sequenceId, dirty.sequenceId);
        assert.equal(clean.lastModifiedTime, dirty.lastModifiedTime);
        assert.equal(clean.integrationEnvelope.taskAssociation.taskBlockId, 'retained-task');
        assert.equal(clean.continuation.focusTimerSnapshot.accumulatedMs, 123000);
        assert.deepEqual(dirty, original);
        assert.deepEqual(clone(call(r, `prepareCanonicalStateForSync(${JSON.stringify(clean)})`)), clone(clean), 'normalization must be idempotent');
        assert.equal(call(r, `StateCalculator.calculateElapsed(${JSON.stringify(dirty)})`), 0, 'raw old IDLE must not accumulate');
        cases.push({ name: `dirty idle schema=${schemaVersion}`, outcome: 'normalized without changing mode, duration, metadata, associations or continuation; raw elapsed zero' });
    }

    for (const syncEnabled of [true, false]) {
        const r = setup(false, 'stopwatch', undefined, { sync: syncEnabled });
        attachManualCompletion(r);
        attachProductionPersistence(r);
        const old = dirtyIdle(r);
        r.storage.file = JSON.stringify({ schemaVersion: 3, revision: 1, nextState: old, operations: [] });
        const recovery = await r.api.executor.recoverJournal({ deferNetwork: true });
        assert.equal(recovery.blocking, false);
        assertCleanIdle(r.api.manager.getState());
        call(r, 'applyAcceptedSyncStateToTimer(SyncManager.getState());');
        assert.equal(r.context.elapsedSeconds + r.context.stopwatchDisplayOffset, 0);
        await call(r, 'resetCurrentMode()');
        assert.equal(r.api.journal.queuedHistory().length, 0);
        // A read does not force a new synchronized write. The next genuine
        // business transition must persist the normalized snapshot.
        await r.api.executor.execute({ transitionId: 'association_clean', deferNetwork: true }, latest => ({
            ...latest, integrationEnvelope: { ...latest.integrationEnvelope, taskAssociation: { taskBlockId: 'task-new', taskBlockName: 'New', databaseBlockId: null } },
        }));
        assertCleanIdle(JSON.parse(r.storage.file).nextState);
        cases.push({ name: `old journal recovery, sync=${syncEnabled}`, outcome: 'runtime clean after reload; no ghost history; next business commit persists clean state' });
    }

    {
        const r = setup(false, 'stopwatch');
        const apply = extract('        async applyRemote(remoteState)', '        startPolling()');
        call(r, `SyncManager.applyRemote = ({ ${apply} }).applyRemote;`);
        r.api.manager.onStateChange = state => call(r, `applyAcceptedSyncStateToTimer(${JSON.stringify(state)});`);
        const old = dirtyIdle(r);
        await r.api.manager.applyRemote(old);
        assertCleanIdle(r.api.manager.getState());
        assert.equal(r.context.elapsedSeconds + r.context.stopwatchDisplayOffset, 0);
        const startMs = r.context.Date.now();
        const running = r.api.machine.createFocusState({ timerMode: 'stopwatch', nowMs: startMs, focusSessionId: 'newer-running' }, r.api.manager.getState());
        running.lastModifiedTime = old.lastModifiedTime + 1;
        running.sequenceId = old.sequenceId + 1;
        await r.api.manager.applyRemote(running);
        assert.equal(r.api.manager.getState().status, 'RUNNING');
        await r.api.manager.applyRemote(old);
        assert.equal(r.api.manager.getState().status, 'RUNNING', 'older IDLE must never stop a newer timer');
        cases.push({ name: 'remote dirty IDLE and version ordering', outcome: 'accepted old data normalized; newer RUNNING restored; older IDLE rejected' });
    }

    for (const timerMode of ['countdown', 'stopwatch']) {
        const r = setup(false, 'stopwatch');
        const startMs = r.context.Date.now();
        const focus = r.api.machine.createFocusState({ timerMode, nowMs: startMs, plannedDurationSec: 1800, focusSessionId: 'focus' }, r.api.manager.getState());
        const continuation = r.api.machine.captureFocusContinuation(focus, startMs + 75000);
        const idle = r.api.machine.closeSegment(focus, startMs + 75000).state;
        idle.continuation = continuation;
        const normalized = call(r, `prepareCanonicalStateForSync(${JSON.stringify(idle)})`);
        assertCleanIdle(normalized);
        assert.equal(normalized.continuation.focusTimerSnapshot.accumulatedMs, 75000);
        const restored = r.api.machine.restoreFocusContinuation(normalized, startMs + 180000);
        assert.equal(restored.status, 'PAUSED');
        assert.equal(call(r, `StateCalculator.calculateElapsed(${JSON.stringify(restored)})`), 75);
        const resumed = r.api.machine.resume(restored, startMs + 240000);
        r.timer.advance(270000);
        assert.equal(call(r, `StateCalculator.calculateElapsed(${JSON.stringify(resumed)})`), 105);
        cases.push({ name: `focus continuation, ${timerMode}`, outcome: 'idle cleanup retains accumulated focus; restore paused=75s; resume elapsed=105s' });
    }

    console.log('timer idle stopwatch regression tests passed: ' + cases.length + ' scenarios');
})().catch(error => { console.error(error); process.exitCode = 1; });
