'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const timerVisibilityStart = source.indexOf('    function shouldShowDesktopMinimizedFloatWindowForTimerState()');
const timerVisibilityEnd = source.indexOf('    function shouldShowDesktopFloatWindow(', timerVisibilityStart);
assert.ok(timerVisibilityStart >= 0 && timerVisibilityEnd > timerVisibilityStart,
    'timer-state float-window visibility helper must remain extractable');
const timerVisibilityBlock = source.slice(timerVisibilityStart, timerVisibilityEnd);

const createTimerVisibility = ({ activity, allowPausedOrBreak, syncMode = '', localMode = 'countdown' }) => new Function(
    'getEffectiveTimerActivity',
    'isDesktopMinimizedFloatWindowPausedOrBreakEnabled',
    'syncState',
    'timerMode',
    `${timerVisibilityBlock}\nreturn shouldShowDesktopMinimizedFloatWindowForTimerState;`,
)(
    () => activity,
    () => allowPausedOrBreak,
    { mode: syncMode },
    localMode,
);

assert.equal(createTimerVisibility({
    activity: { running: false, paused: false, syncActive: false },
    allowPausedOrBreak: true,
})(), false, 'the paused/break option must not turn minimized mode into an idle always-visible mode');
assert.equal(createTimerVisibility({
    activity: { running: false, paused: true, syncActive: false },
    allowPausedOrBreak: false,
})(), false, 'paused timers must remain hidden when the paused/break option is disabled');
assert.equal(createTimerVisibility({
    activity: { running: false, paused: true, syncActive: false },
    allowPausedOrBreak: true,
})(), true, 'paused timers must remain visible when the paused/break option is enabled');
assert.equal(createTimerVisibility({
    activity: { running: true, paused: false, syncActive: false },
    allowPausedOrBreak: false,
    localMode: 'break',
})(), false, 'running breaks must remain hidden when the paused/break option is disabled');
assert.equal(createTimerVisibility({
    activity: { running: true, paused: false, syncActive: false },
    allowPausedOrBreak: true,
    localMode: 'break',
})(), true, 'running breaks must remain visible when the paused/break option is enabled');

const displayVisibilityStart = timerVisibilityEnd;
const displayVisibilityEnd = source.indexOf('    function getDesktopFloatWindowCompactWidth()', displayVisibilityStart);
assert.ok(displayVisibilityEnd > displayVisibilityStart,
    'display-mode float-window visibility helper must remain extractable');
const displayVisibilityBlock = source.slice(displayVisibilityStart, displayVisibilityEnd);
const shouldShowDesktopFloatWindow = new Function(
    `${displayVisibilityBlock}\nreturn shouldShowDesktopFloatWindow;`,
)();

assert.equal(shouldShowDesktopFloatWindow('always', false, false, false), true,
    'always-visible mode must remain visible while Siyuan is restored and the timer is idle');
assert.equal(shouldShowDesktopFloatWindow('always', true, false, false), true,
    'always-visible mode must remain visible while Siyuan is minimized and the timer is idle');
assert.equal(shouldShowDesktopFloatWindow('always', false, true, true), true,
    'always-visible mode must show an eligible running focus timer');
assert.equal(shouldShowDesktopFloatWindow('always', false, true, false), false,
    'always-visible mode must hide a paused timer when paused/break visibility is disabled');
assert.equal(shouldShowDesktopFloatWindow('always', true, true, false), false,
    'always-visible mode must hide a running break when paused/break visibility is disabled');
assert.equal(shouldShowDesktopFloatWindow('always', false, true, true), true,
    'always-visible mode must show paused or break timers when paused/break visibility is enabled');
assert.equal(shouldShowDesktopFloatWindow('minimized', true, true, true), true,
    'minimized mode must show an eligible timer while Siyuan is minimized');
assert.equal(shouldShowDesktopFloatWindow('minimized', false, true, true), false,
    'minimized mode must hide while Siyuan is restored');
assert.equal(shouldShowDesktopFloatWindow('minimized', true, true, false), false,
    'minimized mode must still honor timer-state visibility');
assert.equal(shouldShowDesktopFloatWindow('minimized', true, false, false), false,
    'minimized mode must remain hidden while the timer is idle');
assert.equal(shouldShowDesktopFloatWindow('off', true, false, true), false,
    'off mode must never show the desktop float window');

const syncStart = source.indexOf('    async function syncDesktopMinimizedFloatWindow(');
const syncEnd = source.indexOf('    function scheduleDesktopMinimizedFloatWindowSync(', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'desktop float-window sync must remain extractable');
const syncBlock = source.slice(syncStart, syncEnd);
assert.match(syncBlock, /shouldShowDesktopFloatWindow\([\s\S]*displayMode,[\s\S]*desktopFloatWindowState\.isMinimized,[\s\S]*hasUnfinishedTimerState\(\),[\s\S]*shouldShowDesktopMinimizedFloatWindowForTimerState\(\)/,
    'desktop float-window sync must evaluate display mode and timer state through the unified policy');

const payloadStart = source.indexOf('    function getDesktopFloatWindowPayload()');
const payloadEnd = source.indexOf('    function buildDesktopFloatWindowHtml()', payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'desktop float-window payload must remain extractable');
const payloadBlock = source.slice(payloadStart, payloadEnd);
assert.match(payloadBlock, /canToggleRun:\s*true/,
    'the desktop float-window play button must remain enabled while idle so it can start a fresh timer');
assert.doesNotMatch(payloadBlock, /canToggleRun:\s*hasUnfinishedTimerState\(\)/,
    'the desktop float-window play button must not be disabled by the unfinished-timer guard');

const buttonStateStart = source.indexOf('function __syncRunButtonState(payload)');
const buttonStateEnd = source.indexOf('window.__setTomatoFloatState', buttonStateStart);
assert.ok(buttonStateStart >= 0 && buttonStateEnd > buttonStateStart, 'float-window run-button state must remain extractable');
const buttonStateBlock = source.slice(buttonStateStart, buttonStateEnd);
assert.match(buttonStateBlock, /var canToggle = payload\.canToggleRun !== false/,
    'the float-window button must continue honoring an explicit disabled state');
assert.match(buttonStateBlock, /btn\.disabled = !canToggle/,
    'the float-window button disabled state must be driven by its payload');

console.log('desktop float-window visibility contract tests passed');
