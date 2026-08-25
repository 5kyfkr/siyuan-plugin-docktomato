const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const handlers = new Map();
let failHistoryIndex = false;
let stallHistoryBody = false;
let missingHistoryIndex = false;
let stallHistoryDirectoryBody = false;
let historyIndexContractVersion = 2;
let historyIndexReadCount = 0;
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'));
const releaseVersion = String(manifest.version || '').trim();
assert.match(releaseVersion, /^\d+\.\d+\.\d+$/, 'plugin.json version must be a semantic release version');
assert.equal(manifest.kernels?.includes('all'), true, 'plugin.json must enable the Kernel entry point');
assert.equal(manifest.minAppVersion, '3.8.1', 'the plugin must require the SiYuan Kernel-plugin baseline');
assert.equal(manifest.disabledInPublish, true, 'the plugin must stay disabled in SiYuan publish-service pages');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert.doesNotMatch(rendererSource, /require\(["']\.\/kernel\.js["']\)/, 'plugin: renderer code cannot resolve relative CommonJS modules');
assert.match(rendererSource, /TOMATO_STATS_SCRIPT_PATH[\s\S]*loadTomatoStatsCore[\s\S]*document\.createElement\("script"\)/,
    'the renderer must load the shared core through the installed plugin file API');
const siyuan = {
    plugin: { lifecycle: {} },
    rpc: {
        async bind(name, handler) { handlers.set(name, handler); },
        async unbind(name) { handlers.delete(name); },
    },
    client: {
        async fetch(path, options) {
            const body = JSON.parse(options?.body || '{}');
            if (path === '/api/file/getFile' && body.path?.endsWith('/history/history-index.json')) {
                historyIndexReadCount += 1;
                if (failHistoryIndex) {
                    return { ok: false, status: 503, async text() { return ''; } };
                }
                if (missingHistoryIndex) {
                    return { ok: false, status: 404, async text() { return ''; } };
                }
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        if (stallHistoryBody) return new Promise(() => {});
                        return JSON.stringify({ contractVersion: historyIndexContractVersion, revision: 200, updatedAt: new Date(200).toISOString(), shards: {} });
                    },
                };
            }
            if (path === '/api/file/readDir' && body.path?.endsWith('/history')) {
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        if (stallHistoryDirectoryBody) return new Promise(() => {});
                        return JSON.stringify({ code: 0, data: [] });
                    },
                };
            }
            throw new Error(`unexpected fetch: ${path}`);
        },
    },
};
const moduleValue = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '..', 'kernel.js'), 'utf8');
const testSource = source
    .replace('const HISTORY_IO_TIMEOUT_MS = 5000;', 'const HISTORY_IO_TIMEOUT_MS = 20;')
    .replace('const HISTORY_WRITE_LEASE_MIN_MS = 5000;', 'const HISTORY_WRITE_LEASE_MIN_MS = 20;')
    .replace('const HISTORY_WRITE_LEASE_MAX_MS = 60000;', 'const HISTORY_WRITE_LEASE_MAX_MS = 100;');
assert.notEqual(testSource, source, 'the runtime timeout must remain configurable in this contract test');
assert.match(source, /const MAX_SHARD_TEXT_LENGTH = 32 \* 1024 \* 1024/,
    'Kernel history parsing must enforce a per-shard text budget');
const kernelContext = {
    siyuan,
    module: moduleValue,
    exports: moduleValue.exports,
    console,
    Date,
    JSON,
    Map,
    Set,
    Promise,
    AbortController,
    clearTimeout,
    setTimeout,
};
vm.runInNewContext(testSource, kernelContext);

assert.equal(typeof moduleValue.exports.queryFocus, 'function', 'the renderer-compatible CommonJS core must remain exported');
assert.equal(typeof siyuan.plugin.lifecycle.onload, 'function', 'Kernel runtime binding must not depend on CommonJS globals being absent');
assert.equal(typeof siyuan.plugin.lifecycle.onrunning, 'function', 'Kernel plugins must bind the onrunning lifecycle hook');

const rendererContext = { document: {}, Date, JSON, Map, Set, Promise, clearTimeout, setTimeout };
vm.runInNewContext(testSource, rendererContext);
assert.equal(typeof rendererContext.__dockTomatoStatsCore?.queryFocus, 'function', 'script injection must expose the pure core to the renderer');

(async () => {
    await siyuan.plugin.lifecycle.onload();
    assert.equal(handlers.has('dockTomatoQueryFocus'), true);
    assert.equal(handlers.has('dockTomatoQueryRoutine'), true);
    assert.equal(handlers.has('dockTomatoListSessions'), true);
    assert.equal(handlers.has('dockTomatoCancelStatsQuery'), true);
    assert.equal(handlers.has('dockTomatoHistoryWriteLease'), true);
    const earlyCancellation = await handlers.get('dockTomatoCancelStatsQuery')({ queryID: 'cancel-before-query' });
    assert.equal(earlyCancellation.data.cancelled, false,
        'a cancellation arriving before its query must be retained as a bounded tombstone');
    const cancelledBeforeStart = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
        queryID: 'cancel-before-query',
    });
    assert.equal(cancelledBeforeStart.ok, false);
    assert.equal(cancelledBeforeStart.error.code, 'STATS_QUERY_ABORTED',
        'a query arriving after its cancellation must not enter the history scan lane');
    const writeLease = handlers.get('dockTomatoHistoryWriteLease');
    const firstLease = await writeLease({ action: 'acquire', leaseMs: 40 });
    assert.equal(firstLease.data.acquired, true);
    const blockedLease = await writeLease({ action: 'acquire', leaseMs: 40 });
    assert.equal(blockedLease.data.acquired, false, 'a second window must not acquire the active history writer lease');
    const renewedLease = await writeLease({ action: 'renew', token: firstLease.data.token, leaseMs: 40 });
    assert.equal(renewedLease.data.acquired, true);
    const wrongRelease = await writeLease({ action: 'release', token: 'wrong-token' });
    assert.equal(wrongRelease.data.released, undefined, 'only the lease owner may release history writing');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const recoveredLease = await writeLease({ action: 'acquire', leaseMs: 40 });
    assert.equal(recoveredLease.data.acquired, true, 'an expired writer lease must recover after a crashed window');
    await writeLease({ action: 'release', token: recoveredLease.data.token });
    const tracedFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(tracedFocus.ok, true, JSON.stringify(tracedFocus.error || null));
    assert.equal(tracedFocus.data.contractVersion, 2);
    assert.equal(tracedFocus.data.meta.recordCount, 0);
    const indexReadsAfterFirstFocus = historyIndexReadCount;
    const cachedFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(cachedFocus.ok, true);
    assert.equal(cachedFocus.data.meta.cacheHit, true, 'same-revision normalized queries must reuse the final aggregate');
    assert.equal(historyIndexReadCount, indexReadsAfterFirstFocus + 1,
        'a cached aggregate may validate the index once but must skip its second consistency read');
    const expiredFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
        deadlineAt: Date.now() - 1,
    });
    assert.equal(expiredFocus.ok, false);
    assert.equal(expiredFocus.error.code, 'STATS_QUERY_EXPIRED');
    historyIndexContractVersion = 1;
    const legacyIndexFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(legacyIndexFocus.ok, true, 'Kernel runtime must remain compatible with legacy v1 indexes');
    historyIndexContractVersion = 2;
    failHistoryIndex = true;
    const unavailableFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(unavailableFocus.ok, false);
    assert.equal(unavailableFocus.error.code, 'HISTORY_SOURCE_UNAVAILABLE',
        'a file API failure must not masquerade as an empty legacy history');
    const memoryFallback = await handlers.get('dockTomatoSetHistoryFallback')({
        active: true,
        revision: 300,
        records: [{
            start: '2026-01-01T00:00:00.000Z',
            end: '2026-01-01T00:10:00.000Z',
            durationSec: 600,
            mode: 'stopwatch',
            sessionId: 'memory-fallback',
            taskBlockId: 'task-a',
        }],
    });
    assert.equal(memoryFallback.ok, true);
    assert.equal(memoryFallback.data.active, true,
        'an unavailable file source must not block an authoritative in-memory fallback');
    const memoryFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(memoryFocus.ok, true);
    assert.equal(memoryFocus.data.meta.source, 'fallback-memory');
    const totalsOnlyFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'day',
        includeAssociations: false,
    });
    assert.deepEqual(Array.from(totalsOnlyFocus.data.associations), []);
    const detailedFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'day',
        includeAssociations: true,
    });
    assert.equal(detailedFocus.data.associations.length, 1,
        'includeAssociations must participate in the normalized cache key');
    assert.notEqual(detailedFocus.data.meta.cacheHit, true,
        'a detailed query must not reuse a totals-only cache entry');
    const associationOnlyFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
        candidateIDs: ['missing-task'],
    });
    assert.equal(associationOnlyFocus.data.totals.focusSec, 600,
        'legacy candidate filtering must leave global totals unchanged');
    const constrainedFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
        candidateIDs: ['missing-task'],
        candidateIDsConstrainTotals: true,
    });
    assert.equal(constrainedFocus.data.totals.focusSec, 0,
        'the normalized cache key must distinguish scoped totals from association-only filtering');
    await handlers.get('dockTomatoSetHistoryFallback')({ active: false, revision: 301 });
    failHistoryIndex = false;
    stallHistoryBody = true;
    const stalledAt = Date.now();
    const stalledBodyFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(stalledBodyFocus.ok, false);
    assert.equal(stalledBodyFocus.error.code, 'HISTORY_SOURCE_UNAVAILABLE');
    assert.ok(Date.now() - stalledAt < 1000, 'response body timeout must release the query promptly');
    stallHistoryBody = false;
    const recoveredFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(recoveredFocus.ok, true,
        'a timed-out response body must release the serialized history scan lane');
    missingHistoryIndex = true;
    stallHistoryDirectoryBody = true;
    const stalledDirectoryFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(stalledDirectoryFocus.ok, false);
    assert.equal(stalledDirectoryFocus.error.code, 'HISTORY_SOURCE_UNAVAILABLE');
    stallHistoryDirectoryBody = false;
    missingHistoryIndex = false;
    const recoveredDirectoryFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(recoveredDirectoryFocus.ok, true,
        'a timed-out directory body must release the serialized history scan lane');
    stallHistoryBody = true;
    const readsBeforeCancellation = historyIndexReadCount;
    const cancelledFocusPromise = handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
        queryID: 'detail-query-to-cancel',
    });
    while (historyIndexReadCount <= readsBeforeCancellation) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    const cancellation = await handlers.get('dockTomatoCancelStatsQuery')({ queryID: 'detail-query-to-cancel' });
    assert.equal(cancellation.data.cancelled, true);
    const cancelledFocus = await cancelledFocusPromise;
    assert.equal(cancelledFocus.ok, false);
    assert.equal(cancelledFocus.error.code, 'STATS_QUERY_ABORTED',
        'cancelling an active query must abort its history file read');
    stallHistoryBody = false;
    const afterCancellationFocus = await handlers.get('dockTomatoQueryFocus')({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        bucket: 'none',
    });
    assert.equal(afterCancellationFocus.ok, true,
        'an aborted history read must release the scan lane for the next query');
    const staleFallback = await handlers.get('dockTomatoSetHistoryFallback')({ active: true, revision: 100, records: [] });
    assert.equal(staleFallback.data.active, false, 'an older local fallback must not replace a newer persisted history index');
    const freshFallback = await handlers.get('dockTomatoSetHistoryFallback')({ active: true, revision: 302, records: [] });
    assert.equal(freshFallback.data.active, true, 'a newer empty fallback must preserve an intentional history clear after a file-write failure');
    await siyuan.plugin.lifecycle.onunload();
    assert.equal(handlers.size, 0);
    console.log('stats kernel runtime contract tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
