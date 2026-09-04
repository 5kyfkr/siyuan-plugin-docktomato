'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
assert.doesNotMatch(source, /TOMATO_PERSISTENCE_LOG_PREFIX|__tomatoPersistenceTrace/,
    'temporary persistence diagnostics must not remain in the production timer code');
assert.match(source, /HistoryRepository\.commitPending\(draft\)[\s\S]*if \(!committed\)[\s\S]*throw new Error\('history draft commit failed'\)/,
    'a failed pending-to-normal history commit must keep the timer transaction from reporting success');
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
const switchStart = source.indexOf('    async function switchToCountdownAndStart(');
const switchEnd = source.indexOf('    async function startBreakMode(', switchStart);
const switchBlock = source.slice(switchStart, switchEnd);
assert.match(switchBlock, /const pendingRecordSave = finalizeCurrentSegmentBeforeTransition\(\);[\s\S]*await requireTimerPersistence\(pendingRecordSave,[\s\S]*await startTimer\([^)]*\)/, 'mode switches must finish the shared record journal before starting the next canonical timer');
assert.ok(switchBlock.indexOf('updateDisplay();') < switchBlock.indexOf('await requireTimerPersistence(pendingRecordSave'), 'mode switches must render the selected mode before waiting for persistence');
assert.ok(switchBlock.indexOf('await requireTimerPersistence(pendingRecordSave') < switchBlock.indexOf('await startTimer('), 'mode switches must not start the next timer before persistence succeeds');

const stopStart = source.indexOf('    async function stopTimer(');
const stopEnd = source.indexOf('    let currentStartTimestamp', stopStart);
const stopBlock = source.slice(stopStart, stopEnd);
assert.match(stopBlock, /const isStopwatchMode = timerMode === 'stopwatch' \|\| timerMode === 'stopwatch-break';/, 'stopTimer must identify stopwatch modes');
assert.match(stopBlock, /recordEndTime\(false, isStopwatchMode, \{ skipSyncUpdate: true \}\)/, 'stopTimer must persist the active mode');
assert.ok(stopBlock.indexOf('await requireTimerPersistence(pendingRecordSave') < stopBlock.indexOf("createTomatoUuid('stop')"), 'stop must close its record journal before committing IDLE');

const resetStart = source.indexOf('    async function resetCurrentMode(');
const resetEnd = source.indexOf('    async function completeCurrentTomato(', resetStart);
const resetBlock = source.slice(resetStart, resetEnd);
assert.match(resetBlock, /const isStopwatchBreak = timerMode === 'stopwatch-break';/, 'reset must identify stopwatch breaks');
assert.match(resetBlock, /recordEndTime\(true, isStopwatchBreak(?:, \{ confirm \})?\)/, 'reset must persist stopwatch breaks with stopwatch timestamps');
assert.match(resetBlock, /cancelTrackedTimerNotification\('finish-break', false\)[\s\S]*finishBreakFromContinuation\(\)/, 'finishing a break must cancel its notification before restoring focus');
const resetCommitIndex = resetBlock.lastIndexOf("await commitTimerState(");
assert.ok(resetCommitIndex >= 0, 'reset must commit its canonical IDLE state');
assert.ok(resetBlock.lastIndexOf('await requireTimerPersistence(pendingRecordSave') < resetCommitIndex, 'reset must close its record journal before committing IDLE');

const completeStart = source.indexOf('    async function completeCurrentTomato(');
const completeEnd = source.indexOf('    function isCurrentTaskAssociation(', completeStart);
const completeBlock = source.slice(completeStart, completeEnd);
const completeCommitIndex = completeBlock.lastIndexOf("await commitTimerState(");
assert.ok(completeCommitIndex >= 0, 'completion must commit its canonical IDLE state');
assert.ok(completeBlock.indexOf('await requireTimerPersistence(pendingRecordSave') < completeCommitIndex, 'completion must close its record journal before committing IDLE');

const contextMenuStart = source.indexOf('    async function showContextMenu(');
const contextMenuEnd = source.indexOf('\n \tfunction getWeekStartDate(', contextMenuStart);
const contextMenuBlock = source.slice(contextMenuStart, contextMenuEnd);
assert.match(contextMenuBlock, /结束休息[\s\S]*await resetCurrentMode\(\)/, 'the timer context menu must close the break segment before restoring focus');
assert.match(contextMenuBlock, /durationSlider\.type = 'range';[\s\S]*setActiveCountdownDuration\(durationSlider\.value\)/, 'active countdowns must expose a duration slider backed by a canonical transition');

const durationTransitionStart = source.indexOf('    async function setActiveCountdownDuration(');
const durationTransitionEnd = source.indexOf('    async function finishBreakFromContinuation(', durationTransitionStart);
const durationTransitionBlock = source.slice(durationTransitionStart, durationTransitionEnd);
assert.match(durationTransitionBlock, /TransitionExecutor\.execute\(/, 'duration changes must use the ordered transition executor');
assert.match(durationTransitionBlock, /timer\.plannedDurationSec = plannedDurationSec;/, 'duration changes must update the canonical planned duration');
assert.match(durationTransitionBlock, /minimumMinutes = Math\.max\(5, Math\.ceil\(\(activeMs \+ 1\) \/ 60000\)\)[\s\S]*minimumSteppedMinutes = Math\.ceil\(minimumMinutes \/ 5\) \* 5/, 'duration changes must preserve elapsed time and the five-minute adjustment unit');
assert.match(contextMenuBlock, /getTomatoDurations\(\)[\s\S]*durationSlider\.type = 'range';[\s\S]*durationSlider\.className = 'tomato-duration-slider'[\s\S]*durationSlider\.min = '5';[\s\S]*durationSlider\.step = '5'[\s\S]*await switchToCountdownAndStart\(duration\)/, 'timer modes must retain presets and expose a five-minute focus slider with a persistent play-icon thumb');
const durationControlCondition = contextMenuBlock.match(/const showCountdownDurationControl = ([\s\S]*?)\n\s*if \(showCountdownDurationControl\)/);
assert.ok(durationControlCondition, 'focus-duration slider condition must remain explicit');
assert.match(durationControlCondition[1], /timerMode === 'countdown'[\s\S]*\|\| isBreakDurationControl[\s\S]*\|\| !hasActiveDuration;/, 'focus-duration slider must remain visible during a break');
assert.match(contextMenuBlock, /const isBreakDurationControl = timerMode === 'break' \|\| timerMode === 'stopwatch-break'/, 'both break modes must use the independent focus-duration control');
assert.match(contextMenuBlock, /durationSlider\.value = String\(getNextFocusCountdownDuration\(\)\)/, 'break mode must not initialize the focus slider from the active break duration');
assert.match(contextMenuBlock, /isBreakDurationControl[\s\S]*setNextFocusCountdownDuration\(durationSlider\.value\)/, 'dragging during a break must only update the next focus duration');
assert.doesNotMatch(contextMenuBlock, /if \(timerMode === 'break'\)[\s\S]*startBreakMode\(duration\)/, 'clicking the focus slider during a break must not restart the break');
const nextFocusDurationStart = source.indexOf('    function getNextFocusCountdownDuration()');
const nextFocusDurationEnd = source.indexOf('    async function finishBreakFromContinuation()', nextFocusDurationStart);
assert.ok(nextFocusDurationStart >= 0 && nextFocusDurationEnd > nextFocusDurationStart, 'independent break focus-duration helpers must remain extractable');
const nextFocusDurationBlock = source.slice(nextFocusDurationStart, nextFocusDurationEnd);
assert.match(nextFocusDurationBlock, /const continuationTimer = syncState\?\.continuation\?\.focusTimerSnapshot[\s\S]*continuationTimer\?\.plannedDurationSec/, 'break slider must prefer the interrupted countdown duration');
assert.match(nextFocusDurationBlock, /pendingFocusCountdownDuration = normalizedMinutes/, 'break slider drag must store only a pending focus duration');
assert.doesNotMatch(nextFocusDurationBlock, /currentDuration\s*=|remainingSeconds\s*=|syncState\.duration\s*=/, 'break slider drag must not mutate the active break timer');
assert.doesNotMatch(contextMenuBlock, /startDurationButton/, 'the slider must not have a separate right-side start button');
assert.doesNotMatch(contextMenuBlock, /durationLabel\.textContent =/, 'the duration row must not repeat the tomato-duration label');
assert.match(contextMenuBlock, /durationValue\.textContent = `\$\{durationSlider\.value\} 分`/, 'the duration row must use the compact minute unit');
assert.match(contextMenuBlock, /tomato-duration-slider::\-webkit-slider-thumb[\s\S]*width: 22px[\s\S]*background-image: url[\s\S]*background-size: 15px 15px/, 'the slider thumb must remain compact while preserving the play icon size');
assert.match(contextMenuBlock, /tomato-duration-slider::\-webkit-slider-runnable-track[\s\S]*height: 6px[\s\S]*background: color-mix/, 'the duration track must remain visually distinguishable');
assert.match(contextMenuBlock, /tomato-duration-slider:hover::\-webkit-slider-thumb[\s\S]*box-shadow[\s\S]*filter: brightness/, 'the slider thumb must provide a hover affordance');
assert.match(contextMenuBlock, /durationSlider\.classList\.add\('is-pressed'\)[\s\S]*durationSlider\.classList\.remove\('is-pressed'\)/, 'pressing the duration slider must provide thumb feedback');
assert.match(contextMenuBlock, /durationSlider\.addEventListener\('pointermove'[\s\S]*durationSliderDragged = true[\s\S]*durationSlider\.addEventListener\('click'[\s\S]*if \(durationSliderDragged\) return;[\s\S]*startDurationFromControl/, 'duration slider taps must start a timer while drag gestures only adjust duration');
assert.match(contextMenuBlock, /hasActiveDuration && durationSliderInteraction === 'tap'[\s\S]*return;/, 'a running timer tap must not race an active-duration adjustment');
assert.match(contextMenuBlock, /const activeMenu = document\.getElementById\('tomy-tomato-context-menu'\);[\s\S]*if \(activeMenu\) activeMenu\.remove\(\);[\s\S]*await switchToCountdownAndStart\(duration\)/, 'duration slider taps must close the menu before waiting for a transition');
assert.match(contextMenuBlock, /stopwatchItem\.onclick = async[\s\S]*?menu\.remove\(\);[\s\S]*?await startStopwatchForCurrentPhase\(\)/, 'stopwatch menu clicks must close the menu before waiting for a transition');

const floatMenuStart = source.indexOf('    function buildDesktopFloatWindowMenuTemplate(');
const floatMenuEnd = source.indexOf('    function showDesktopFloatWindowContextMenu(', floatMenuStart);
const floatMenuBlock = source.slice(floatMenuStart, floatMenuEnd);
assert.match(floatMenuBlock, /结束休息[\s\S]*await resetCurrentMode\(\)/, 'the desktop menu must close the break segment before restoring focus');

const transitionCalls = source.match(/finalizeCurrentSegmentBeforeTransition\(\)/g) || [];
assert.equal(transitionCalls.length, 7, 'all six mode switch paths plus the helper definition must use one finalizer');

const activeMsStart = source.indexOf('    function calculateActiveMs(');
const activeMsEnd = source.indexOf('    function buildTaskAssociationSnapshot(', activeMsStart);
const calculatorStart = source.indexOf('    const StateCalculator = {');
const calculatorEnd = source.indexOf('    // ========== v2 durable journal', calculatorStart);
assert.ok(activeMsStart >= 0 && activeMsEnd > activeMsStart, 'active millisecond helper must remain extractable');
assert.ok(calculatorStart >= 0 && calculatorEnd > calculatorStart, 'state calculator must remain extractable');
const calculatorContext = vm.createContext({
    Date: { now: () => 11_000 },
    CONFIG: { MAX_STOPWATCH_SECONDS: 86_400 },
    userSettings: {},
});
vm.runInContext(`${source.slice(activeMsStart, activeMsEnd)}\n${source.slice(calculatorStart, calculatorEnd)}\nthis.calculator = StateCalculator;`, calculatorContext);
const resumedCountdown = {
    status: 'RUNNING',
    activeTimer: {
        status: 'RUNNING',
        timerMode: 'countdown',
        plannedDurationSec: 60,
        accumulatedMs: 30_000,
        segmentStartMs: 1_000,
        pausedAtMs: null,
    },
};
assert.equal(calculatorContext.calculator.calculateElapsed(resumedCountdown), 40, 'elapsed time must include committed segments after resume');
assert.equal(calculatorContext.calculator.calculateRemaining(resumedCountdown), 20, 'remaining time must subtract all committed segments after resume');
const pausedCountdown = {
    status: 'PAUSED',
    activeTimer: {
        status: 'PAUSED',
        timerMode: 'countdown',
        plannedDurationSec: 60,
        accumulatedMs: 40_000,
        segmentStartMs: null,
        pausedAtMs: 11_000,
    },
};
assert.equal(calculatorContext.calculator.calculateRemaining(pausedCountdown), 20, 'paused countdowns must remain frozen at accumulated milliseconds');

console.log('timer transition contract tests passed');
