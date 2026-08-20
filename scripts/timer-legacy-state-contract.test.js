'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const helperStart = source.indexOf('    function cloneSyncState(');
const helperEnd = source.indexOf('    // 本地写入会单调推进修改时间', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'state normalization helpers must remain extractable');

const context = vm.createContext({
    Number,
    Date,
    Math,
    JSON,
    userSettings: { sync: { syncTaskAssociation: false } },
    TOMATO_STATE_SCHEMA_VERSION: 2,
    TOMATO_HARD_LIMIT_SEC: 86400,
    SYNC_DEVICE_ID: 'device-a',
    syncState: null,
});
vm.runInContext(`${source.slice(helperStart, helperEnd)}
this.prepare = prepareCanonicalStateForSync;`, context);

const notificationStart = source.indexOf('    function getNotificationSchedulesMap(');
const notificationEnd = source.indexOf('    function getLocalTimerNotificationSchedule(', notificationStart);
assert.ok(notificationStart >= 0 && notificationEnd > notificationStart, 'notification projection helpers must remain extractable');
vm.runInContext(`${source.slice(notificationStart, notificationEnd)}
this.notificationMap = getNotificationSchedulesMap;`, context);

const repaired = context.prepare({
    stateSchemaVersion: 2,
    stateVersion: 4,
    sequenceId: 4,
    status: 'RUNNING',
    mode: 'countdown',
    duration: 1200,
    distractionCount: 2,
    distractionSavedCount: 1,
    notificationSchedules: { 'device-a': { status: 'scheduled', timerKey: 'legacy-key' } },
    integrationEnvelope: {
        distraction: { count: 0, savedCount: 0 },
        notificationSchedules: {},
    },
    activeTimer: {
        status: 'RUNNING',
        phase: 'focus',
        timerMode: 'countdown',
        plannedDurationSec: 1200,
        accumulatedMs: 0,
        segmentStartMs: 1000,
        openRecordId: 'record-1',
    },
});

assert.deepEqual(repaired.integrationEnvelope.distraction, { count: 2, savedCount: 1 },
    'legacy distraction fields must be promoted into the v2 envelope');
assert.deepEqual(repaired.integrationEnvelope.notificationSchedules, {
    'device-a': { status: 'scheduled', timerKey: 'legacy-key' },
}, 'legacy notification metadata must be promoted into the v2 envelope');
assert.equal(repaired.distractionCount, 2, 'canonical distraction count must remain projected to legacy fields');
assert.equal(repaired.activeTimer.plannedDurationSec, 1200, 'canonical timer duration must survive normalization');

const notificationState = {
    integrationEnvelope: { notificationSchedules: {} },
    notificationSchedules: {},
};
const notificationMap = context.notificationMap(notificationState);
notificationMap['device-a'] = { status: 'scheduled', timerKey: 'new-key' };
assert.deepEqual(notificationState.integrationEnvelope.notificationSchedules, notificationState.notificationSchedules,
    'notification getter must keep canonical and legacy maps on the same projection');

const distractionStart = source.indexOf('    async function recordDistraction()');
const distractionEnd = source.indexOf('\n    // 为历史记录添加分心', distractionStart);
assert.match(source.slice(distractionStart, distractionEnd),
    /activeTimer\.plannedDurationSec\s*=\s*currentDuration\s*\*\s*60/,
    'distraction extension must update the canonical planned duration');

const executorStart = source.indexOf('    const TransitionExecutor = {');
const executorEnd = source.indexOf('    // Compatibility boundary for legacy UI paths', executorStart);
const executorBlock = source.slice(executorStart, executorEnd);
assert.match(executorBlock, /command\?\.allowEffectOnly === true[\s\S]*stateCommitRequired:\s*stateChanged/,
    'legacy effect-only writes must be explicit and must not commit transport state');
assert.match(executorBlock, /const requiresLease = \['RUNNING', 'PAUSED'\]/,
    'legacy running states must still enforce the writer lease');
assert.match(source, /function buildLegacyTimerRecordIdentity[\s\S]*hashHistoryText/,
    'legacy records must use a stable identity for retry deduplication');
assert.match(source, /async function ensureTimerLeaseForFinalization[\s\S]*TransitionExecutor\.transferLease\(SYNC_DEVICE_ID\)[\s\S]*syncState = accepted/,
    'timer finalization must transfer a foreign lease through the shared executor and refresh the accepted state');
assert.match(source, /let isLegacyTimerState = isLegacyTimerStateSnapshot\(syncStateAtEnd\)[\s\S]*ensureTimerLeaseForFinalization\(syncStateAtEnd, allowActiveTimerTransfer\)/,
    'recordEndTime must normalize timer ownership before creating history drafts');
assert.match(source, /const buildCanonicalDraft = \(baseState\)[\s\S]*latest => buildCanonicalDraft\(latest\)/,
    'recordEndTime must rebuild the terminal snapshot from the executor latest state to avoid stale-sequence failures');
assert.match(source, /allowEffectOnly:\s*isLegacyTimerState/,
    'recordEndTime must opt legacy state into the effect-only transaction path');

console.log('timer legacy state contract tests passed');
