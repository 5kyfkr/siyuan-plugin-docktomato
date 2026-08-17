'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
assert.match(source, /initializeTomatoStats[\s\S]*dispatchTomatoStatsAvailability\(true\)/,
    'the renderer must announce when the statistics facade becomes available');
assert.match(source, /__dockTomato\?\.stats === facade[\s\S]*__dockTomato\.stats = null[\s\S]*dispatchTomatoStatsAvailability\(false\)/,
    'plugin unload must remove the stale statistics facade and announce unavailability');
const statsCore = require(path.join(root, 'kernel.js'));
const start = source.indexOf('const installTomatoStatsFacade = async (plugin, options = {}) => {');
const end = source.indexOf('\n\nconst saveMainSettings', start);
assert.ok(start >= 0 && end > start, 'statistics facade installer must remain extractable');

const records = [{
    start: '2026-07-10T00:00:00.000Z',
    end: '2026-07-10T00:10:00.000Z',
    durationSec: 600,
    mode: 'stopwatch',
    taskBlockId: 'task-a',
    sessionId: 'session-a',
}];
let resolveHydration;
let kernelFocusError = null;
let kernelFocusErrorOnce = null;
let kernelFallbackRecords = null;
let localRangeReads = 0;
let localAllReads = 0;
let rejectFallbackSet = false;
let blockKernelFocus = false;
let blockedKernelFocus = null;
const cancelledKernelQueryIDs = [];
const hydrationCall = new Promise((resolve) => { resolveHydration = resolve; });
const plugin = {
    kernel: {
        rpc: {
            call: {
                dockTomatoQueryFocus: async (options) => {
                    if (blockKernelFocus) {
                        return new Promise((resolve) => {
                            blockedKernelFocus = { options, resolve };
                        });
                    }
                    if (kernelFocusErrorOnce) {
                        const error = kernelFocusErrorOnce;
                        kernelFocusErrorOnce = null;
                        return error;
                    }
                    return kernelFocusError || (kernelFallbackRecords
                        ? { ok: true, data: statsCore.queryFocus(kernelFallbackRecords, options), error: null }
                        : ({
                        ok: true,
                        data: {
                            contractVersion: 2,
                            totals: { focusSec: 0 },
                            associations: [],
                            meta: { source: 'legacy', recordCount: 0 },
                        },
                    }));
                },
                dockTomatoCancelStatsQuery: async ({ queryID }) => {
                    cancelledKernelQueryIDs.push(queryID);
                    if (blockedKernelFocus?.options?.queryID === queryID) {
                        blockedKernelFocus.resolve({
                            ok: false,
                            data: null,
                            error: { code: 'STATS_QUERY_ABORTED', message: 'aborted' },
                        });
                        blockedKernelFocus = null;
                    }
                    return { ok: true, data: { cancelled: true } };
                },
                dockTomatoSetHistoryFallback: async (payload) => {
                    if (rejectFallbackSet && payload.active === true) {
                        return { ok: false, error: { code: 'HISTORY_SOURCE_UNAVAILABLE', message: 'unavailable' } };
                    }
                    kernelFallbackRecords = payload.active === true && Array.isArray(payload.records) ? payload.records : null;
                    if (payload.active === true) setTimeout(() => resolveHydration(payload), 0);
                    return { ok: true, data: { active: payload.active === true, revision: payload.revision } };
                },
            },
        },
    },
};
const storage = new Map();
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
    statsCore,
    plugin,
    localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        removeItem: (key) => storage.delete(key),
    },
    globalThis: null,
});
context.globalThis = context;
context.__dockTomato = {
    history: {
        loadAll: async () => {
            localAllReads += 1;
            return records;
        },
        loadRange: async () => {
            localRangeReads += 1;
            return records;
        },
    },
};

vm.runInContext(`
    const TOMATO_HISTORY_INDEX_PATH = '/history/history-index.json';
    let tomatoStatsCore = statsCore;
    const fetchText = async () => JSON.stringify({ revision: 123, updatedAt: '2026-07-10T00:10:00.000Z' });
    ${source.slice(start, end)}
    this.installTomatoStatsFacade = installTomatoStatsFacade;
`, context);

(async () => {
    const facade = await context.installTomatoStatsFacade(plugin);
    blockKernelFocus = true;
    const queryController = new AbortController();
    const cancelledQuery = facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    }, { signal: queryController.signal });
    while (!blockedKernelFocus) await new Promise((resolve) => setImmediate(resolve));
    const blockedQueryID = blockedKernelFocus.options.queryID;
    queryController.abort();
    await assert.rejects(Promise.race([
        cancelledQuery,
        new Promise((_, reject) => setTimeout(() => reject(new Error('facade cancellation timed out')), 1000)),
    ]), (error) => error?.code === 'STATS_QUERY_ABORTED');
    assert.deepEqual(cancelledKernelQueryIDs, [blockedQueryID],
        'the facade must cancel the exact Kernel query owned by the aborted caller');
    blockKernelFocus = false;

    const result = await facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(result.meta.source, 'frontend-local-after-empty-kernel');
    assert.equal(result.totals.focusSec, 600);
    assert.equal(result.associations[0].candidateIds[0], 'task-a');
    const hydrated = await Promise.race([
        hydrationCall,
        new Promise((_, reject) => setTimeout(() => reject(new Error('automatic Kernel hydration timed out')), 1000)),
    ]);
    assert.ok(hydrated, 'empty Kernel history must activate its synchronized memory snapshot');
    assert.equal(hydrated.revision, Date.parse('2026-07-10T00:10:00.000Z'));
    assert.equal(hydrated.records.length, 1);
    kernelFallbackRecords = null;
    kernelFocusErrorOnce = {
        ok: false,
        data: null,
        error: { code: 'HISTORY_SOURCE_UNAVAILABLE', message: 'file API unavailable' },
    };
    const allReadsBeforeSourceRecovery = localAllReads;
    const sourceRecovered = await facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(sourceRecovered.meta.source, 'memory');
    assert.equal(sourceRecovered.totals.focusSec, 600);
    assert.equal(localAllReads, allReadsBeforeSourceRecovery + 1,
        'a failed Kernel file source must hydrate authoritative history once before retrying the read');
    const readsBeforeLimit = localRangeReads;
    kernelFocusError = {
        ok: false,
        data: null,
        error: { code: 'STATS_RESULT_TOO_LARGE', message: 'too large', details: { maxResultCells: 10000 } },
    };
    await assert.rejects(facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    }), (error) => error?.code === 'STATS_RESULT_TOO_LARGE'
        && error?.details?.maxResultCells === 10000);
    assert.equal(localRangeReads, readsBeforeLimit, 'deterministic Kernel errors must not reread frontend history');

    kernelFocusError = null;
    kernelFallbackRecords = null;
    storage.set('siyuan-tomato-history-fallback-meta', JSON.stringify({
        updatedAt: Date.parse('2026-07-10T00:20:00.000Z'),
        recordCount: records.length,
    }));
    storage.set('siyuan-tomato-history', JSON.stringify(records));
    const authoritativeFallback = await facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(authoritativeFallback.totals.focusSec, 600,
        'queries must wait for an authoritative fallback to hydrate before reading Kernel statistics');
    assert.equal(authoritativeFallback.meta.source, 'memory');

    rejectFallbackSet = true;
    kernelFallbackRecords = null;
    storage.set('siyuan-tomato-history-fallback-meta', JSON.stringify({
        updatedAt: Date.parse('2026-07-10T00:30:00.000Z'),
        recordCount: records.length,
    }));
    const allReadsBeforeFailure = localAllReads;
    const localFallbackFirst = await facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    });
    const localFallbackSecond = await facade.queryFocus({
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-11T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(localFallbackFirst.meta.source, 'fallback-local');
    assert.equal(localFallbackSecond.meta.source, 'fallback-local');
    assert.equal(localAllReads, allReadsBeforeFailure + 1,
        'a failed fallback hydration must use a bounded retry window instead of reloading all history per query');
    console.log('stats empty Kernel recovery contract tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
