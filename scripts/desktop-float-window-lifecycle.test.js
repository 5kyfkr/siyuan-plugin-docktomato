'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${start} must remain extractable`);
    return source.slice(from, to);
};
const lifecycleSource = extract('    function bindDesktopFloatWindowOwnerLifecycle(', '    function positionDesktopMinimizedFloatWindow(');
const syncSource = extract('    async function syncDesktopMinimizedFloatWindow(', '    function handleDesktopFloatWindowThemeMaybeChanged(');
const eligibilitySource = extract('    const isDesktopMinimizedFloatWindowEnabled =', '    const getDesktopFloatWindowDisplayMode =');

class FakeContents extends EventEmitter {
    destroyed = false;
    isDestroyed() { return this.destroyed; }
    destroy() {
        this.destroyed = true;
        this.emit('destroyed');
    }
}

class FakeWindow extends EventEmitter {
    destroyed = false;
    destroyCalls = 0;
    showCalls = 0;
    webContents = new FakeContents();
    constructor(options = {}) {
        super();
        this.options = options;
        this.loading = Promise.withResolvers();
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.showCalls > 0; }
    isMinimized() { return true; }
    loadURL() { return this.loading.promise; }
    setAlwaysOnTop() {}
    showInactive() { this.showCalls += 1; }
    close() { /* Simulate a close that is prevented by a page handler. */ }
    destroy() {
        if (this.destroyed) return;
        this.destroyCalls += 1;
        this.destroyed = true;
        this.webContents.destroy();
        this.emit('closed');
    }
}

const createHarness = ({ pathname = '/stage/build/app/', displayMode = 'minimized', mobile = false } = {}) => {
    const owner = new FakeWindow();
    const windows = [];
    let mainProcessBindings = 0;
    const support = {
        supported: true,
        currentWindow: owner,
        BrowserWindow: class extends FakeWindow {
            constructor(options) { super(options); windows.push(this); }
        },
        remote: {
            require(name) {
                assert.equal(name, 'vm');
                return {
                    runInThisContext(code) {
                        mainProcessBindings += 1;
                        // No renderer globals are available to the lifecycle callbacks.
                        return vm.runInNewContext(code, {});
                    },
                };
            },
        },
    };
    const context = vm.createContext({
        window: { location: { pathname } },
        isMobileDevice: () => mobile,
        __tomatoDestroyed: false,
        desktopFloatWindow: null,
        desktopFloatWindowReady: false,
        desktopFloatWindowLastPayloadKey: '',
        desktopFloatWindowLastResolvedColorMode: '',
        desktopFloatWindowState: { alwaysOnTop: true },
        desktopFloatWindowSyncTimer: null,
        desktopFloatWindowSyncInFlight: false,
        desktopFloatWindowSyncPendingReason: '',
        getDesktopFloatWindowElectronSupport: () => support,
        getDesktopFloatWindowExpandedWidth: () => 200,
        getDesktopFloatWindowExpandedHeight: () => 68,
        applyDesktopFloatWindowOpacity() {},
        buildDesktopFloatWindowHtml: () => '<html></html>',
        getDesktopFloatWindowDisplayMode: () => displayMode,
        hasUnfinishedTimerState: () => true,
        shouldShowDesktopMinimizedFloatWindowForTimerState: () => true,
        shouldShowDesktopFloatWindow: () => true,
        handleDesktopFloatWindowThemeMaybeChanged() {},
        positionDesktopMinimizedFloatWindow() {},
        refreshDesktopMinimizedFloatWindow: async () => {},
        __tomatoTrackTimeout() { throw new Error('disposed runtime must not schedule work'); },
        Logger: { warn() {}, debug() {} },
    });
    vm.runInContext(eligibilitySource + lifecycleSource + syncSource, context);
    return { context, owner, windows, bindings: () => mainProcessBindings };
};

const assertDetached = (owner) => {
    assert.equal(owner.listenerCount('closed'), 0);
    assert.equal(owner.webContents.listenerCount('destroyed'), 0);
    assert.equal(owner.webContents.listenerCount('render-process-gone'), 0);
};

(async () => {
    // Inbox uses SiYuan openWindow(), whose window.html loads plugins again.
    // Each renderer has its own desktopFloatWindow variable; only the main
    // renderer should create the detached timer shared by the workspace.
    for (const displayMode of ['always', 'minimized']) {
        const main = createHarness({ displayMode });
        const inbox = createHarness({ displayMode, pathname: '/stage/build/app/window.html' });
        const syncingMain = main.context.syncDesktopMinimizedFloatWindow();
        const syncingInbox = inbox.context.syncDesktopMinimizedFloatWindow();
        main.windows[0].loading.resolve();
        // Resolve any duplicate so the old implementation fails, not hangs.
        for (const win of inbox.windows) win.loading.resolve();
        await Promise.all([syncingMain, syncingInbox]);
        assert.equal(main.windows.length, 1, `${displayMode}: main window must keep its timer`);
        assert.equal(main.windows[0].showCalls, 1);
        assert.equal(inbox.windows.length, 0, `${displayMode}: an auxiliary window must not create a second timer`);
        assert.equal(await inbox.context.ensureDesktopMinimizedFloatWindow(), null,
            'direct creation must also reject auxiliary windows');
        await inbox.context.syncDesktopMinimizedFloatWindow('drag-or-refresh');
        assert.equal(inbox.windows.length, 0, 'repeated auxiliary refreshes must not recreate a timer');
        main.context.closeDesktopMinimizedFloatWindow();
        assertDetached(main.owner);
        assertDetached(inbox.owner);
    }

    for (const options of [{ displayMode: 'off' }, { mobile: true }]) {
        const disabled = createHarness(options);
        await disabled.context.syncDesktopMinimizedFloatWindow();
        assert.equal(await disabled.context.ensureDesktopMinimizedFloatWindow(), null);
        assert.equal(disabled.windows.length, 0, 'disabled or mobile runtimes must never create a desktop timer');
    }

    const a = createHarness();
    const b = createHarness();
    const loadingA = a.context.ensureDesktopMinimizedFloatWindow();
    const loadingB = b.context.ensureDesktopMinimizedFloatWindow();
    const oldA = a.windows[0];
    const activeB = b.windows[0];
    assert.equal(a.bindings(), 1, 'creation must bind lifecycle inside the main process');
    assert.equal(oldA.options.parent, undefined, 'minimized timer must remain an independent native window');
    oldA.loading.resolve();
    activeB.loading.resolve();
    await Promise.all([loadingA, loadingB]);
    a.owner.emit('minimize');
    a.owner.emit('hide');
    assert.equal(oldA.isDestroyed(), false, 'minimizing or hiding the workspace must retain the timer');

    // SiYuan calls destroy(), skipping renderer beforeunload and plugin onunload.
    a.owner.destroy();
    assert.equal(oldA.isDestroyed(), true, 'exiting workspace A must destroy its detached timer');
    assert.equal(activeB.isDestroyed(), false, 'workspace B must remain unaffected');
    assertDetached(a.owner);
    const reopened = createHarness();
    const loadingReopened = reopened.context.ensureDesktopMinimizedFloatWindow();
    reopened.windows[0].loading.resolve();
    await loadingReopened;
    assert.equal([oldA, reopened.windows[0]].filter(win => !win.isDestroyed()).length, 1,
        'reopening workspace A must leave only its new timer alive');

    for (const event of ['closed', 'destroyed', 'render-process-gone']) {
        const h = createHarness();
        const loading = h.context.ensureDesktopMinimizedFloatWindow();
        const win = h.windows[0];
        const emitter = event === 'closed' ? h.owner : h.owner.webContents;
        emitter.emit(event);
        assert.equal(win.isDestroyed(), true, `${event} must close the timer even during loading`);
        win.loading.resolve();
        assert.equal(await loading, null);
        assert.equal(h.context.desktopFloatWindowReady, false);
        assertDetached(h.owner);
    }

    const unloading = createHarness();
    const pendingSync = unloading.context.syncDesktopMinimizedFloatWindow();
    const unloadingWindow = unloading.windows[0];
    unloading.context.__tomatoDestroyed = true;
    unloading.context.closeDesktopMinimizedFloatWindow();
    unloading.context.closeDesktopMinimizedFloatWindow();
    unloadingWindow.loading.resolve();
    await pendingSync;
    assert.equal(unloadingWindow.destroyCalls, 1, 'cleanup must force destruction and be repeatable');
    assert.equal(unloadingWindow.showCalls, 0, 'loading must not redisplay a disposed timer');
    assert.equal(await unloading.context.ensureDesktopMinimizedFloatWindow(), null);
    unloading.context.scheduleDesktopMinimizedFloatWindowSync('late-callback');
    assert.equal(unloading.windows.length, 1, 'late callbacks must not recreate a disposed timer');
    assertDetached(unloading.owner);

    const refreshing = createHarness();
    const refresh = Promise.withResolvers();
    const refreshStarted = Promise.withResolvers();
    refreshing.context.refreshDesktopMinimizedFloatWindow = () => {
        refreshStarted.resolve();
        return refresh.promise;
    };
    const pendingRefresh = refreshing.context.syncDesktopMinimizedFloatWindow();
    refreshing.windows[0].loading.resolve();
    await refreshStarted.promise;
    refreshing.context.__tomatoDestroyed = true;
    refreshing.context.closeDesktopMinimizedFloatWindow();
    refresh.resolve();
    await pendingRefresh;
    assert.equal(refreshing.windows[0].showCalls, 0, 'refresh completion must not show a disposed timer');

    const replaced = createHarness();
    const oldLoad = replaced.context.ensureDesktopMinimizedFloatWindow();
    const oldWindow = replaced.windows[0];
    replaced.context.closeDesktopMinimizedFloatWindow();
    const newLoad = replaced.context.ensureDesktopMinimizedFloatWindow();
    const newWindow = replaced.windows[1];
    oldWindow.loading.reject(new Error('ERR_ABORTED'));
    assert.equal(await oldLoad, null);
    assert.equal(newWindow.isDestroyed(), false, 'a stale load rejection must not close the replacement');
    newWindow.loading.resolve();
    assert.equal(await newLoad, newWindow);
    replaced.context.closeDesktopMinimizedFloatWindow();
    assertDetached(replaced.owner);

    const closedOwner = createHarness();
    closedOwner.owner.destroy();
    assert.equal(await closedOwner.context.ensureDesktopMinimizedFloatWindow(), null);
    assert.equal(closedOwner.windows.length, 0, 'a closed workspace must never create a timer');
    b.owner.destroy();
    reopened.owner.destroy();
    console.log('desktop float-window lifecycle tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
