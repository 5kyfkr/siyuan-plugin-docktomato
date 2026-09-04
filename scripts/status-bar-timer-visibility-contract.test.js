'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

assert.match(source, /showDesktopStatusBarTimer:\s*true/,
    'desktop status-bar timer must remain visible by default');
assert.match(source, /typeof userSettings\.main\.showDesktopStatusBarTimer !== 'boolean'\) userSettings\.main\.showDesktopStatusBarTimer = true/,
    'legacy settings must default the desktop status-bar timer to visible');

const visibilityStart = source.indexOf('    function isDesktopStatusBarTimerEnabled()');
const visibilityEnd = source.indexOf('    function isLiveTomatoNode(', visibilityStart);
assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart, 'status-bar visibility helpers must remain extractable');
const visibilityBlock = source.slice(visibilityStart, visibilityEnd);
assert.match(visibilityBlock, /showDesktopStatusBarTimer !== false/,
    'only an explicit false setting may hide the desktop status-bar timer');
assert.match(visibilityBlock, /statusBar\?\.querySelector\?\.\('#siyuan-tomato-timer'\)/,
    'visibility changes must be scoped to the desktop status bar widget');
assert.match(visibilityBlock, /widget\.hidden = !visible[\s\S]*widget\.style\.display = visible \? 'flex' : 'none'/,
    'the widget must stop occupying layout space without being destroyed');
assert.doesNotMatch(visibilityBlock, /remove\(|hideTimelineBar|stopTimelineLoop|clearInterval/,
    'hiding the status widget must not remove UI or stop timer and timeline loops');

const settings = { main: { showDesktopStatusBarTimer: false } };
const widget = {
    hidden: false,
    style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
};
const statusBar = {
    querySelector(selector) { return selector === '#siyuan-tomato-timer' ? widget : null; },
};
const visibilityApi = new Function('userSettings', 'findDesktopTomatoStatusBar', `
    ${visibilityBlock}
    return { isDesktopStatusBarTimerEnabled, applyDesktopStatusBarTimerVisibility };
`)(settings, () => statusBar);
assert.equal(visibilityApi.applyDesktopStatusBarTimerVisibility(), true);
assert.equal(widget.hidden, true);
assert.equal(widget.style.display, 'none');
assert.equal(widget.attributes['aria-hidden'], 'true');
settings.main.showDesktopStatusBarTimer = true;
assert.equal(visibilityApi.applyDesktopStatusBarTimerVisibility(), true);
assert.equal(widget.hidden, false);
assert.equal(widget.style.display, 'flex');
assert.equal(widget.attributes['aria-hidden'], 'false');

const missingWidgetApi = new Function('userSettings', 'findDesktopTomatoStatusBar', `
    ${visibilityBlock}
    return { applyDesktopStatusBarTimerVisibility };
`)(settings, () => ({ querySelector: () => null }));
assert.equal(missingWidgetApi.applyDesktopStatusBarTimerVisibility(), false,
    'a missing desktop status widget must not affect timer operation');

const createStart = source.indexOf('    function createWidget(statusBar)');
const createEnd = source.indexOf('    // 更新任务块提示框内容', createStart);
assert.ok(createStart >= 0 && createEnd > createStart, 'desktop widget creation must remain extractable');
const createBlock = source.slice(createStart, createEnd);
assert.match(createBlock, /container\.hidden = !isDesktopStatusBarTimerEnabled\(\)/,
    'new status-bar widgets must inherit the saved visibility setting before insertion');
assert.match(createBlock, /statusBar\.appendChild\(container\);\s*applyDesktopStatusBarTimerVisibility\(\);\s*updateDisplay\(\);/,
    'widget creation must apply visibility while preserving normal display updates');

const initializeStart = source.indexOf('    function initialize()');
const initializeEnd = source.indexOf('    // 设置变更后的刷新函数', initializeStart);
assert.ok(initializeStart >= 0 && initializeEnd > initializeStart, 'timer initialization must remain extractable');
assert.match(source.slice(initializeStart, initializeEnd), /await loadUserSettings\(\);\s*if \(!isMobileDevice\(\)\) applyDesktopStatusBarTimerVisibility\(\);/,
    'saved status-bar visibility must be applied immediately after settings load');

const settingsStart = source.indexOf('    function renderMainSettings(container)');
const settingsEnd = source.indexOf('    function renderAudioSettings(', settingsStart);
assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, 'main settings must remain extractable');
const settingsBlock = source.slice(settingsStart, settingsEnd);
assert.match(settingsBlock, /mkToggleRow\('显示桌面底栏番茄钟', isDesktopStatusBarTimerEnabled\(\)/,
    'main settings must expose the desktop status-bar timer switch');
assert.match(settingsBlock, /showDesktopStatusBarTimer = e\.target\.checked;\s*applyDesktopStatusBarTimerVisibility\(\);\s*await saveUserSettings\(\);/,
    'the status-bar timer switch must apply immediately and persist afterward');
assert.match(settingsBlock, /关闭后仅隐藏底栏组件，计时、时间轴和悬浮窗不受影响/,
    'the switch must clearly describe its limited scope');
assert.ok(
    settingsBlock.indexOf("mkToggleRow('显示桌面底栏番茄钟'")
        < settingsBlock.indexOf("mkToggleRow('启用移动端支持'"),
    'the desktop status-bar timer switch must appear before mobile support settings',
);

console.log('status-bar timer visibility contract tests passed');
