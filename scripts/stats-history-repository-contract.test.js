'use strict';

const assert = require('node:assert/strict');
const stats = require('../kernel.js');

let revision = 1;
let records = [{
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-01T00:10:00.000Z',
    durationSec: 600,
    mode: 'stopwatch',
}];
let shardReads = 0;
let indexReads = 0;
let includeShard = true;
let historyContractVersion = 2;

const shardText = () => JSON.stringify(records);
const indexValue = () => ({
    contractVersion: historyContractVersion,
    revision,
    shards: includeShard ? {
        2026: {
            hash: stats.hashText(shardText()),
            minStart: '2026-01-01T00:00:00.000Z',
            maxEnd: '2026-12-31T23:59:59.999Z',
        },
    } : {},
});
const repository = stats.createHistoryRepository({
    readText: async () => {
        shardReads += 1;
        return shardText();
    },
    readJson: async () => {
        indexReads += 1;
        return indexValue();
    },
    listShardNames: async () => ['2026.json'],
    indexPath: '/history/history-index.json',
    shardPath: (name) => `/history/${name}`,
});
const range = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
    bucket: 'day',
};

(async () => {
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 1);
    historyContractVersion = 1;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 1, 'legacy v1 indexes must reuse the same immutable parsed shard');
    historyContractVersion = 2;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 1, 'repeated queries must reuse the bounded parsed-shard cache');

    const firstVersion = records;
    records = [{ ...records[0], durationSec: 1200 }];
    revision += 1;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 2);

    records = firstVersion;
    revision += 1;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 2, 'the previous immutable generation may remain in the two-entry LRU');

    includeShard = false;
    revision += 1;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    includeShard = true;
    revision += 1;
    await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, 2);

    const readsBeforeScan = shardReads;
    const scanned = await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(shardReads, readsBeforeScan, 'cached immutable shards must avoid disk and JSON parse amplification');
    assert.equal(scanned.data.contractVersion, 2);
    assert.equal(scanned.data.totals.focusSec, 600);
    assert.equal(scanned.meta.recordCount, 1);

    const cachedRange = { ...range, __statsCacheKey: 'focus-range' };
    await repository.scan(cachedRange, () => stats.createFocusAggregator(cachedRange));
    const cachedResult = await repository.scan(cachedRange, () => stats.createFocusAggregator(cachedRange));
    assert.equal(cachedResult.meta.cacheHit, true, 'the same revision and normalized query must reuse its final aggregate');
    assert.equal(shardReads, readsBeforeScan, 'final aggregate reuse must avoid another shard scan');

    const largeRecordText = JSON.stringify([{
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T00:10:00.000Z',
        durationSec: 600,
        mode: 'stopwatch',
        note: 'x'.repeat(4 * 1024 * 1024),
    }]);
    let largeShardReads = 0;
    const largeShardRepository = stats.createHistoryRepository({
        readText: async () => {
            largeShardReads += 1;
            return largeRecordText;
        },
        readJson: async () => ({
            contractVersion: 2,
            revision: 1,
            shards: {
                2026: {
                    hash: stats.hashText(largeRecordText),
                    count: 1,
                    minStart: range.from,
                    maxEnd: range.to,
                },
            },
        }),
        listShardNames: async () => [],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    await largeShardRepository.scan(range, () => stats.createFocusAggregator(range));
    await largeShardRepository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(largeShardReads, 2,
        'a parsed shard above the byte budget must remain queryable without becoming resident cache');
    largeShardRepository.clear();

    const readsBeforeRejectedRange = indexReads;
    const rejectedRange = {
        from: '2020-01-01T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
        bucket: 'hour',
    };
    await assert.rejects(repository.scan(rejectedRange, () => stats.createFocusAggregator(rejectedRange)),
        (error) => error?.code === 'STATS_RANGE_TOO_LARGE');
    assert.equal(indexReads, readsBeforeRejectedRange, 'oversized ranges must fail before file IO');

    repository.setFallback(true, [], revision + 1);
    const fallbackScan = await repository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(fallbackScan.meta.source, 'fallback-memory');
    assert.equal(fallbackScan.data.totals.sessionCount, 0);
    assert.throws(() => repository.setFallback(true, new Array(250001), revision + 2),
        (error) => error?.code === 'STATS_SCAN_LIMIT_EXCEEDED');
    repository.clear();

    const fallbackRecord = {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T00:05:00.000Z',
        durationSec: 300,
        mode: 'stopwatch',
    };
    repository.setFallback(true, [fallbackRecord], 100);
    assert.deepEqual(repository.setFallback(false, null, 99), { active: true, revision: 100 },
        'an older clear request must not replace a newer authoritative fallback');
    repository.setFallback(false, null, 101);

    let releaseRaceRead;
    let markRaceReadStarted;
    const raceReadStarted = new Promise((resolve) => { markRaceReadStarted = resolve; });
    const raceRepository = stats.createHistoryRepository({
        readText: async () => {
            markRaceReadStarted();
            await new Promise((resolve) => { releaseRaceRead = resolve; });
            return shardText();
        },
        readJson: async () => indexValue(),
        listShardNames: async () => ['2026.json'],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    const racedScan = raceRepository.scan(range, () => stats.createFocusAggregator(range));
    await raceReadStarted;
    raceRepository.setFallback(true, [fallbackRecord], 200);
    releaseRaceRead();
    const racedResult = await racedScan;
    assert.equal(racedResult.meta.source, 'fallback-memory',
        'a fallback activated during file IO must replace the stale indexed scan on retry');

    let activeReads = 0;
    let maxActiveReads = 0;
    const releaseReads = [];
    const serialRepository = stats.createHistoryRepository({
        readText: () => new Promise((resolve) => {
            activeReads += 1;
            maxActiveReads = Math.max(maxActiveReads, activeReads);
            releaseReads.push(() => {
                activeReads -= 1;
                resolve(shardText());
            });
        }),
        readJson: async () => indexValue(),
        listShardNames: async () => ['2026.json'],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    const waitForReads = async (count) => {
        for (let attempt = 0; attempt < 20 && releaseReads.length < count; attempt += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(releaseReads.length, count);
    };
    const serialFirst = serialRepository.scan(range, () => stats.createFocusAggregator(range));
    const serialSecond = serialRepository.scan(range, () => stats.createFocusAggregator(range));
    await waitForReads(1);
    assert.equal(maxActiveReads, 1);
    releaseReads[0]();
    await Promise.all([serialFirst, serialSecond]);
    assert.equal(maxActiveReads, 1, 'history scans must serialize file parsing to bound peak heap usage');
    assert.equal(releaseReads.length, 1, 'the queued scan must reuse the parsed immutable shard');

    let raceRevision = 1;
    let raceIndexReads = 0;
    let raceShardReads = 0;
    const deletedShardRepository = stats.createHistoryRepository({
        readText: async (path) => {
            raceShardReads += 1;
            if (path.endsWith('/2026-1-aaaaaaaa.json')) {
                raceRevision = 2;
                const error = new Error('old shard deleted');
                error.code = 'HISTORY_SOURCE_UNAVAILABLE';
                throw error;
            }
            return shardText();
        },
        readJson: async () => {
            raceIndexReads += 1;
            const current = raceRevision;
            return {
                contractVersion: 2,
                revision: current,
                shards: {
                    2026: {
                        file: current === 1 ? '2026-1-aaaaaaaa.json' : '2026-2-bbbbbbbb.json',
                        hash: stats.hashText(shardText()),
                        count: records.length,
                        minStart: range.from,
                        maxEnd: range.to,
                    },
                },
            };
        },
        listShardNames: async () => [],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    const recoveredDeletedShard = await deletedShardRepository.scan(range, () => stats.createFocusAggregator(range));
    assert.equal(recoveredDeletedShard.meta.revision, 2);
    assert.equal(raceShardReads, 2, 'a deleted old-generation shard must retry against the new index once');
    assert.ok(raceIndexReads >= 3, 'the repository must confirm the revision change before retrying a source error');

    let deadlineReads = 0;
    let releaseDeadlineRead;
    const deadlineRepository = stats.createHistoryRepository({
        readText: () => new Promise((resolve) => {
            deadlineReads += 1;
            releaseDeadlineRead = () => resolve(shardText());
        }),
        readJson: async () => indexValue(),
        listShardNames: async () => [],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    const deadlineFirst = deadlineRepository.scan(range, () => stats.createFocusAggregator(range));
    while (!releaseDeadlineRead) await new Promise((resolve) => setImmediate(resolve));
    const deadlineSecond = deadlineRepository.scan({ ...range, deadlineAt: Date.now() + 5 }, () => stats.createFocusAggregator(range));
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseDeadlineRead();
    await deadlineFirst;
    await assert.rejects(deadlineSecond, (error) => error?.code === 'STATS_QUERY_EXPIRED');
    assert.equal(deadlineReads, 1, 'an expired queued query must leave the scan lane without starting file IO');

    let releaseAbortRead;
    const abortRepository = stats.createHistoryRepository({
        readText: () => new Promise((resolve) => { releaseAbortRead = () => resolve(shardText()); }),
        readJson: async () => indexValue(),
        listShardNames: async () => [],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    const abortFirst = abortRepository.scan(range, () => stats.createFocusAggregator(range));
    while (!releaseAbortRead) await new Promise((resolve) => setImmediate(resolve));
    const queuedAbortController = new AbortController();
    const abortSecond = abortRepository.scan({
        ...range,
        queryID: 'queued-detail-query',
        signal: queuedAbortController.signal,
    }, () => stats.createFocusAggregator(range));
    queuedAbortController.abort();
    await assert.rejects(abortSecond, (error) => error?.code === 'STATS_QUERY_ABORTED');
    releaseAbortRead();
    await abortFirst;
    assert.equal((await abortRepository.scan(range, () => stats.createFocusAggregator(range))).data.contractVersion, 2,
        'an aborted queued scan must release capacity without poisoning the scan lane');

    let oversizedShardReads = 0;
    const oversizedRepository = stats.createHistoryRepository({
        readText: async () => { oversizedShardReads += 1; return '[]'; },
        readJson: async () => ({
            contractVersion: 2,
            revision: 1,
            shards: {
                2026: {
                    count: 250001,
                    minStart: range.from,
                    maxEnd: range.to,
                },
            },
        }),
        listShardNames: async () => [],
        indexPath: '/history/history-index.json',
        shardPath: (name) => `/history/${name}`,
    });
    await assert.rejects(oversizedRepository.scan(range, () => stats.createFocusAggregator(range)),
        (error) => error?.code === 'STATS_SCAN_LIMIT_EXCEEDED');
    assert.equal(oversizedShardReads, 0, 'declared oversized ranges must fail before shard text enters memory');
    console.log('stats history repository contract tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
