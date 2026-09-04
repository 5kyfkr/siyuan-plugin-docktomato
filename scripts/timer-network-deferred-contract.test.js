'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const journalStart = source.indexOf('    const TimerJournal = {');
const journalEnd = source.indexOf('    const TimerStateMachine = {', journalStart);
assert.ok(journalStart >= 0 && journalEnd > journalStart, 'timer journal must remain extractable');
const journal = source.slice(journalStart, journalEnd);
assert.match(journal, /deferNetwork: journal\?\.deferNetwork === true/,
    'the durable journal must preserve deferred-network mode for the next recovery');

const executorStart = source.indexOf('    const TransitionExecutor = {');
const executorEnd = source.indexOf('    // Compatibility boundary for legacy UI paths.', executorStart);
assert.ok(executorStart >= 0 && executorEnd > executorStart, 'transition executor must remain extractable');
const executor = source.slice(executorStart, executorEnd);
assert.match(executor, /const deferNetwork = command\?\.deferNetwork === true;/, 'timer transitions must have an explicit deferred-network mode');
assert.match(executor, /const latest = deferNetwork[\s\S]*SyncManager\.getState\(\)/, 'deferred transitions must use local canonical state instead of reading cloud state');
assert.match(executor, /committedState = await SyncManager\.updateLocal\(candidate, false, false/, 'deferred transitions must commit local state without a network write');
assert.match(executor, /SyncManager\.enqueueDeferredSync\(committedState\)/, 'deferred transitions must enqueue the latest state for background sync');
assert.match(executor, /if \(deferNetwork\) \{[\s\S]*AccountingRepository\.applyQueue\(journal\.accountingDrafts\)[\s\S]*\.catch\(/, 'deferred transitions must keep task attribute projection out of the timer click path');
assert.match(executor, /if \(deferNetwork && journal\.deferNetwork === true && journal\.status === 'committed'\)/, 'completed deferred journals must not trigger another cloud read before the next click');

const syncManagerStart = source.indexOf('    const SyncManager = {');
const syncManagerEnd = source.indexOf('    // ========== 状态计算器', syncManagerStart);
const syncManager = source.slice(syncManagerStart, syncManagerEnd);
assert.match(syncManager, /enqueueDeferredSync\(state = null\)/, 'sync manager must expose a coalescing deferred queue');
assert.match(syncManager, /const remote = await this\.loadFromCloud\(\);[\s\S]*compareSyncStateVersions\(remote, pending\) > 0/, 'background sync must re-check remote ordering before writing a deferred state');
assert.match(syncManager, /saveToCloud\(pending, false, \{ confirm: false \}\)/, 'background sync must skip readback confirmation');

const recordStart = source.indexOf('    async function recordEndTime(');
const recordEnd = source.indexOf('    /**\n     * 清除当前计时记录', recordStart);
const recordBlock = source.slice(recordStart, recordEnd);
assert.match(recordBlock, /allowEffectOnly: isLegacyTimerState,[\s\S]*deferNetwork: true/, 'ending a timer must not wait for network synchronization');

const startStart = source.indexOf('    async function startTimer(');
const startEnd = source.indexOf('    async function pauseTimer()', startStart);
const startBlock = source.slice(startStart, startEnd);
assert.match(startBlock, /transitionId: createTomatoUuid\('start'\),[\s\S]*deferNetwork: true/, 'starting a timer must not wait for network synchronization');

console.log('timer deferred network contract tests passed');
