'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const snapshotStart = source.indexOf('    function getExpiredTimerSnapshot(');
const snapshotEnd = source.indexOf('    let lastKnownHistoryMaxEndMinute', snapshotStart);
assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'timer expiry snapshot must remain extractable');

const now = Date.parse('2026-07-31T16:00:00Z');
const maxSeconds = 24 * 3600;
const context = vm.createContext({
    Date,
    Number,
    String,
    CONFIG: { MAX_STOPWATCH_SECONDS: maxSeconds },
    StateCalculator: { calculateTotalPausedTime: () => 0 },
});
vm.runInContext(`${source.slice(snapshotStart, snapshotEnd)}\nthis.snapshot = getExpiredTimerSnapshot;`, context);

assert.equal(context.snapshot({ mode: 'countdown', status: 'RUNNING', startTime: now - 60_000, duration: 60 }, now).mode, 'countdown');
assert.equal(context.snapshot({ mode: 'break', status: 'RUNNING', startTime: now - 60_000, duration: 60 }, now).mode, 'break');
assert.equal(context.snapshot({ mode: 'stopwatch', status: 'RUNNING', startTime: now - maxSeconds * 1000 }, now).isStopwatchMode, true);
assert.equal(context.snapshot({ mode: 'stopwatch-break', status: 'RUNNING', stopwatchStartTimeMs: now - maxSeconds * 1000 }, now).mode, 'stopwatch-break');
assert.equal(context.snapshot({ mode: 'stopwatch', status: 'RUNNING', startTime: now - (maxSeconds - 1) * 1000 }, now), null);
assert.match(source, /MAX_STOPWATCH_SECONDS: 24 \* 3600/, 'stopwatch hard cap must be 24 hours');

const finishStart = source.indexOf('    async function handleTimerEndFromSyncOrLocal(');
const finishEnd = source.indexOf('    // 🔧 新增：统一的本地计时器循环', finishStart);
const finishBlock = source.slice(finishStart, finishEnd);
assert.match(finishBlock, /recordEndTime\(false, isStopwatchMode/, 'all natural completions must use the shared record finalizer');
assert.match(finishBlock, /if \(!isStopwatchMode\) \{[\s\S]*?ensureSyncEndDialogOpen/, 'stopwatch completion must not create a synchronized end dialog');
assert.match(finishBlock, /await stopTimer\(\{ skipEndRecord: true \}\);[\s\S]*?if \(!isStopwatchMode\) \{/, 'stopwatch completion must stop and persist before skipping feedback');
assert.doesNotMatch(finishBlock, /正计时结束|小时上限/, 'stopwatch completion must not contain user-facing cap feedback');
assert.match(source, /if \(snapshot\.isStopwatchMode\) elapsedSeconds = snapshot\.durationSec;[\s\S]*handleTimerEndFromSyncOrLocal/, 'stopwatch expiry must snapshot the capped elapsed time before saving');
assert.doesNotMatch(source, /checkShouldHandleExpiredStopwatch|finalizeExpiredCountdownIfNeeded|getExpiredCountdownSnapshot/, 'old expiry implementations must be removed');
assert.match(source, /resume-\$\{normalizedSource\}[\s\S]*finalizeExpiredTimerIfNeeded|finalizeExpiredTimerIfNeeded\(`resume-/, 'resume must use the shared expiry finalizer');
assert.match(source, /finalizeExpiredTimerIfNeeded\('timer-tick'/, 'foreground ticks must use the shared expiry finalizer');
assert.match(source, /finalizeExpiredTimerIfNeeded\('sync-init-expired'/, 'sync startup must use the shared expiry finalizer');
assert.match(source, /const isCompletedState = String\(state\?\.status[\s\S]*\(!isRunning && !isCompletedState\)/, 'accepted legacy completed states must use the shared finalizer');
assert.match(source, /applyAcceptedSyncStateToTimer\(newState\);[\s\S]*finalizeExpiredTimerIfNeeded\('sync-state-initial'/, 'initial sync restore must finalize only after applying accepted state');

console.log('timer expiry contract tests passed');
