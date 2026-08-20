'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('    function cloneSyncState(');
const helperEnd = source.indexOf('    // 本地写入会单调推进修改时间', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'signature helpers must remain extractable');

const context = vm.createContext({
    Number,
    userSettings: { sync: { syncTaskAssociation: false } },
});
vm.runInContext(`${source.slice(helperStart, helperEnd)}\nthis.signature = buildSemanticSignature;`, context);

const base = {
    stateSchemaVersion: 2,
    status: 'RUNNING',
    activeTimer: { phase: 'focus', timerMode: 'countdown', accumulatedMs: 1000 },
    continuation: null,
    integrationEnvelope: {
        routineButton: { name: 'Routine' },
        distraction: { count: 1, savedCount: 0 },
        notificationSchedules: { local: { status: 'scheduled' } },
        taskAssociation: { taskBlockId: 'local-only' },
    },
    writerLease: { ownerDeviceId: 'device-a', leaseId: 'lease-1' },
    endDialog: null,
    sequenceId: 10,
    stateVersion: 10,
    lastModifiedTime: 100,
    lastModifiedDevice: 'device-a',
};

const sameBusinessState = {
    ...base,
    sequenceId: 11,
    stateVersion: 11,
    lastModifiedTime: 999,
    lastModifiedDevice: 'device-b',
    integrationEnvelope: {
        ...base.integrationEnvelope,
        taskAssociation: { taskBlockId: 'different-local-only' },
    },
};
assert.equal(context.signature(base), context.signature(sameBusinessState),
    'transport metadata and local task sidecars must not affect semantic signature');

const changed = { ...base, writerLease: { ownerDeviceId: 'device-b', leaseId: 'lease-2' } };
assert.notEqual(context.signature(base), context.signature(changed),
    'writer lease changes must affect semantic signature');

const reordered = {
    ...base,
    integrationEnvelope: {
        notificationSchedules: base.integrationEnvelope.notificationSchedules,
        distraction: base.integrationEnvelope.distraction,
        taskAssociation: base.integrationEnvelope.taskAssociation,
        routineButton: base.integrationEnvelope.routineButton,
    },
};
assert.equal(context.signature(base), context.signature(reordered),
    'object key order must not affect semantic signature');
assert.notEqual(
    context.signature(base),
    context.signature({ ...base, stateSchemaVersion: 3 }),
    'schema upgrades must be visible to semantic signature',
);

const updateStart = source.indexOf('        async updateLocal(newState, forcePush = true, forceSync = false)');
const updateEnd = source.indexOf('        checkStateChanged(currentState, newState)', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'updateLocal must remain extractable');
const updateBlock = source.slice(updateStart, updateEnd);
assert.match(updateBlock, /if \(!hasActualChange\)\s*\{[\s\S]*?return cloneSyncState\(this\.localState\);/, 'semantic no-op must return before metadata writes');
assert.match(updateBlock, /this\.localState\.sequenceId = nextSequenceId;[\s\S]*this\.localState\.stateVersion = nextSequenceId;/, 'SyncManager must assign both versions together');
assert.match(updateBlock, /this\.localState\.lastModifiedTime = Math\.max\(Date\.now\(\), highestKnownModifiedTime \+ 1\)/, 'changed writes must keep logical time monotonic');

console.log('timer semantic signature tests passed');
