'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const extract = (start, end) => {
    const offset = source.indexOf(start);
    const finish = source.indexOf(end, offset + start.length);
    assert.ok(offset >= 0 && finish > offset, start);
    return source.slice(offset, finish);
};
const helpers = extract('    function cloneSyncState(', '    // ========== 同步管理器');
const update = extract('        async updateLocal(', '        checkStateChanged(');
const journal = extract('    const TimerJournal = {', '    const TimerStateMachine = {');
const machine = extract('    const TimerStateMachine = {', '    function getExpiredTimerSnapshot(');
const executor = extract('    const TransitionExecutor = {', '    // Compatibility boundary for legacy UI paths');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
function createRuntime(storage = { file: null, local: new Map(), history: new Map() }, options = {}) {
    const controls = { failWrite: false, loseAck: false, failHistory: false, failAccounting: false, historyGate: null, writes: 0, historyCalls: 0, accountingCalls: 0, scheduled: 0 };
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout,
        TOMATO_STATE_SCHEMA_VERSION: 2, TOMATO_HISTORY_SCHEMA_VERSION: 2, TOMATO_HARD_LIMIT_SEC: 86400,
        SYNC_DEVICE_ID: options.device || 'device-a',
        TIMER_JOURNAL_FILE_PATH: '/journal', TIMER_JOURNAL_LOCAL_KEY: 'journal', PLUGIN_STORAGE_DIR: '/storage',
        __tomatoDestroyed: false,
        __tomatoFileTextCache: new Map(),
        __tomatoTrackTimeout: () => ++controls.scheduled,
        userSettings: { sync: { syncTaskAssociation: true } },
        isSyncEnabled: () => options.sync !== false,
        Logger: { info() {}, warn() {}, debug() {} },
        window: { dispatchEvent() {} }, CustomEvent: class {},
        localStorage: { getItem: key => storage.local.get(key) || null, setItem: (key, value) => storage.local.set(key, value) },
        __tomatoGetFileText: async () => storage.file === null ? { exists: false, available: true } : { exists: true, available: true, text: storage.file },
        __tomatoEnsureDir: async () => true,
        __tomatoPutFileText: async (_path, text) => {
            controls.writes++;
            if (controls.failWrite) return false;
            storage.file = text;
            return !controls.loseAck;
        },
        HistoryRepository: {
            async ensureNormal(record) {
                controls.historyCalls++;
                if (controls.historyGate) await controls.historyGate.promise;
                if (controls.failHistory) return false;
                if (!storage.history.has(record.recordId)) storage.history.set(record.recordId, { ...clone(record), disposition: 'normal' });
                return storage.history.get(record.recordId);
            },
        },
        AccountingRepository: {
            async applyQueue(effects) {
                controls.accountingCalls += effects.length;
                return effects.map(() => ({ durable: !controls.failAccounting, entry: { status: 'pending' } }));
            },
        },
        syncState: { stateSchemaVersion: 2, sequenceId: 0, status: 'IDLE', mode: 'countdown', duration: 1800, activeTimer: null },
    });
    vm.runInContext(helpers + `
        const SyncManager = {
            localState: prepareCanonicalStateForSync(syncState),
            getState() { return cloneSyncState(this.localState); },
            checkStateChanged(left, right) { return buildSemanticSignature(left) !== buildSemanticSignature(right); },
            async loadFromCloud() { return this.getState(); },
            async saveToCloud() { return true; },
            enqueueDeferredSync() {},
            ${update}
        };
        ${journal}
        ${machine}
        ${executor}
        this.api = { journal: TimerJournal, executor: TransitionExecutor, manager: SyncManager, machine: TimerStateMachine, signature: buildSemanticSignature };
    `, context);
    const api = context.api;
    const start = (label, extra = {}) => api.executor.execute({ transitionId: label, deferNetwork: true, ...extra }, latest => api.machine.createFocusState({
        nowMs: Date.now(), phase: 'focus', timerMode: 'countdown', plannedDurationSec: 1800, focusSessionId: label,
    }, latest));
    return { api, context, controls, storage, start };
}
const draft = (recordId, routineButtonId = 'routine-a') => ({
    recordId, transitionId: 'draft-transition', sessionId: 'session-a', start: '2026-09-07T23:00:00.000Z', end: '2026-09-08T02:00:00.000Z',
    durationMs: 10800000, durationSec: 10800, durationMin: 180, mode: 'stopwatch', disposition: 'pending',
    taskBlockId: null, databaseBlockId: null, routineButtonId, routineButtonName: routineButtonId,
});

function attachEndRecorder(runtime, mode, elapsedMs, accumulatedMs = 0) {
    const endMs = Date.now();
    Object.assign(runtime.context, {
        timerMode: mode, currentDuration: 30, currentTaskBlockId: null, currentTaskBlockName: null, currentDatabaseBlockId: null,
        segmentTaskBlockId: null, segmentTaskBlockName: null, segmentDatabaseBlockId: null,
        currentStartTimestamp: null, currentStartTimeMs: 0, stopwatchStartTimestamp: null, stopwatchStartTimeMs: 0,
        stopwatchSegmentStartTimestamp: null, stopwatchSegmentStartTimeMs: 0, stopwatchSegmentBaseElapsedSeconds: accumulatedMs / 1000,
        elapsedSeconds: (elapsedMs + accumulatedMs) / 1000, isFreshTomatoStart: false, preBreakState: null,
        currentDistractionCount: 0, lastSavedDistractionCount: 0, currentSessionId: 'segment-session', currentPauseStart: null,
        pendingBreakSessionId: null, routineButtonHighlightColor: 'red', recordEndTimeInFlightKeys: new Set(),
        getActiveRoutineButtonRecordMeta: () => ({ id: 'routine-a', name: 'Routine A', color: 'red' }),
        getInitialRemainingAtStart: () => 1800,
        isLegacyTimerStateSnapshot: () => false,
        ensureTimerLeaseForFinalization: async state => ({ ok: true, state }),
        buildRecordEndTimeInFlightKey: (...parts) => parts.join('|'),
        formatDateKey: date => date.toISOString().slice(0, 10), getTimePeriod: () => 'test',
        consumePendingLuminaRecordsForRecord: () => [], hasLuminaHistoryRecords: () => false,
        buildTomatoTaskDurationApplyKey: () => '', getTomatoAccountingPolicy: () => ({ enabled: false }),
        markTimelineHistoryDirty() {},
        testStartMs: endMs - elapsedMs, testAccumulatedMs: accumulatedMs,
    });
    const recordSource = extract('    async function recordEndTime(', '    async function clearCurrentRecordAssociation(');
    vm.runInContext(`
        syncState = TimerStateMachine.createFocusState({ timerMode, nowMs: testStartMs, plannedDurationSec: 1800, focusSessionId: 'segment-session' }, SyncManager.getState());
        syncState.activeTimer.accumulatedMs = testAccumulatedMs;
        syncState = prepareCanonicalStateForSync(syncState);
        SyncManager.localState = cloneSyncState(syncState);
        ${recordSource}
        this.endRecord = recordEndTime;
    `, runtime.context);
    return endMs;
}

(async () => {
    const runtime = createRuntime();
    await runtime.start('start-a');
    const operationDraft = draft('record-a');
    const beforeWrite = runtime.controls.writes;
    const switched = await runtime.start('start-b', { historyDrafts: [operationDraft] });
    assert.equal(switched.ok, true);
    assert.equal(runtime.controls.writes - beforeWrite, 1, 'critical path must write only one small journal snapshot');
    assert.equal(runtime.controls.historyCalls, 0, 'history IO must not run in the click path');
    assert.equal(runtime.controls.accountingCalls, 0, 'unassociated records must never write task attributes');
    operationDraft.routineButtonId = 'wrong-button';
    assert.equal(runtime.api.journal.queuedHistory()[0].routineButtonId, 'routine-a', 'routine metadata must be frozen before the next button');
    const historyGate = deferred();
    runtime.controls.historyGate = historyGate;
    const projection = runtime.api.executor.flushProjections();
    await runtime.start('start-c');
    assert.equal(runtime.api.manager.getState().activeTimer.sessionId, 'start-c', 'a stalled history write must not delay the next timer');
    historyGate.resolve();
    await projection;
    assert.equal(runtime.storage.history.get('record-a').durationSec, 10800);
    assert.equal(JSON.parse(runtime.storage.file).nextState.activeTimer.sessionId, 'start-c', 'background acknowledgement must preserve the newest checkpoint');
    assert.equal(JSON.parse(runtime.storage.file).operations.length, 0);

    const rebootSource = createRuntime();
    await rebootSource.start('before-restart', { historyDrafts: [draft('restart-record')] });
    const reboot = createRuntime(rebootSource.storage);
    await reboot.api.executor.recoverJournal({ deferNetwork: true });
    assert.equal(reboot.api.manager.getState().activeTimer.sessionId, 'before-restart');
    assert.equal(reboot.controls.historyCalls, 0, 'startup must recover state before historical IO');
    await reboot.api.executor.flushProjections();
    await reboot.api.executor.flushProjections();
    assert.equal(reboot.storage.history.size, 1, 'replay must not duplicate records');
    const newer = createRuntime(rebootSource.storage);
    const winning = { ...clone(reboot.api.manager.getState()), sequenceId: 1, lastModifiedTime: Date.now() + 60000, lastModifiedDevice: 'device-b', status: 'IDLE', activeTimer: null };
    newer.api.manager.localState = winning;
    await newer.api.executor.recoverJournal({ deferNetwork: true });
    assert.equal(newer.api.manager.getState().lastModifiedDevice, 'device-b', 'an older checkpoint must not overwrite another device');

    const failure = createRuntime();
    await failure.start('safe');
    const originalState = clone(failure.api.manager.getState());
    const originalFile = failure.storage.file;
    failure.controls.failWrite = true;
    await assert.rejects(failure.start('unsafe', { historyDrafts: [draft('unsafe-record')] }), /JOURNAL_PERSIST_FAILED/);
    assert.deepEqual(clone(failure.api.manager.getState()), originalState, 'failed durability must not advance canonical state');
    assert.equal(failure.storage.file, originalFile);
    failure.controls.failWrite = false;
    failure.controls.failHistory = true;
    await failure.start('retry-history', { historyDrafts: [draft('history-failure')] });
    await failure.api.executor.flushProjections();
    assert.equal(JSON.parse(failure.storage.file).operations.length, 1, 'history failure must retain its operation');
    await failure.start('still-responsive');
    failure.controls.failHistory = false;
    await failure.api.executor.flushProjections();
    assert.equal(failure.storage.history.size, 1);

    const accounting = createRuntime();
    accounting.controls.failAccounting = true;
    await accounting.start('accounting-pending', { historyDrafts: [draft('accounting-record')], accountingDrafts: [{ effectId: 'duration:accounting-record' }] });
    await accounting.api.executor.flushProjections();
    assert.equal(accounting.storage.history.size, 1);
    assert.equal(JSON.parse(accounting.storage.file).operations.length, 1, 'accounting draft must survive before ledger handoff');
    accounting.controls.failAccounting = false;
    await accounting.api.executor.flushProjections();
    assert.equal(JSON.parse(accounting.storage.file).operations.length, 0, 'durable pending ledger entries may be handed to the existing retry queue');

    const offline = createRuntime(undefined, { sync: false });
    offline.controls.failWrite = true;
    await offline.start('offline');
    const offlineRestart = createRuntime(offline.storage, { sync: false });
    await offlineRestart.api.executor.recoverJournal({ deferNetwork: true });
    assert.equal(offlineRestart.api.manager.getState().activeTimer.sessionId, 'offline');
    const damaged = createRuntime();
    damaged.storage.file = '{invalid';
    assert.equal((await damaged.start('must-not-overwrite')).blocked, true);
    assert.equal(damaged.storage.file, '{invalid', 'an unreadable queue must never be replaced with an empty queue');

    const bounded = createRuntime();
    bounded.api.journal.maxOperations = 2;
    await bounded.start('bound-a', { historyDrafts: [draft('bound-a')] });
    await bounded.start('bound-b', { historyDrafts: [draft('bound-b')] });
    const boundedFile = bounded.storage.file;
    await assert.rejects(bounded.start('bound-c', { historyDrafts: [draft('bound-c')] }), /JOURNAL_QUEUE_FULL/);
    assert.equal(bounded.storage.file, boundedFile, 'backpressure must not discard older operations');

    const concurrent = createRuntime();
    await Promise.all(Array.from({ length: 10 }, (_, index) => concurrent.start(`rapid-${index}`, { historyDrafts: [draft(`rapid-${index}`)] })));
    assert.equal(JSON.parse(concurrent.storage.file).operations.length, 10);
    assert.equal(concurrent.api.manager.getState().sequenceId, 10, 'serialized commands must allocate one version each');
    const merged = concurrent.api.journal.mergeHistory([{ ...draft('rapid-0'), disposition: 'discarded' }]);
    assert.equal(merged.length, 10);
    assert.equal(merged[0].disposition, 'discarded', 'queue overlays must not resurrect deleted history');
    const range = concurrent.api.journal.mergeHistory([], Date.parse('2026-09-09T00:00:00Z'), Date.parse('2026-09-10T00:00:00Z'));
    assert.equal(range.length, 0, 'queue overlays must obey timeline date boundaries');

    const gateSource = extract('    function assertTimerReady()', '    function restoreCommittedTimerRuntime()');
    const gateContext = vm.createContext({ __tomatoTimerReady: false, __tomatoDestroyed: false, showMiniToast() {} });
    vm.runInContext(gateSource + 'this.check = assertTimerReady;', gateContext);
    assert.throws(() => gateContext.check(), /TIMER_NOT_READY/);
    gateContext.__tomatoTimerReady = true;
    assert.doesNotThrow(() => gateContext.check());
    const startSource = extract('    async function startTimer(', '    async function pauseTimer()');
    assert.ok(startSource.indexOf('assertTimerReady();') < startSource.indexOf('await initAudio()'));
    assert.doesNotMatch(startSource, /try \{ await recordEndTime\(\); \} catch/);

    const lostAck = createRuntime();
    lostAck.controls.loseAck = true;
    assert.equal((await lostAck.start('accepted-with-lost-response')).ok, true, 'a lost acknowledgement must be reconciled by exact readback');

    const legacy = createRuntime();
    legacy.storage.file = JSON.stringify({ transitionId: 'old-journal', status: 'pending', stateCommitRequired: false, deferNetwork: true, historyDrafts: [draft('legacy')], accountingDrafts: [] });
    assert.equal((await legacy.api.executor.recoverJournal({ deferNetwork: true })).blocking, false);
    await legacy.api.executor.flushProjections();
    assert.equal(legacy.storage.history.size, 1, 'legacy pending journals must migrate and replay');
    const compatible = createRuntime();
    await compatible.start('compat-a', { historyDrafts: [draft('compat-a')] });
    await compatible.start('compat-b', { historyDrafts: [draft('compat-b')] });
    const envelope = JSON.parse(compatible.storage.file);
    assert.equal(envelope.historyDrafts.length, 2, 'legacy readers must see every queued draft at the compatibility boundary');
    const legacyRewritten = { transitionId: envelope.transitionId, status: envelope.status, nextState: envelope.nextState, historyDrafts: envelope.historyDrafts, accountingDrafts: envelope.accountingDrafts };
    compatible.storage.file = JSON.stringify(legacyRewritten);
    const migratedAgain = createRuntime(compatible.storage);
    await migratedAgain.api.executor.recoverJournal({ deferNetwork: true });
    await migratedAgain.api.executor.flushProjections();
    assert.equal(migratedAgain.storage.history.size, 2, 'an older renderer must not erase other queued records');

    const deleted = createRuntime();
    await deleted.start('deleted-record', { historyDrafts: [draft('deleted')], accountingDrafts: [{ recordId: 'deleted', effectId: 'duration:deleted' }] });
    deleted.storage.history.set('deleted', { ...draft('deleted'), disposition: 'discarded' });
    await deleted.api.executor.flushProjections();
    assert.equal(deleted.controls.accountingCalls, 0, 'discarded history must not reapply delayed accounting');

    const kernelSource = fs.readFileSync(path.join(__dirname, '..', 'kernel.js'), 'utf8');
    const kernelStart = kernelSource.indexOf('        function createLeaseToken()');
    const kernelEnd = kernelSource.indexOf('        function historySourceError(', kernelStart);
    const kernelContext = vm.createContext({ writeLeases: new Map(), text: value => String(value || ''), HISTORY_WRITE_LEASE_MIN_MS: 5000, HISTORY_WRITE_LEASE_MAX_MS: 60000 });
    vm.runInContext(kernelSource.slice(kernelStart, kernelEnd) + 'this.lease = handleHistoryWriteLease;', kernelContext);
    const historyLease = kernelContext.lease({ action: 'acquire' });
    const timerLease = kernelContext.lease({ action: 'acquire', scope: 'timer' });
    const accountingLease = kernelContext.lease({ action: 'acquire', scope: 'accounting' });
    assert.ok(historyLease.acquired && timerLease.acquired && accountingLease.acquired, 'history and accounting locks must not block a timer commit');
    assert.equal(kernelContext.lease({ action: 'acquire', scope: 'timer' }).acquired, false, 'two renderers must serialize timer commits');
    assert.equal(kernelContext.lease({ action: 'release', scope: 'timer', token: historyLease.token }).released, undefined, 'a history token must not release the timer lease');

    const longTimer = createRuntime();
    const longEndMs = attachEndRecorder(longTimer, 'stopwatch', 23 * 3600000);
    assert.equal(await longTimer.context.endRecord(true, true, { endTimeMs: longEndMs }), true, 'restarted unassociated stopwatch must save without local start timestamps');
    const longRecord = longTimer.api.journal.queuedHistory()[0];
    assert.equal(longRecord.durationMs, 23 * 3600000);
    assert.equal(longRecord.taskBlockId, null);
    assert.equal(longRecord.routineButtonId, 'routine-a');
    assert.equal(JSON.parse(longTimer.storage.file).operations[0].accountingDrafts.length, 0);
    await longTimer.api.executor.flushProjections();
    assert.equal(longTimer.storage.history.size, 1);

    const resumedCountdown = createRuntime();
    const countdownEndMs = attachEndRecorder(resumedCountdown, 'countdown', 30 * 60000, 10 * 60000);
    assert.equal(await resumedCountdown.context.endRecord(false, false, { endTimeMs: countdownEndMs, isCompleted: true }), true);
    const countdownRecord = resumedCountdown.api.journal.queuedHistory()[0];
    assert.equal(countdownRecord.durationMs, 20 * 60000, 'a resumed countdown must not save already-accounted time twice');
    assert.equal(Date.parse(countdownRecord.end) - Date.parse(countdownRecord.start), countdownRecord.durationMs, 'timeline bounds must agree with persisted duration');

    const hardLimit = createRuntime();
    const hardEndMs = attachEndRecorder(hardLimit, 'stopwatch', 26 * 3600000);
    await hardLimit.context.endRecord(true, true, { endTimeMs: hardEndMs });
    const cappedRecord = hardLimit.api.journal.queuedHistory()[0];
    assert.equal(cappedRecord.durationMs, 24 * 3600000);
    assert.equal(Date.parse(cappedRecord.end) - Date.parse(cappedRecord.start), cappedRecord.durationMs);

    console.log('timer journal queue tests passed: durability, restart, legacy migration, edit/delete safety, backpressure, one write per transition and independent writer scopes');
})().catch(error => { process.nextTick(() => { throw error; }); });
