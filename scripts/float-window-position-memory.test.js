'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
};
const keys = extract('    const MOBILE_FLOAT_POSITION_STORAGE_KEY', '    const PLUGIN_STORAGE_PARENT_DIR');
const mobileState = extract('    function loadMobileFloatBarPosition()', '    // 🔧 性能优化：悬浮窗事件处理函数引用');
const mobileCreate = extract('    function createDraggableFloatBar()', '    // 显示悬浮条（面包屑按钮点击时调用）');
const desktopState = extract('    let desktopFloatWindowState =', '    const desktopFloatWindowHandlers');
const desktopSet = extract('    function saveDesktopFloatWindowBounds()', '    function setDesktopMinimizedFloatWindowExpanded');
const desktopGeometry = extract('    function getDesktopFloatWindowStoredBoundsFromDisplayBounds', '    function getDesktopFloatWindowElectronSupport');
const desktopPosition = extract('    function positionDesktopMinimizedFloatWindow', '    async function refreshDesktopMinimizedFloatWindow');
const mobileKey = /MOBILE_FLOAT_POSITION_STORAGE_KEY = '([^']+)'/.exec(keys)[1];
const desktopKey = /DESKTOP_FLOAT_BOUNDS_STORAGE_KEY = '([^']+)'/.exec(keys)[1];
const values = new Map();
const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
};

function mobile(localStorage = storage, width = 390, height = 844) {
    const nodes = new Map();
    const documentHandlers = {};
    const windowHandlers = {};
    const element = () => ({
        style: {}, children: [], handlers: {},
        classList: { add() {}, remove() {} },
        appendChild(child) { this.children.push(child); },
        setAttribute() {}, querySelector: () => ({ textContent: '' }),
        closest: () => null, contains: () => true,
        addEventListener(name, handler) { this.handlers[name] = handler; },
    });
    const context = vm.createContext({
        localStorage,
        window: { innerWidth: width, innerHeight: height, addEventListener: (name, fn) => { windowHandlers[name] = fn; } },
        document: {
            getElementById: id => nodes.get(id), createElement: element,
            body: { appendChild: node => nodes.set(node.id, node) },
            addEventListener: (name, fn) => { documentHandlers[name] = fn; },
        },
        Logger: { info() {} }, floatBarHiddenByUser: false,
        timerMode: 'stopwatch', elapsedSeconds: 0, stopwatchDisplayOffset: 0, remainingSeconds: 0,
        isRunning: false, isContextMenuOpen: false, isLongPress: false, floatBarLongPressTimer: null,
        container: null, timeDisplay: null, controlButton: null, floatBarEventHandlers: {},
        getDisplayPrefixForTimer: () => '', formatTime: () => '00:00',
        setTimeout: () => 1, clearTimeout() {}, isMobileDevice: () => true,
    });
    vm.runInContext(`${keys}\n${mobileState}\n${mobileCreate}\ncreateDraggableFloatBar();`, context);
    return { context, bar: nodes.get('siyuan-tomato-float-bar'), documentHandlers, windowHandlers };
}

function desktop(localStorage = storage, circular = false, area = { x: 0, y: 0, width: 1920, height: 1080 }) {
    let bounds = null;
    const win = { isDestroyed: () => false, setBounds: value => { bounds = { ...value }; } };
    const context = vm.createContext({
        localStorage, desktopFloatWindowDragState: null,
        desktopFloatWindowIgnoreMoveUntilMs: 0, desktopFloatWindowProgrammaticBounds: null,
        DESKTOP_FLOAT_WINDOW_DEFAULT_RIGHT_MARGIN: 20, DESKTOP_FLOAT_WINDOW_EXPANDED_EXTRA_LEFT_OFFSET: 10,
        isDesktopFloatWindowCircularTimerStyleEnabled: () => circular,
        getDesktopFloatWindowCompactWidth: () => circular ? 72 : 95,
        getDesktopFloatWindowExpandedWidth: () => circular ? 115 : 120,
        getDesktopFloatWindowCurrentHeight: () => circular ? 72 : 68,
        getDesktopFloatWindowCollapsedHeight: () => circular ? 72 : 44,
        getDesktopFloatWindowDesiredWidth: () => circular ? 115 : 95,
        getDesktopFloatWindowPayload: () => ({}),
        getDesktopFloatWindowElectronSupport: () => ({ screen: {
            getDisplayMatching: () => ({ workArea: area }),
            getPrimaryDisplay: () => ({ workArea: area }),
        } }),
    });
    vm.runInContext(`${keys}\n${desktopState}\n${desktopSet}\n${desktopGeometry}\n${desktopPosition}`, context);
    return { context, win, bounds: () => bounds };
}

// Touch drag, then a fresh runtime reading the same device-local storage.
let phone = mobile();
phone.bar.handlers.touchstart({ target: phone.bar, touches: [{ clientX: 320, clientY: 670 }] });
phone.documentHandlers.touchmove({ touches: [{ clientX: 300, clientY: 640 }] });
phone.documentHandlers.touchmove({ touches: [{ clientX: 240, clientY: 600 }] });
phone.documentHandlers.touchend();
assert.ok(values.has(mobileKey), 'touch release must persist the position');
const original = values.get(mobileKey);
const moved = JSON.parse(original);
phone = mobile();
assert.equal(phone.bar.style.left, `${moved.x}px`);
assert.equal(phone.bar.style.top, `${moved.y}px`);
phone.context.window.innerHeight = 300;
phone.windowHandlers.resize();
assert.ok(parseFloat(phone.bar.style.top) <= 228, 'keyboard viewport must keep the bar visible');
assert.equal(values.get(mobileKey), original, 'keyboard resize must not overwrite the drag position');
phone.context.window.innerHeight = 844;
phone.windowHandlers.resize();
assert.equal(phone.bar.style.top, `${moved.y}px`, 'closing keyboard must restore the drag position');
const smallPhone = mobile(storage, 240, 300);
assert.ok(parseFloat(smallPhone.bar.style.left) <= 196);
assert.ok(parseFloat(smallPhone.bar.style.top) <= 236);

for (const circular of [false, true]) {
    values.delete(desktopKey);
    let app = desktop(storage, circular);
    const expected = { x: 850, y: 720, width: circular ? 115 : 95, height: circular ? 72 : 68 };
    app.context.desktopFloatWindowDragState = {};
    app.context.setDesktopFloatWindowBounds(app.win, expected);
    assert.equal(values.has(desktopKey), false, 'drag frames must not synchronously write localStorage');
    app.context.desktopFloatWindowDragState = null;
    app.context.saveDesktopFloatWindowBounds();
    app = desktop(storage, circular);
    app.context.positionDesktopMinimizedFloatWindow(app.win);
    assert.deepEqual(app.bounds(), expected, 'reload must preserve the visible position for both styles');

    // Coordinates on a display to the left remain valid; removing that display recovers on the primary screen.
    app.context.setDesktopFloatWindowBounds(app.win, { ...expected, x: -900, y: 200 });
    app = desktop(storage, circular, { x: -1920, y: 0, width: 1920, height: 1080 });
    app.context.positionDesktopMinimizedFloatWindow(app.win);
    assert.equal(app.bounds().x, -900);
    app = desktop(storage, circular);
    app.context.positionDesktopMinimizedFloatWindow(app.win);
    assert.ok(app.bounds().x >= 0 && app.bounds().x + app.bounds().width <= 1920);
}
assert.equal(values.get(mobileKey), original, 'desktop positioning must not overwrite mobile coordinates');

for (const bad of ['invalid json', '{"x":null,"y":50}', '{"x":"50","y":80}']) {
    values.set(mobileKey, bad);
    values.set(desktopKey, bad);
    assert.doesNotThrow(() => mobile());
    const app = desktop();
    app.context.positionDesktopMinimizedFloatWindow(app.win);
    assert.equal(app.bounds().x, 1805, 'invalid coordinates must use the default position');
}
const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
assert.doesNotThrow(() => mobile(denied));
const app = desktop(denied);
assert.doesNotThrow(() => app.context.positionDesktopMinimizedFloatWindow(app.win));
console.log('float window position memory tests passed');
