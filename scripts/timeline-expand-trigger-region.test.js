'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const helperStart = source.indexOf('    function normalizeTimelineExpandTriggerSettings(');
const helperEnd = source.indexOf('    function ensureTimelineSettings()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'timeline trigger helpers must remain extractable');

const helperBlock = source.slice(helperStart, helperEnd);
const helpers = Function(`
    ${helperBlock}
    return {
        normalizeTimelineExpandTriggerSettings,
        isClientXWithinTimelineExpandTriggerRegion
    };
`)();
const { normalizeTimelineExpandTriggerSettings, isClientXWithinTimelineExpandTriggerRegion } = helpers;

assert.deepEqual(normalizeTimelineExpandTriggerSettings({}), {
    startPercent: 0,
    widthPercent: 100,
    endPercent: 100
}, 'missing settings must preserve the legacy full-width trigger');
assert.deepEqual(normalizeTimelineExpandTriggerSettings({
    expandTriggerStartPercent: '',
    expandTriggerWidthPercent: null
}), {
    startPercent: 0,
    widthPercent: 100,
    endPercent: 100
}, 'empty or null settings must fall back to the full-width trigger');
assert.deepEqual(normalizeTimelineExpandTriggerSettings({
    expandTriggerStartPercent: -20,
    expandTriggerWidthPercent: 1
}), {
    startPercent: 0,
    widthPercent: 5,
    endPercent: 5
}, 'the trigger must enforce its minimum width and left boundary');
assert.deepEqual(normalizeTimelineExpandTriggerSettings({
    expandTriggerStartPercent: 70,
    expandTriggerWidthPercent: 130
}), {
    startPercent: 0,
    widthPercent: 100,
    endPercent: 100
}, 'a full-width trigger must start at the left edge');
assert.deepEqual(normalizeTimelineExpandTriggerSettings({
    expandTriggerStartPercent: 90,
    expandTriggerWidthPercent: 30
}), {
    startPercent: 70,
    widthPercent: 30,
    endPercent: 100
}, 'the trigger start must keep the selected width inside the timeline');
assert.deepEqual(normalizeTimelineExpandTriggerSettings({
    expandTriggerStartPercent: 12.6,
    expandTriggerWidthPercent: 20.4
}), {
    startPercent: 13,
    widthPercent: 20,
    endPercent: 33
}, 'persisted percentages must be rounded to whole numbers');

const rect = { left: 100, width: 1000 };
const regionSettings = {
    expandTriggerStartPercent: 30,
    expandTriggerWidthPercent: 40
};
assert.equal(isClientXWithinTimelineExpandTriggerRegion(400, rect, regionSettings), true,
    'the left trigger boundary must be included');
assert.equal(isClientXWithinTimelineExpandTriggerRegion(800, rect, regionSettings), true,
    'the right trigger boundary must be included');
assert.equal(isClientXWithinTimelineExpandTriggerRegion(399.9, rect, regionSettings), false,
    'points before the trigger must not match');
assert.equal(isClientXWithinTimelineExpandTriggerRegion(800.1, rect, regionSettings), false,
    'points after the trigger must not match');
assert.equal(isClientXWithinTimelineExpandTriggerRegion(400, { left: 100, width: 0 }, regionSettings), false,
    'a missing timeline width must not trigger expansion');

assert.match(source, /expandTriggerStartPercent:\s*0,[\s\S]*expandTriggerWidthPercent:\s*100,/, 
    'default settings must expose the full-width trigger fields');
assert.match(source, /createTimelineExpandTriggerRegionEditor\(userSettings\.timeline\)/,
    'timeline settings must render the trigger editor');
assert.match(source, /expandTriggerEditor\.getValue\(\)[\s\S]*expandTriggerStartPercent[\s\S]*expandTriggerWidthPercent/,
    'saving timeline settings must persist the editor draft');

const timelineStart = source.indexOf('    function createTimelineBar()');
const timelineEnd = source.indexOf('    function hideTimelineBar()', timelineStart);
assert.ok(timelineStart >= 0 && timelineEnd > timelineStart, 'timeline runtime must remain extractable');
const timelineBlock = source.slice(timelineStart, timelineEnd);
const desktopTriggerCalls = timelineBlock.match(/isTimelineExpandTriggerPoint\(e\.clientX\)/g) || [];
assert.equal(desktopTriggerCalls.length, 3,
    'mouseenter, mousemove, and desktop empty-click expansion must share the trigger-region check');

const mobileTouchStart = timelineBlock.indexOf("timelineBar.addEventListener('touchstart'");
const mobileTouchEnd = timelineBlock.indexOf('document.body.appendChild(timelineBar)', mobileTouchStart);
assert.ok(mobileTouchStart >= 0 && mobileTouchEnd > mobileTouchStart, 'mobile touch behavior must remain extractable');
const mobileTouchBlock = timelineBlock.slice(mobileTouchStart, mobileTouchEnd);
assert.doesNotMatch(mobileTouchBlock, /isTimelineExpandTriggerPoint/,
    'mobile expansion and collapse gestures must remain independent of the desktop trigger region');

console.log('timeline expand trigger region tests passed');
