'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('    function updateTimelineBar(');
const end = source.indexOf('    const timelineHistoryCacheByDateKey', start);
assert(start >= 0 && end > start);

const line = {parentElement: {clientWidth: 800}, style: {}};
const context = vm.createContext({
    userSettings: {timeline: {enabled: true}, appearance: {}},
    timelineBar: {parentNode: {}, style: {}, dataset: {}},
    timelineVisual: null, timelineViewport: null, timelineNowLine: line,
    timelineDateOverlay: null, timelineDayPages: [],
    isTimelineExpanded: false, lastTimelineUpdateSecond: null,
    lastTimelineAxisKey: null, lastTimelineLayoutKey: null, lastTimelineZoomKey: null,
    timelineFullDayLocked: false, isTimelineUserDragging: false,
    timelineDisplayMap: {}, timelineAxisLabelScaleX: 1,
    ensureTimelineSettings() {}, shouldHideMobileBottomEffects: () => false,
    getTimelineRangeState: () => ({}),
    getTimelineHiddenTimeRangeState: () => ({enabled: false, duration: 0}),
    getTimelineHighlightPalette: () => ({key: 'default'})
});
vm.runInContext(source.slice(start, end), context);
const renderAt = (nowMinutes, range = {}) => {
    context.getTimelineRangeState = () => ({rangeStartMin: 0, rangeEndMin: 1440, nowMinutes,
        shouldApplyCustomRange: false, ...range});
    vm.runInContext('updateTimelineBar(true)', context);
};
renderAt(720);
assert.equal(line.style.transform, 'translate3d(400px, 0, 0)', 'full-day noon position must stay centered');
renderAt(720, {rangeStartMin: 480, rangeEndMin: 1440, shouldApplyCustomRange: true});
assert.equal(line.style.transform, 'translate3d(200px, 0, 0)', 'zoomed ranges must use the visible page width');
line.parentElement.clientWidth = 320;
renderAt(720);
assert.equal(line.style.transform, 'translate3d(160px, 0, 0)', 'resizing must update the pixel displacement');
renderAt(0, {rangeStartMin: 480, rangeEndMin: 1440, shouldApplyCustomRange: true});
assert.equal(line.style.transform, 'translate3d(0px, 0, 0)', 'out-of-range times must remain clamped to the left edge');
renderAt(1440);
assert.equal(line.style.transform, 'translate3d(320px, 0, 0)', 'the day end must align with the right edge');
context.getTimelineHiddenTimeRangeState = () => ({enabled: true, startMin: 0, endMin: 360, duration: 360});
context.mapTimelineMinuteToDisplay = minute => minute - 360;
renderAt(900);
assert.equal(line.style.transform, 'translate3d(160px, 0, 0)', 'hidden-time compression must retain its mapped position');
renderAt(180);
assert.equal(line.style.display, 'none', 'the indicator must remain hidden within compressed-away time');
assert.equal(line.style.left, undefined, 'timer updates must no longer animate layout coordinates');

console.log('timeline now-line position tests passed');
