'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('    function compareSyncStateVersions(');
const helperEnd = source.indexOf('    // ========== 同步管理器', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sync version helper must remain extractable');

const context = vm.createContext({ Number, SYNC_DEVICE_ID: 'local-device' });
vm.runInContext(`${source.slice(helperStart, helperEnd)}\nthis.compare = compareSyncStateVersions; this.accept = shouldAcceptRemoteSyncState;`, context);

assert.ok(context.compare({ sequenceId: 12, lastModifiedTime: 100 }, { sequenceId: 3, lastModifiedTime: 999 }) > 0, 'sequence must outrank wall clock time');
assert.ok(context.compare({ sequenceId: 3, lastModifiedTime: 999 }, { sequenceId: 12, lastModifiedTime: 100 }) < 0, 'stale remote state must be rejected');
assert.ok(context.compare({ sequenceId: 4, lastModifiedTime: 200 }, { sequenceId: 4, lastModifiedTime: 100 }) > 0, 'time must break equal-sequence ties');
assert.equal(context.accept(
    { sequenceId: 3, lastModifiedTime: 999, lastModifiedDevice: 'remote-device', status: 'RUNNING' },
    { sequenceId: 12, lastModifiedTime: 100, lastModifiedDevice: 'local-device', status: 'IDLE' },
), true, 'a newer state from another device must recover even when its sequence is lower');
assert.equal(context.accept(
    { sequenceId: 3, lastModifiedTime: 99, lastModifiedDevice: 'remote-device' },
    { sequenceId: 12, lastModifiedTime: 100, lastModifiedDevice: 'local-device' },
), false, 'an older lower-sequence remote state must remain rejected');

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
    console.log('timer sync version tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
