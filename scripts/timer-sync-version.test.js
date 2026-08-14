'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('    function cloneSyncState(');
const helperEnd = source.indexOf('    // ========== 同步管理器', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sync state helpers must remain extractable');

const context = vm.createContext({ Number, SYNC_DEVICE_ID: 'local-device' });
vm.runInContext(`${source.slice(helperStart, helperEnd)}\nthis.compare = compareSyncStateVersions; this.accept = shouldAcceptRemoteSyncState;`, context);

const runningState = { sequenceId: 12, lastModifiedTime: 100, lastModifiedDevice: 'local-device', status: 'RUNNING' };
const idleState = { sequenceId: 3, lastModifiedTime: 999, lastModifiedDevice: 'remote-device', status: 'IDLE' };
assert.ok(context.compare(idleState, runningState) > 0, 'the later logical write must win across devices');
assert.ok(context.compare(runningState, idleState) < 0, 'sync ordering must have one deterministic winner');
assert.equal(context.accept(idleState, runningState), true, 'a later state from another device must be accepted');
assert.equal(context.accept(runningState, idleState), false, 'the losing snapshot must not be accepted in the reverse direction');
assert.ok(context.compare(
    { sequenceId: 4, lastModifiedTime: 200, lastModifiedDevice: 'remote-z' },
    { sequenceId: 4, lastModifiedTime: 200, lastModifiedDevice: 'remote-a' },
) > 0, 'device ID must deterministically break an exact version tie');
assert.match(source, /Math\.max\(Date\.now\(\), highestKnownModifiedTime \+ 1\)/, 'local writes must advance a monotonic logical timestamp');
assert.match(source, /this\.onStateChange\(cloneSyncState\(this\.localState\)\)/, 'sync callbacks must not share the manager state object');
assert.match(source, /getState\(\)\s*\{\s*return cloneSyncState\(this\.localState\);/, 'sync state reads must not expose the manager state object');

const applyStart = source.indexOf('        async applyRemote(remoteState)');
const applyEnd = source.indexOf('        startPolling()', applyStart);
const applyBlock = source.slice(applyStart, applyEnd);
assert.doesNotMatch(applyBlock, /remoteState\.status === 'IDLE'|clearInterval|clearTimeout/, 'IDLE must not bypass version checks or stop polling');
assert.match(applyBlock, /shouldAcceptRemoteSyncState\(remoteState, this\.localState\)/, 'polling must use the cross-device recovery rule');
assert.match(source, /if \(shouldAcceptRemoteSyncState\(cloudState, this\.localState\)\)/, 'startup restore must use the same cross-device recovery rule');
assert.doesNotMatch(source, /checkShouldHandleExpiredStopwatch/, 'sync conflict handling must not infer device activity from history records');

vm.runInContext(`
this.manager = {
    localState: { sequenceId: 12, lastModifiedTime: 100, lastModifiedDevice: 'local-device', status: 'IDLE' },
    callbackCount: 0,
    saveCount: 0,
    onStateChange: function () { this.callbackCount++; },
    saveToCloud: async function () { this.saveCount++; },
${applyBlock}
};`, context);

(async () => {
    await context.manager.applyRemote({
        sequenceId: 3,
        lastModifiedTime: 999,
        lastModifiedDevice: 'remote-device',
        status: 'RUNNING',
        startTime: 123,
    });
    assert.equal(context.manager.localState.status, 'RUNNING', 'polling must apply the other device timer state');
    assert.equal(context.manager.callbackCount, 1, 'accepted remote timers must update local runtime state');
    assert.equal(context.manager.saveCount, 0, 'accepted remote timers must not be overwritten by local state');
    await context.manager.applyRemote({
        sequenceId: 12,
        lastModifiedTime: 100,
        lastModifiedDevice: 'local-device',
        status: 'IDLE',
        startTime: null,
    });
    assert.equal(context.manager.localState.status, 'RUNNING', 'an older idle snapshot must not replace the accepted running timer');
    assert.equal(context.manager.callbackCount, 1, 'a rejected idle snapshot must not update the runtime UI');
    assert.equal(context.manager.saveCount, 1, 'the winning running state must repair an older cloud snapshot');
    console.log('timer sync version tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
