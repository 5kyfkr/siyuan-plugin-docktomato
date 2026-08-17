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
assert.ok(start >= 0 && end > start, 'statistics startup runtime must remain extractable');
assert.match(source, /await loadTomatoScript\(\);[\s\S]*void initializeTomatoStats\(this\)/,
    'the timer script must load before optional statistics startup begins');

function createHarness({ fallbackMeta, fetchText }) {
    const events = [];
    const storage = new Map();
    if (fallbackMeta != null) storage.set('siyuan-tomato-history-fallback-meta', fallbackMeta);
    const context = vm.createContext({
        AbortController,
        CustomEvent: class CustomEvent {
            constructor(type, init) { this.type = type; this.detail = init?.detail; }
        },
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
        TOMATO_HISTORY_INDEX_PATH: '/history/history-index.json',
        TOMATO_STATS_STARTUP_TIMEOUT_MS: 20,
        clearTimeout,
        console,
        fetchText,
        globalThis: null,
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
            removeItem: (key) => storage.delete(key),
            setItem: (key, value) => storage.set(key, String(value)),
        },
        loadTomatoStatsCore: async () => true,
        setTimeout,
        statsCore,
        window: { dispatchEvent: (event) => events.push(event) },
    });
    context.globalThis = context;
    context.__dockTomato = { history: { loadAll: async () => [], loadRange: async () => [] } };
    vm.runInContext(`
        let tomatoStatsCore = statsCore;
        let tomatoStatsStartupGeneration = 0;
        ${source.slice(start, end)}
        this.initializeTomatoStats = initializeTomatoStats;
    `, context);
    return { context, events };
}

(async () => {
    const malformed = createHarness({
        fallbackMeta: '{broken',
        fetchText: async () => '{}',
    });
    assert.equal(await malformed.context.initializeTomatoStats({ _isUnloaded: false }), null);
    assert.equal(malformed.context.__dockTomatoStatsFacade, undefined);
    assert.equal(malformed.events.at(-1)?.detail?.available, false,
        'malformed fallback metadata must disable only statistics');

    const hanging = createHarness({
        fallbackMeta: JSON.stringify({ updatedAt: 100, recordCount: 1 }),
        fetchText: async (_url, _data, options) => new Promise((resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const startedAt = Date.now();
    assert.equal(await hanging.context.initializeTomatoStats({ _isUnloaded: false }), null);
    assert.ok(Date.now() - startedAt < 500, 'a hanging history-index read must obey the total startup deadline');
    assert.equal(hanging.context.__dockTomatoStatsFacade, undefined);
    assert.equal(hanging.events.at(-1)?.detail?.available, false);

    console.log('stats startup isolation tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
