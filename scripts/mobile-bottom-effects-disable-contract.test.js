'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

assert.match(source, /const shouldHideMobileBottomEffects = \(\) => \{[\s\S]*?isMobileDevice\(\) && \(!isMobileSupportEnabled\(\) \|\| mobileKeyboardVisible\)/,
    'mobile bottom effects must share the support and software-keyboard guard');

const progressCreateStart = source.indexOf('    function createProgressBar()');
const progressCreateEnd = source.indexOf('    function createProgressIndicator()', progressCreateStart);
const progressCreateBlock = source.slice(progressCreateStart, progressCreateEnd);
assert.match(progressCreateBlock, /shouldHideMobileBottomEffects\(\)[\s\S]*?removeProgressBarEffects\(\)[\s\S]*?return;/,
    'the progress bar must not be created while mobile support is disabled');

const indicatorCreateStart = progressCreateEnd;
const indicatorCreateEnd = source.indexOf('    let timelineBar = null;', indicatorCreateStart);
const indicatorCreateBlock = source.slice(indicatorCreateStart, indicatorCreateEnd);
assert.match(indicatorCreateBlock, /shouldHideMobileBottomEffects\(\)[\s\S]*?removeProgressBarEffects\(\)[\s\S]*?return;/,
    'the progress indicator must not be created while mobile support is disabled');

const timelineCreateStart = source.indexOf('    function createTimelineBar()');
const timelineCreateEnd = source.indexOf('    function hideTimelineBar()', timelineCreateStart);
const timelineCreateBlock = source.slice(timelineCreateStart, timelineCreateEnd);
assert.match(timelineCreateBlock, /shouldHideMobileBottomEffects\(\)[\s\S]*?hideTimelineBar\(\)[\s\S]*?return;/,
    'the bottom timeline must not be created while mobile support is disabled');

const timelineUpdateStart = source.indexOf('    function updateTimelineBar(');
const timelineUpdateEnd = source.indexOf('    function applyProgressBarVisual(', timelineUpdateStart);
const timelineUpdateBlock = source.slice(timelineUpdateStart, timelineUpdateEnd);
assert.match(timelineUpdateBlock, /shouldHideMobileBottomEffects\(\)[\s\S]*?hideTimelineBar\(\)[\s\S]*?return;/,
    'timeline refreshes must keep the mobile bottom area hidden');

const progressUpdateStart = source.indexOf('    function updateProgressBar(');
const progressUpdateEnd = source.indexOf('    function hideProgressBar()', progressUpdateStart);
const progressUpdateBlock = source.slice(progressUpdateStart, progressUpdateEnd);
assert.match(progressUpdateBlock, /shouldHideMobileBottomEffects\(\)[\s\S]*?hideTimelineBar\(\)[\s\S]*?removeProgressBarEffects\(\)[\s\S]*?return;/,
    'timer refreshes must remove every mobile bottom effect while support is disabled');

const mobileToggleStart = source.indexOf("        mkToggleRow('启用移动端支持'");
const mobileToggleEnd = source.indexOf("        mkToggleRow('显示移动端文档顶栏番茄按钮'", mobileToggleStart);
const mobileToggleBlock = source.slice(mobileToggleStart, mobileToggleEnd);
assert.match(mobileToggleBlock, /!isMobileSupportEnabled\(\)[\s\S]*?if \(isMobileDevice\(\)\)[\s\S]*?removeProgressBarEffects\(\)[\s\S]*?hideTimelineBar\(\)/,
    'turning off mobile support must immediately clear existing bottom effects');

const keyboardMonitorStart = source.indexOf('    function isMobileKeyboardEditableTarget(');
const keyboardMonitorEnd = source.indexOf('    // 移动端状态变量', keyboardMonitorStart);
const keyboardMonitorBlock = source.slice(keyboardMonitorStart, keyboardMonitorEnd);
assert.match(keyboardMonitorBlock, /window\.visualViewport[\s\S]*?keyboardThreshold[\s\S]*?viewportReduced && \(hasEditableFocus \|\| mobileKeyboardVisible\)[\s\S]*?mobileKeyboardVisible = nextVisible/,
    'software-keyboard detection must use viewport shrinkage while an editable element has focus');
assert.match(keyboardMonitorBlock, /mobileKeyboardVisible[\s\S]*?hideTimelineBar\(\)[\s\S]*?removeProgressBarEffects\(\)[\s\S]*?updateProgressBar\(false\)/,
    'keyboard opening must hide bottom effects and keyboard closing must restore them');
assert.match(keyboardMonitorBlock, /EventManager\.add\(document, 'focusin'[\s\S]*?EventManager\.add\(document, 'focusout'[\s\S]*?EventManager\.add\(window, 'resize'[\s\S]*?EventManager\.add\(window\.visualViewport, 'resize'/,
    'the keyboard monitor must react to focus and viewport changes through managed listeners');
assert.match(source, /await loadUserSettings\(\);[\s\S]*?installMobileKeyboardBottomEffectsMonitor\(\);/,
    'the mobile keyboard monitor must be installed after settings load');
assert.match(source, /mobileKeyboardCheckTimer != null[\s\S]*?mobileKeyboardMonitorInstalled = false/,
    'plugin cleanup must reset keyboard detection runtime state');

const keyboardCalls = {
    hideTimelineBar: 0,
    removeProgressBarEffects: 0,
    updateProgressBar: 0,
};
const keyboardContext = vm.createContext({
    window: { visualViewport: { height: 800 }, innerHeight: 800 },
    document: {
        body: {},
        documentElement: { clientHeight: 800 },
        activeElement: null,
    },
    isMobileDevice: () => true,
    mobileKeyboardVisible: false,
    mobileKeyboardBaselineHeight: 800,
    hideTimelineBar() { keyboardCalls.hideTimelineBar += 1; },
    removeProgressBarEffects() { keyboardCalls.removeProgressBarEffects += 1; },
    updateProgressBar() { keyboardCalls.updateProgressBar += 1; },
});
vm.runInContext(`
${keyboardMonitorBlock.slice(0, keyboardMonitorBlock.indexOf('    function scheduleMobileKeyboardBottomEffectsSync('))}
this.syncKeyboardEffects = syncMobileKeyboardBottomEffects;
`, keyboardContext);

keyboardContext.document.activeElement = {
    matches: () => true,
    closest: () => null,
};
keyboardContext.window.visualViewport.height = 500;
keyboardContext.syncKeyboardEffects();
assert.equal(keyboardContext.mobileKeyboardVisible, true,
    'a large visual viewport reduction with editable focus must be treated as an open software keyboard');
assert.equal(keyboardCalls.hideTimelineBar, 1,
    'opening the software keyboard must hide the timeline');
assert.equal(keyboardCalls.removeProgressBarEffects, 1,
    'opening the software keyboard must remove the progress effects');

keyboardContext.document.activeElement = keyboardContext.document.body;
keyboardContext.syncKeyboardEffects();
assert.equal(keyboardContext.mobileKeyboardVisible, true,
    'using the editor toolbar must keep keyboard mode active while the viewport remains reduced');
assert.equal(keyboardCalls.updateProgressBar, 0,
    'editor toolbar focus changes must not restore bottom effects over an open keyboard');

keyboardContext.window.visualViewport.height = 800;
keyboardContext.syncKeyboardEffects();
assert.equal(keyboardContext.mobileKeyboardVisible, false,
    'restoring the visual viewport must close keyboard mode');
assert.equal(keyboardCalls.updateProgressBar, 1,
    'closing the software keyboard must restore the configured bottom effect');

console.log('mobile bottom effects disable contract tests passed');
