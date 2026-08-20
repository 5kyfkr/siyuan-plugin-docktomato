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
assert.match(source, /const confirmationDelaysMs = \[0, 80, 180, 400, 800\];[\s\S]*lastConfirmed = await this\.loadFromCloud\(\);/, 'cloud confirmation must retry transiently stale reads');
assert.match(source, /versionMatches && semanticMatches/, 'cloud commits must verify both transport and semantic state');
assert.match(source, /putFile code 0 is the durable local-write acknowledgement[\s\S]*return true;/, 'an accepted local file write must not be rolled back by a stale confirmation read');
assert.match(source, /if \(!saved\) \{[\s\S]*this\.localState = previousState;[\s\S]*throw new Error\('SYNC_COMMIT_FAILED'\);/, 'a failed cloud commit must roll local state back and reject');
assert.match(source, /startTimer: 同步到云端失败[\s\S]*throw e;/, 'start must not swallow a failed canonical commit');
assert.match(source, /const transition = await TransitionExecutor\.execute\(\{ transitionId: createTomatoUuid\('stop'\)/, 'stop must await its canonical commit');

const journalStart = source.indexOf('    const TimerJournal = {');
const journalEnd = source.indexOf('    const TimerStateMachine = {', journalStart);
const journalBlock = source.slice(journalStart, journalEnd);
assert.match(journalBlock, /isSyncEnabled\(\)\) return fileSaved;/, 'sync mode must require the shared journal write');
assert.match(journalBlock, /__tomatoFileTextCache\.delete\(TIMER_JOURNAL_FILE_PATH\)/, 'journal recovery must read the latest shared file');
assert.match(journalBlock, /if \(requireSharedJournal\) return null;[\s\S]*localStorage\.getItem/, 'sync mode must not treat a local-only journal as shared durability');

const accountingStart = source.indexOf('    const AccountingRepository = {');
const accountingEnd = source.indexOf('    const TransitionExecutor = {', accountingStart);
const accountingBlock = source.slice(accountingStart, accountingEnd);
assert.match(accountingBlock, /if \(!fileSaved && \(requiresSharedLedger \|\| !localSaved\)\) return null;/, 'sync mode must require the shared accounting ledger write');
assert.match(accountingBlock, /__tomatoFileTextCache\.delete\(ACCOUNTING_LEDGER_FILE_PATH\)/, 'accounting must read the latest shared ledger before an ordered write');
assert.match(accountingBlock, /return \{ applied: entry\.status === 'applied', durable: true, entry \};/, 'a durable pending effect must remain retryable without blocking the timer');
assert.match(accountingBlock, /if \(entry\?\.status === 'pending'\) \{[\s\S]*durable: true/, 'queue-level Task Horizon failures must preserve a durable pending effect');

const executorStart = source.indexOf('    const TransitionExecutor = {');
const executorEnd = source.indexOf('    // Compatibility boundary for legacy UI paths', executorStart);
const executorBlock = source.slice(executorStart, executorEnd);
assert.match(executorBlock, /journal\.status === 'committed' && !recovered/, 'journal recovery must remain blocking until committed status is durably readable');
assert.match(executorBlock, /const accountingComplete = .*\['applied', 'skipped'\]/, 'accounting completion must remain separate from durable pending ledger state');
assert.match(source, /async ensureNormal\(record\)[\s\S]*Object\.assign\(item, draft, \{ disposition: 'normal' \}\)/, 'journal recovery must idempotently repair a missing or pending history record');

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
