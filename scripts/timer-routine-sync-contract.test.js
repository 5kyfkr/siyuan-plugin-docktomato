'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const identityStart = source.indexOf('    function getRoutineButtonIdentity(');
const resolverStart = source.indexOf('    function syncActiveRoutineButtonFromState(');
const resolverEnd = source.indexOf('    function updateRoutineButtonRunningHighlight(', resolverStart);
assert.ok(identityStart >= 0 && resolverStart > identityStart && resolverEnd > resolverStart, 'routine sync helpers must remain extractable');

const context = vm.createContext({
    userSettings: {
        routineButtons: [
            { id: 'routine-focus', name: '专注', blockId: '', color: '#1976d2' },
            { id: 'routine-read', name: '阅读', blockId: 'block-read', color: '#388e3c' },
        ],
    },
    activeRoutineButtonIndex: null,
    activeRoutineButtonBlockId: null,
    routineButtonHighlightColor: null,
});

const identityEnd = source.indexOf('    function getRoutineButtonRecordMeta(', identityStart);
vm.runInContext(`
${source.slice(identityStart, identityEnd)}
${source.slice(resolverStart, resolverEnd)}
this.applyRoutineState = syncActiveRoutineButtonFromState;
`, context);

context.applyRoutineState({ status: 'RUNNING', routineButtonId: 'routine-focus' });
assert.equal(context.activeRoutineButtonIndex, '0', 'synced stable ID must restore the active routine button');
assert.equal(context.routineButtonHighlightColor, '#1976d2', 'synced routine must restore its highlight color');

context.applyRoutineState({ status: 'PAUSED', taskBlockId: 'block-read' });
assert.equal(context.activeRoutineButtonIndex, '1', 'older synced states must still fall back to the task block ID');

context.applyRoutineState({ status: 'RUNNING', taskBlockName: '专注' });
assert.equal(context.activeRoutineButtonIndex, null, 'ordinary task names must not select an unrelated routine button');

context.applyRoutineState({ status: 'IDLE', routineButtonId: 'routine-read' });
assert.equal(context.activeRoutineButtonIndex, null, 'idle state must clear the routine selection');

const stateChangeStart = source.indexOf('                const handleStateChange = async (newState) => {');
const stateChangeEnd = source.indexOf('            const initResult = await SyncManager.init', stateChangeStart);
assert.ok(stateChangeStart >= 0 && stateChangeEnd > stateChangeStart, 'sync state callback must remain extractable');
const stateChangeBlock = source.slice(stateChangeStart, stateChangeEnd);
assert.match(stateChangeBlock, /runtimeStateChanged[\s\S]*?!runtimeStateChanged/, 'runtime transitions must bypass cosmetic update throttling');
assert.match(stateChangeBlock, /runtimeNeedsRecovery[\s\S]*?!runtimeNeedsRecovery/, 'a missing local timer loop must bypass update throttling');
assert.match(stateChangeBlock, /newState\.lastModifiedDevice === SYNC_DEVICE_ID && !isLocalStateInitial && !runtimeNeedsRecovery/, 'same-device callbacks must still repair a missing local runtime');
assert.match(stateChangeBlock, /syncActiveRoutineButtonFromState\(newState\)[\s\S]*?updateRoutineButtonRunningHighlight\(true\)[\s\S]*?if \(!timerId\) startLocalTimerLoop\(\)/, 'an unchanged running state must restore its routine highlight and timer loop');
assert.match(stateChangeBlock, /syncState\.startTime !== newState\.startTime[\s\S]*?updateRoutineButtonRunningHighlight\(true\)[\s\S]*?startLocalTimerLoop\(\)/, 'a remotely restarted timer must refresh its routine highlight before restarting the local loop');
assert.match(stateChangeBlock, /if \(newState\.status === 'PAUSED'\)/, 'accepted remote pauses must not be filtered by sequence ID again');
assert.match(stateChangeBlock, /newState\.status === 'RUNNING' && \(!isRunning \|\| isTimerPaused \|\| !timerId\)/, 'remote running states must recover a stopped local runtime');
assert.doesNotMatch(stateChangeBlock, /newState\.status === 'IDLE'[\s\S]{0,300}newState\.sequenceId/, 'accepted remote idle states must not be filtered by sequence ID again');
assert.match(stateChangeBlock, /if \(newState\.status === 'IDLE'\)/, 'accepted remote idle states must fully clear stale local runtime data');

const startTimerStart = source.indexOf('    async function startTimer()');
const startTimerEnd = source.indexOf('    async function pauseTimer()', startTimerStart);
const startTimerBlock = source.slice(startTimerStart, startTimerEnd);
assert.match(startTimerBlock, /syncState\.routineButtonId = activeRoutineMeta\?\.id \|\| null/, 'timer starts must publish the routine button identity');

console.log('timer routine sync contract tests passed');
