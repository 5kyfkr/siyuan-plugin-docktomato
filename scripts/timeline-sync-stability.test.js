const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('function renderTimelineActiveSegments');
const end = source.indexOf('\n    function applyProgressBarVisual', start);
assert(start >= 0 && end > start, 'timeline active renderer must be present');
const block = source.slice(start, end);
const updateStart = source.indexOf('function updateTimelineBar');
const updateEnd = source.indexOf('\n    const timelineHistoryCacheByDateKey', updateStart);
assert(updateStart >= 0 && updateEnd > updateStart, 'timeline updater must be present');
const updateBlock = source.slice(updateStart, updateEnd);

assert.match(block, /const activeTimerSnapshot = syncState\?\.activeTimer/,
    'timeline rendering must inspect the canonical active timer snapshot');
assert.match(block, /const activeMode = syncActive \? \(syncState\.mode \|\| timerMode\) : timerMode/,
    'a valid sync snapshot must provide the authoritative timeline mode');
assert.match(block, /const timelineDurationMin = Number\.isFinite\(syncedDurationSec\)/,
    'timeline duration must be projected from the sync snapshot');
assert.match(block, /const timelineStartValue = syncActive\s*\n\s*\? \(syncState\.startTime \|\| activeTimerSnapshot\?\.segmentStartMs/,
    'timeline start must stay tied to the accepted sync snapshot');
assert.match(block, /const syncedRemainingSeconds = syncActive && effectivePaused/,
    'paused remote timers must calculate progress from the same sync snapshot');
assert.match(block, /if \(activeMode === 'countdown'\)/,
    'countdown rendering must use the stable projected mode');
assert.doesNotMatch(block, /if \(timerMode === 'countdown'\)/,
    'countdown rendering must not branch directly on the mutable legacy mode');
assert.doesNotMatch(updateBlock, /if \(force\)\s*\{\s*clearTimelineActiveLayers\(\);/,
    'forced timeline refreshes must reconcile active segments without clearing the layer first');

console.log('timeline sync stability contract tests passed');
