'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const pauseStart = source.indexOf('    async function pauseTimer()');
const pauseEnd = source.indexOf('    async function stopTimer(', pauseStart);
const transitionStart = source.indexOf('    function finalizeCurrentSegmentBeforeTransition()');
const transitionEnd = source.indexOf('    async function switchToCountdownAndStart(', transitionStart);
assert.ok(pauseStart >= 0 && pauseEnd > pauseStart, 'pauseTimer must remain extractable');
assert.ok(transitionStart >= 0 && transitionEnd > transitionStart, 'transition finalizer must remain extractable');

const pauseBlock = source.slice(pauseStart, pauseEnd);
const transitionBlock = source.slice(transitionStart, transitionEnd);
assert.match(pauseBlock, /currentPauseStart = now;[\s\S]*syncState\.currentPauseStart = now;/, 'pause start must be stored locally even without sync');
assert.match(transitionBlock, /\(!isRunning && !isTimerPaused\)/, 'running and paused segments must share the transition finalizer');
assert.match(transitionBlock, /return recordEndTime\(false, isStopwatchMode\)/, 'mode transitions must use the normal history finalizer');

const stopStart = source.indexOf('    async function stopTimer(');
const stopEnd = source.indexOf('    let currentStartTimestamp', stopStart);
const stopBlock = source.slice(stopStart, stopEnd);
assert.match(stopBlock, /const isStopwatchMode = timerMode === 'stopwatch' \|\| timerMode === 'stopwatch-break';/, 'stopTimer must identify stopwatch modes');
assert.match(stopBlock, /recordEndTime\(false, isStopwatchMode, \{ skipSyncUpdate: true \}\)/, 'stopTimer must persist the active mode');

const resetStart = source.indexOf('    async function resetCurrentMode(');
const resetEnd = source.indexOf('    async function completeCurrentTomato(', resetStart);
const resetBlock = source.slice(resetStart, resetEnd);
assert.match(resetBlock, /const isStopwatchBreak = timerMode === 'stopwatch-break';/, 'reset must identify stopwatch breaks');
assert.match(resetBlock, /recordEndTime\(true, isStopwatchBreak\)/, 'reset must persist stopwatch breaks with stopwatch timestamps');

const transitionCalls = source.match(/finalizeCurrentSegmentBeforeTransition\(\)/g) || [];
assert.equal(transitionCalls.length, 7, 'all six mode switch paths plus the helper definition must use one finalizer');

console.log('timer transition contract tests passed');
