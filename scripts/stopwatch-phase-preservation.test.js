'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('    async function startStopwatchForCurrentPhase()');
const helperEnd = source.indexOf('    async function resetCurrentMode(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'stopwatch phase helper must remain extractable');

const helperSource = source.slice(helperStart, helperEnd);
const menuCalls = source.match(/await startStopwatchForCurrentPhase\(\)/g) || [];
assert.equal(menuCalls.length, 2, 'both context menus must use the explicit focus stopwatch action');
assert.match(source, /label: '⏱️ 专注正计时',[\s\S]*?await startStopwatchForCurrentPhase\(\)/,
    'the desktop float menu must label the focus action consistently even during a break');

const resetStart = source.indexOf('    async function resetCurrentMode(');
const resetEnd = source.indexOf('    async function completeCurrentTomato(', resetStart);
const resetSource = source.slice(resetStart, resetEnd);
assert.match(resetSource, /if \(!isStopwatchBreak && preBreakState\?\.mode === 'countdown'\)/, 'normal pomodoro breaks may retain their existing return behavior');
assert.match(resetSource, /else if \(isStopwatchBreak\)[\s\S]*timerMode = 'stopwatch-break';/, 'completing stopwatch rest must preserve stopwatch rest mode');

const dialogStart = source.indexOf('        const acknowledgeAndCloseEndDialog = () =>');
const dialogEnd = source.indexOf('        backdrop.onclick =', dialogStart);
const dialogSource = source.slice(dialogStart, dialogEnd);
assert.match(dialogSource, /const isStopwatchBreakEnd = timerMode === 'stopwatch-break' \|\| preBreakState\?\.mode === 'stopwatch';[\s\S]*if \(isStopwatchBreakEnd\) \{[\s\S]*preBreakState = null;/, 'closing a completed stopwatch rest must keep the current rest phase');
assert.doesNotMatch(dialogSource, /timerMode = 'stopwatch'/, 'closing a completed stopwatch rest must never restore focus mode');

async function getStartedMode(timerMode) {
    const calls = [];
    const context = vm.createContext({
        assertTimerReady: () => {},
        timerMode,
        startStopwatchBreakMode: async () => { calls.push('stopwatch-break'); },
        switchToStopwatchAndStart: async () => { calls.push('stopwatch'); },
    });
    vm.runInContext(`${helperSource}\nthis.run = startStopwatchForCurrentPhase;`, context);
    await context.run();
    assert.equal(calls.length, 1, `${timerMode} must start exactly one stopwatch mode`);
    return calls[0];
}

(async () => {
    assert.equal(await getStartedMode('countdown'), 'stopwatch');
    assert.equal(await getStartedMode('stopwatch'), 'stopwatch');
    assert.equal(await getStartedMode('break'), 'stopwatch');
    assert.equal(await getStartedMode('stopwatch-break'), 'stopwatch');
    console.log('stopwatch phase preservation tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
