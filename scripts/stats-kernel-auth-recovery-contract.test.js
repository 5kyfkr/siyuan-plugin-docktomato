'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const statsCore = require(path.join(root, 'kernel.js'));
const start = source.indexOf('const installTomatoStatsFacade = async (plugin, options = {}) => {');
const end = source.indexOf('\n\nconst saveMainSettings', start);
assert.ok(start >= 0 && end > start, 'statistics facade installer must remain extractable');
const installerSource = source.slice(start, end);

assert.match(installerSource, /kernelSessionAuthError = "Auth failed \[session\]"/,
    'statistics recovery must match the exact SiYuan session error');
assert.match(installerSource, /retryableKernelReads = new Set\(\[[\s\S]*dockTomatoQueryFocus[\s\S]*\]\)/,
    'statistics reads must be explicitly retryable');
assert.doesNotMatch(installerSource.match(/retryableKernelReads = new Set\(\[[\s\S]*?\]\)/)?.[0] || '', /dockTomatoSetHistoryFallback/,
    'fallback writes must never be replayed automatically');
assert.match(installerSource, /kernelSessionRecoveryPromise[\s\S]*\/api\/petal\/setPetalEnabled[\s\S]*packageName: PLUGIN_ID[\s\S]*enabled: true/,
    'statistics recovery must be single-flight and restart only DockTomato');

const records = [{
    start: '2026-08-16T00:00:00.000Z',
    end: '2026-08-16T00:02:00.000Z',
    durationSec: 120,
    mode: 'stopwatch',
    taskBlockId: 'task-a',
    sessionId: 'session-a',
}];
const storage = new Map();
let focusCalls = 0;
let recoveryFetches = 0;
let resolveRecovery;
const plugin = {
    app: { appId: 'app-contract' },
    kernel: {
        rpc: {
            call: {
                dockTomatoSetHistoryFallback: async (payload) => ({
                    ok: true,
                    data: { active: payload.active === true, revision: payload.revision },
                }),
                dockTomatoQueryFocus: async (options) => {
                    focusCalls += 1;
                    if (focusCalls <= 2) {
                        return { ok: false, error: { code: 'STORAGE_ERROR', message: 'Auth failed [session]' } };
                    }
                    return { ok: true, data: statsCore.queryFocus(records, options) };
                },
            },
        },
    },
};
const context = vm.createContext({
    console,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    PLUGIN_ID: 'siyuan-plugin-docktomato',
    TOMATO_HISTORY_INDEX_PATH: '/history/history-index.json',
    fetchText: async () => JSON.stringify({ revision: 0, shards: {} }),
    fetch: async (url, init) => {
        recoveryFetches += 1;
        assert.equal(url, '/api/petal/setPetalEnabled');
        assert.deepEqual(JSON.parse(init.body), {
            packageName: 'siyuan-plugin-docktomato',
            enabled: true,
            app: 'app-contract',
        });
        return await new Promise((resolve) => {
            resolveRecovery = () => resolve({
                ok: true,
                status: 200,
                json: async () => ({ code: 0 }),
            });
        });
    },
    localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
    },
    statsCore,
    plugin,
    setTimeout,
    clearTimeout,
    globalThis: null,
});
context.globalThis = context;
context.__dockTomato = {
    history: {
        loadRange: async () => records,
        loadAll: async () => records,
    },
};

vm.runInContext(`
    let tomatoStatsCore = statsCore;
    ${installerSource}
    this.installTomatoStatsFacade = installTomatoStatsFacade;
`, context);

(async () => {
    const facade = await context.installTomatoStatsFacade(plugin);
    const options = {
        from: '2026-08-16T00:00:00.000Z',
        to: '2026-08-17T00:00:00.000Z',
        bucket: 'none',
    };
    const first = facade.queryFocus(options);
    const second = facade.queryFocus(options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(recoveryFetches, 1, 'concurrent stale reads must share one recovery');
    resolveRecovery();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].totals.focusSec, 120);
    assert.equal(results[1].totals.focusSec, 120);
    assert.equal(focusCalls, 4, 'each pure read must retry exactly once');
    assert.equal(recoveryFetches, 1, 'recovery must not multiply with concurrent homepage reads');
    console.log('stats Kernel auth recovery contract tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
