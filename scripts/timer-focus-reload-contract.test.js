'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const segment = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing segment start: ${start}`);
    assert.notEqual(to, -1, `missing segment end: ${end}`);
    return source.slice(from, to);
};

const restoreFocus = segment('function restoreActiveTimerFocus', 'function highlightDatabaseRow');
assert.match(restoreFocus, /!isRunning && !isTimerPaused && !\['RUNNING', 'PAUSED'\]\.includes\(syncStatus\)/, 'focus restoration must only run for an active or paused timer');
assert.match(restoreFocus, /tomato:focus-restored/, 'focus restoration must notify integrations');

const focusSnapshot = segment('function getActiveTimerFocusSnapshot', 'function restoreActiveTimerFocus');
assert.match(focusSnapshot, /mode !== 'countdown' && mode !== 'stopwatch'/, 'focus snapshots must exclude break and idle modes');
assert.match(focusSnapshot, /!isRunning && !isTimerPaused && !\['RUNNING', 'PAUSED'\]\.includes\(syncStatus\)/, 'focus snapshots must require an active or paused timer');
assert.match(focusSnapshot, /currentTaskBlockId \|\| syncState\?\.taskBlockId/, 'focus snapshots must expose the live linked task');

const timerBridge = segment('globalThis.__tomatoTimer = {', 'async function saveBlockReminder');
assert.match(timerBridge, /getActiveFocusSnapshot:[\s\S]*getActiveTimerFocusSnapshot/, 'the timer bridge must expose a read-only active focus snapshot');
assert.match(timerBridge, /restoreActiveFocus:[\s\S]*restoreActiveTimerFocus/, 'the timer bridge must expose active focus restoration for plugin reloads');

console.log('timer focus reload contract tests passed');
