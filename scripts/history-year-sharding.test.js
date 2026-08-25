'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
assert.match(source, /TransitionExecutor\.execute\([\s\S]*historyDrafts[\s\S]*accountingDrafts/,
    'timer completion must persist history through the ordered transition executor');
assert.match(source, /async function __tomatoHistoryUpdateTime[\s\S]*?\}, \{ recordKey \}\)/,
    'record edits must route through the inferred single-year mutation path');
assert.match(source, /async function deleteRecord\(record\)[\s\S]*?\}, \{ record \}\)/,
    'record deletion must route through the inferred single-year mutation path');
const kernelSource = fs.readFileSync(path.resolve(__dirname, '..', 'kernel.js'), 'utf8');
const helperStart = source.indexOf('    function getHistoryRecordStorageYear(');
const helperEnd = source.indexOf('    async function readHistoryJsonFileStrict(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'history year helpers must remain extractable');

const context = vm.createContext({
    Array,
    Date,
    JSON,
    Map,
    Number,
    Object,
    String,
    toDateSafe: (value) => new Date(value),
});
vm.runInContext(`${source.slice(helperStart, helperEnd)}\nthis.group = groupHistoryRecordsByYear;`, context);

const grouped = context.group([
    { date: '2024-12-31', end: '2025-01-01T02:00:00.000Z', mode: 'countdown' },
    { end: '2025-06-01T12:00:00.000Z', mode: 'stopwatch' },
    { start: 'invalid', end: 'invalid', mode: 'countdown' },
]);
assert.deepEqual(Array.from(grouped.keys()), ['2024', '2025', 'unknown']);
assert.equal(grouped.get('2024').length, 1, 'stored local date must decide the archive year');
assert.equal(grouped.get('2025').length, 1, 'end time must provide the fallback archive year');
assert.equal(grouped.get('unknown').length, 1, 'invalid legacy records must be retained');

assert.doesNotMatch(source, /oneYearAgo|最近1年/, 'history must never be filtered by age');
assert.match(source, /const HISTORY_STORAGE_DIR = `\$\{PLUGIN_STORAGE_DIR\}\/history`/, 'year files must live in the plugin data directory');
assert.match(source, /const HISTORY_INDEX_CONTRACT_VERSION = 2/,
    'the renderer history repository must declare the immutable-shard index contract');
assert.match(source, /const LEGACY_HISTORY_INDEX_CONTRACT_VERSION = 1/,
    'the renderer history repository must retain explicit compatibility with legacy indexes');
assert.match(source, /const HISTORY_IO_TIMEOUT_MS = 5000/,
    'renderer and Kernel history IO must share the same timeout budget');
assert.match(kernelSource, /const HISTORY_IO_TIMEOUT_MS = 5000/,
    'renderer and Kernel history IO must share the same timeout budget');
assert.match(source, /verifyHistoryMigration[\s\S]*clearLegacyHistorySources/, 'legacy sources may only be cleared after migration verification');
assert.match(source, /clearLegacyHistorySources[\s\S]*LEGACY_HISTORY_FILE_PATH[\s\S]*NEW_HISTORY_FILE_PATH/, 'both old history files must be emptied after migration');
assert.match(source, /hasLocalFallback[\s\S]*\? normalizeHistoryRecords\(localRecords\)[\s\S]*: mergeUniqueHistoryRecords/, 'a fallback snapshot must replace stale files instead of resurrecting deleted records');
assert.match(source, /readOptionalHistoryJsonFileStrict[\s\S]*requestHistoryFileText\(path, \{ optional: true \}\)[\s\S]*text == null[\s\S]*throw new Error/,
    'migration may only treat an explicitly missing file as empty');
assert.match(source, /hasLocalFallback && !localRaw\.trim\(\)[\s\S]*throw new Error/, 'an orphan fallback marker must never erase year shards');
assert.match(source, /catch \(e\) \{[\s\S]*HISTORY_LOCAL_FALLBACK_META_KEY[\s\S]*旧数据源未主动清理/, 'a partial migration failure must retain the merged snapshot as fallback data');
assert.doesNotMatch(source, /Promise\.all\(names\.map\([^\n]*readHistoryJsonFileStrict/,
    'history shards must not be parsed concurrently into one heap spike');
assert.match(source, /const HISTORY_SHARD_CACHE_LIMIT = 2/,
    'normal history reads must retain only a bounded shard cache');
assert.match(source, /const HISTORY_SHARD_CACHE_RECORD_LIMIT = 20000[\s\S]*const HISTORY_SHARD_CACHE_BYTE_LIMIT = 8 \* 1024 \* 1024/,
    'renderer and Kernel shard caches must share bounded record and byte budgets');
assert.match(source, /const HISTORY_SHARD_RETENTION_GRACE_MS = 60000[\s\S]*__tomatoHistoryShardRetainUntil/,
    'the writer must retain the previous immutable generation for a bounded grace period');
assert.match(source, /const HISTORY_RECORD_MEMORY_LIMIT = 250000/,
    'explicit full-history operations must also have a hard memory bound');
assert.match(source, /const HISTORY_TEXT_MEMORY_LIMIT = 32 \* 1024 \* 1024/,
    'history JSON parsing must have a byte-oriented memory bound as well as a record-count bound');
assert.match(kernelSource, /const HISTORY_CONTRACT_VERSION = 2/,
    'renderer and Kernel repositories must use the same persisted history contract');
assert.match(kernelSource, /const LEGACY_HISTORY_CONTRACT_VERSION = 1/,
    'Kernel history reads must remain compatible with legacy indexes');
assert.match(kernelSource, /const MAX_SCANNED_RECORDS = 250000/,
    'renderer and Kernel repositories must share the same record budget');
assert.match(kernelSource, /const MAX_SHARD_TEXT_LENGTH = 32 \* 1024 \* 1024/,
    'renderer and Kernel repositories must share the same shard text budget');
assert.match(kernelSource, /MAX_CACHED_HISTORY_SHARDS = 2[\s\S]*MAX_CACHED_HISTORY_SHARD_BYTES = 8 \* 1024 \* 1024[\s\S]*MAX_CACHED_QUERY_RESULTS = 16[\s\S]*MAX_CACHED_QUERY_RESULT_BYTES = 4 \* 1024 \* 1024/,
    'Kernel shard and final-query caches must have explicit heap budgets');
assert.match(kernelSource, /deadlineAt[\s\S]*STATS_QUERY_EXPIRED[\s\S]*assertQueryDeadline/,
    'the frontend deadline must stop queued, IO, and record-scan work in the Kernel');
assert.match(source, /requestHistoryFileText[\s\S]*withHistoryIoTimeout\(path[\s\S]*readHistoryResponseText\(response, path\)/,
    'renderer file timeout must cover response body consumption');
assert.match(source, /requestHistoryDirectoryPayload[\s\S]*withHistoryIoTimeout\(HISTORY_STORAGE_DIR[\s\S]*readHistoryResponseText\(response, HISTORY_STORAGE_DIR\)/,
    'renderer directory timeout must cover response body consumption');
assert.match(source, /putHistoryFileText[\s\S]*withHistoryIoTimeout\(path[\s\S]*__tomatoPutFileText[\s\S]*signal/,
    'history writes must use the same bounded IO lifecycle as reads');
assert.match(source, /__tomatoPutFileText\(path, text, contentType = 'application\/json', options = \{\}\)[\s\S]*signal: options\.signal/,
    'history write cancellation must reach the file API');
assert.match(kernelSource, /fileText[\s\S]*withHistoryIoTimeout\(path[\s\S]*responseTextLimited\(response, path\)/,
    'Kernel file timeout must cover response body consumption');
assert.match(kernelSource, /listShardNames[\s\S]*withHistoryIoTimeout\(HISTORY_DIR[\s\S]*responseTextLimited\(response, HISTORY_DIR\)/,
    'Kernel directory timeout must cover response body consumption');
assert.doesNotMatch(source, /__tomatoHistoryLoadRange[\s\S]{0,300}__tomatoHistoryLoadAll/,
    'range reads must not load every history shard first');
assert.doesNotMatch(source, /initialize\(\)[\s\S]{0,2500}records = await loadHistoryRecords\(\)/,
    'plugin startup must not materialize all history records just to count them');
assert.match(source, /legacyRecords\.length === 0[\s\S]*return true;[\s\S]*const shardRecords = hasLocalFallback \? \[\] : await readAllHistoryShardRecords/,
    'an already migrated startup must return before loading year shards');
assert.doesNotMatch(source, /expectedRecords\.map\([^\n]*JSON\.stringify[^\n]*\.sort\(\)/,
    'migration verification must not duplicate the complete history into sortable JSON arrays');

console.log('history year sharding tests passed');

const timeoutStart = source.indexOf('    function assertHistoryTextSize(');
const timeoutEnd = source.indexOf('    function normalizeHistoryRecords(', timeoutStart);
assert.ok(timeoutStart >= 0 && timeoutEnd > timeoutStart, 'renderer history IO helpers must remain extractable');
const timeoutContext = vm.createContext({
    AbortController,
    Date,
    JSON,
    Math,
    Number,
    Promise,
    String,
    TextDecoder,
    clearTimeout,
    setTimeout,
    HISTORY_IO_TIMEOUT_MS: 20,
    HISTORY_STORAGE_DIR: '/history',
    HISTORY_TEXT_MEMORY_LIMIT: 32 * 1024 * 1024,
    __tomatoHistoryWriteSignal: null,
    __tomatoEnsureDir: () => new Promise(() => {}),
    __tomatoPutFileText: () => new Promise(() => {}),
    __tomatoRemoveFile: () => new Promise(() => {}),
    fetch: async () => ({
        ok: true,
        status: 200,
        text: () => new Promise(() => {}),
    }),
});
const timeoutSource = source.slice(timeoutStart, timeoutEnd);
vm.runInContext(`${timeoutSource}\nthis.io = { requestHistoryFileText, requestHistoryDirectoryPayload, ensureHistoryStorageDir, putHistoryFileText, removeHistoryFile };`, timeoutContext);

const historyStart = source.indexOf('    function normalizeHistoryRecords(');
const historyEnd = source.indexOf('    function __tomatoFindHistoryRecordIndex(', historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart, 'history store must remain extractable');

const pluginDir = '/data/storage/petal/siyuan-plugin-docktomato';
const historyDir = `${pluginDir}/history`;
const legacyPath = '/data/storage/tomato-history.json';
const currentPath = `${pluginDir}/tomato-history.json`;
const files = new Map([
    [`${historyDir}/2023.json`, JSON.stringify([{ date: '2023-05-01', start: '2023-05-01T01:00:00.000Z', end: '2023-05-01T01:25:00.000Z', mode: 'countdown' }])],
    [legacyPath, JSON.stringify([{ date: '2024-05-01', start: '2024-05-01T01:00:00.000Z', end: '2024-05-01T01:25:00.000Z', mode: 'countdown' }])],
    [currentPath, JSON.stringify([{ date: '2025-05-01', start: '2025-05-01T01:00:00.000Z', end: '2025-05-01T01:25:00.000Z', mode: 'countdown' }])],
]);
const storage = new Map();
const writtenPaths = [];
const readPaths = [];
let failShardWrites = false;
let failIndexWrites = false;
let failCleanup = false;
const historyContext = vm.createContext({
    Array,
    CustomEvent: class CustomEvent {},
    Date,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    HISTORY_LOCAL_STORAGE_KEY: 'history',
    HISTORY_LOCAL_FALLBACK_META_KEY: 'history-meta',
    HISTORY_INDEX_CONTRACT_VERSION: 2,
    LEGACY_HISTORY_INDEX_CONTRACT_VERSION: 1,
    HISTORY_STORAGE_DIR: historyDir,
    LEGACY_HISTORY_FILE_PATH: legacyPath,
    NEW_HISTORY_FILE_PATH: currentPath,
    __tomatoFileTextCache: new Map(),
    HISTORY_SHARD_CACHE_LIMIT: 2,
    HISTORY_SHARD_CACHE_RECORD_LIMIT: 20000,
    HISTORY_SHARD_CACHE_BYTE_LIMIT: 8 * 1024 * 1024,
    HISTORY_SHARD_CLEANUP_LIMIT: 16,
    HISTORY_SHARD_RETENTION_GRACE_MS: 60000,
    HISTORY_RECORD_MEMORY_LIMIT: 250000,
    HISTORY_TEXT_MEMORY_LIMIT: 32 * 1024 * 1024,
    __tomatoHistoryShardCache: new Map(),
    __tomatoHistoryShardRetainUntil: new Map(),
    historyRecordLimitError: () => Object.assign(new Error('history limit'), { code: 'HISTORY_RECORD_LIMIT_EXCEEDED' }),
    assertHistoryRecordCount: (count) => {
        if (Math.max(0, Number(count) || 0) > 250000) {
            throw Object.assign(new Error('history limit'), { code: 'HISTORY_RECORD_LIMIT_EXCEEDED' });
        }
    },
    assertHistoryTextSize: (value) => {
        if (String(value || '').length > 32 * 1024 * 1024) {
            throw Object.assign(new Error('text limit'), { code: 'HISTORY_TEXT_LIMIT_EXCEEDED' });
        }
    },
    historySourceError: (message, details = {}) => Object.assign(new Error(message), {
        code: 'HISTORY_SOURCE_UNAVAILABLE',
        details,
    }),
    __tomatoHistoryLoadPromise: null,
    __tomatoHistoryMutationQueue: Promise.resolve(),
    __tomatoHistoryWriteSignal: null,
    assertHistoryWriteActive: () => {},
    isHistoryWriteCoordinationError: (error) => error?.code === 'HISTORY_REVISION_CHANGED'
        || String(error?.code || '').startsWith('HISTORY_WRITER_')
        || error?.code === 'HISTORY_WRITE_LEASE_LOST',
    __tomatoEnsureDir: async () => true,
    ensureHistoryStorageDir: async () => true,
    __tomatoGetFileText: async (filePath) => files.has(filePath)
        ? { exists: true, text: files.get(filePath) }
        : { exists: false, text: '' },
    __tomatoPutFileText: async (filePath, textValue) => {
        if (failShardWrites && filePath.startsWith(`${historyDir}/`)) return false;
        if (failIndexWrites && filePath === `${historyDir}/history-index.json`) return false;
        writtenPaths.push(filePath);
        files.set(filePath, String(textValue));
        return true;
    },
    putHistoryFileText: async (filePath, textValue) => {
        if (failShardWrites && filePath.startsWith(`${historyDir}/`)) return false;
        if (failIndexWrites && filePath === `${historyDir}/history-index.json`) return false;
        writtenPaths.push(filePath);
        files.set(filePath, String(textValue));
        return true;
    },
    __tomatoRemoveFile: async (filePath) => files.delete(filePath),
    removeHistoryFile: async (filePath) => {
        if (failCleanup) throw Object.assign(new Error('cleanup stalled'), { code: 'HISTORY_SOURCE_UNAVAILABLE' });
        return files.delete(filePath);
    },
    fetch: async (_url, options) => {
        const filePath = JSON.parse(options.body).path;
        readPaths.push(filePath);
        const exists = files.has(filePath);
        return {
            ok: exists,
            status: exists ? 200 : 404,
            text: async () => exists ? files.get(filePath) : '',
        };
    },
    requestHistoryFileText: async (filePath, options = {}) => {
        readPaths.push(filePath);
        if (files.has(filePath)) return files.get(filePath);
        if (options?.optional === true) return null;
        throw Object.assign(new Error(`missing history file: ${filePath}`), { code: 'HISTORY_SOURCE_UNAVAILABLE' });
    },
    requestHistoryDirectoryPayload: async () => ({
        code: 0,
        data: Array.from(files.keys())
            .filter(filePath => filePath.startsWith(`${historyDir}/`) && !filePath.slice(historyDir.length + 1).includes('/'))
            .map(filePath => ({ name: filePath.split('/').pop() })),
    }),
    readHistoryResponseText: async (response) => response.text(),
    formatDateKey: (value) => {
        const date = new Date(value);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    },
    getTimePeriod: () => '上午',
    localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    Logger: { error: () => {}, warn: () => {} },
    normalizeLegacyDate: (value) => String(value).slice(0, 10),
    postJSON: async (_url, { path: directory }) => ({
        ok: true,
        data: {
            code: 0,
            data: Array.from(files.keys())
                .filter(filePath => filePath.startsWith(`${directory}/`) && !filePath.slice(directory.length + 1).includes('/'))
                .map(filePath => ({ name: filePath.split('/').pop() })),
        },
    }),
    safeJsonParse: (value) => { try { return JSON.parse(value); } catch { return null; } },
    toDateSafe: (value) => new Date(value),
    window: { dispatchEvent: () => {} },
});
vm.runInContext(`${source.slice(historyStart, historyEnd)}\nthis.store = { migrateLegacyHistoryToYearShards, loadHistoryRecords, loadHistoryRangeRecords, getHistoryStoreSummary, mutateHistoryRecords, retainHistoryShard, prepareHistoryShardRead, historyShardCacheRecordCount, historyShardCacheByteCount, invalidateHistoryStoreCache, cleanupHistoryShardFiles };`, historyContext);

(async () => {
    const stalledAt = Date.now();
    await assert.rejects(timeoutContext.io.requestHistoryFileText('/history/stalled.json'),
        (error) => error?.code === 'HISTORY_SOURCE_UNAVAILABLE');
    assert.ok(Date.now() - stalledAt < 1000,
        'renderer history IO timeout must cover a response body that never resolves');
    const stalledDirectoryAt = Date.now();
    await assert.rejects(timeoutContext.io.requestHistoryDirectoryPayload(),
        (error) => error?.code === 'HISTORY_SOURCE_UNAVAILABLE');
    assert.ok(Date.now() - stalledDirectoryAt < 1000,
        'renderer history IO timeout must cover a directory body that never resolves');
    const stalledWriteAt = Date.now();
    await assert.rejects(timeoutContext.io.putHistoryFileText('/history/stalled-write.json', '[]'),
        (error) => error?.code === 'HISTORY_SOURCE_UNAVAILABLE');
    assert.ok(Date.now() - stalledWriteAt < 1000,
        'renderer history IO timeout must release a stalled write');

    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), true);
    const historyIndex = JSON.parse(files.get(`${historyDir}/history-index.json`));
    assert.equal(historyIndex.contractVersion, 2);
    assert.equal(historyIndex.shards['2023'].count, 1);
    assert.ok(historyIndex.shards['2025'].hash, 'history index must carry a shard hash');
    assert.match(historyIndex.shards['2025'].file, /^2025-\d+-[0-9a-f]{8}\.json$/,
        'history writes must use immutable generation files before committing the index');
    const retainedPreviousShard = '2024-1-deadbeef.json';
    files.set(`${historyDir}/${retainedPreviousShard}`, '[]');
    await historyContext.store.cleanupHistoryShardFiles(
        { shards: {} },
        { shards: { 2024: { file: retainedPreviousShard } } },
    );
    assert.equal(files.has(`${historyDir}/${retainedPreviousShard}`), true,
        'the immediately previous immutable generation must survive the cleanup grace period');
    readPaths.length = 0;
    const may2025 = await historyContext.store.loadHistoryRangeRecords(
        Date.parse('2025-05-01T00:00:00.000Z'),
        Date.parse('2025-05-02T00:00:00.000Z'),
        { force: true },
    );
    assert.equal(may2025.length, 1, 'range loading must preserve records from the matching shard');
    assert.deepEqual(readPaths, [
        `${historyDir}/history-index.json`,
        `${historyDir}/${historyIndex.shards['2025'].file}`,
    ], 'range loading must read only the index and overlapping year shard');
    const legacyShards = {};
    Object.entries(historyIndex.shards).forEach(([year, meta]) => {
        files.set(`${historyDir}/${year}.json`, files.get(`${historyDir}/${meta.file}`));
        const { file, ...legacyMeta } = meta;
        legacyShards[year] = legacyMeta;
    });
    files.set(`${historyDir}/history-index.json`, JSON.stringify({
        ...historyIndex,
        contractVersion: 1,
        shards: legacyShards,
    }));
    historyContext.store.invalidateHistoryStoreCache();
    assert.equal((await historyContext.store.loadHistoryRangeRecords(
        Date.parse('2025-05-01T00:00:00.000Z'),
        Date.parse('2025-05-02T00:00:00.000Z'),
        { force: true },
    )).length, 1, 'legacy v1 indexes must remain readable');
    assert.equal(await historyContext.store.mutateHistoryRecords(() => true, { year: '2025' }), true);
    const upgradedIndex = JSON.parse(files.get(`${historyDir}/history-index.json`));
    assert.equal(upgradedIndex.contractVersion, 2,
        'the next successful mutation must upgrade a legacy index to v2');
    Object.entries(upgradedIndex.shards).forEach(([year, meta]) => {
        assert.match(meta.file, new RegExp(`^${year}-\\d+-[0-9a-f]{8}\\.json$`),
            'a v1 upgrade must make every committed shard immutable');
    });
    assert.equal(historyContext.__tomatoHistoryShardCache.size <= 2, true, 'shard cache must remain bounded');
    const summary = await historyContext.store.getHistoryStoreSummary();
    assert.equal(summary.recordCount, 3, 'history summary must use index metadata without loading all records');
    assert.deepEqual(JSON.parse(files.get(legacyPath)), [], 'legacy root history must be emptied after verification');
    assert.deepEqual(JSON.parse(files.get(currentPath)), [], 'legacy plugin history must be emptied after verification');
    files.set(`${historyDir}/2022.json`, JSON.stringify([{ date: '2022-01-01', start: '2022-01-01T01:00:00.000Z', end: '2022-01-01T01:10:00.000Z', mode: 'stopwatch' }]));
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 3, 'all migrated years must remain readable');

    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), true, 'migration must be idempotent');
    await Promise.all([
        historyContext.store.mutateHistoryRecords(records => { records.push({ date: '2026-01-01', start: '2026-01-01T01:00:00.000Z', end: '2026-01-01T01:10:00.000Z', mode: 'stopwatch' }); return true; }),
        historyContext.store.mutateHistoryRecords(records => { records.push({ date: '2026-01-02', start: '2026-01-02T01:00:00.000Z', end: '2026-01-02T01:10:00.000Z', mode: 'stopwatch' }); return true; }),
    ]);
    const finalRecords = await historyContext.store.loadHistoryRecords({ force: true });
    assert.equal(finalRecords.length, 5, 'serialized mutations must retain both concurrent appends');
    const concurrentIndex = JSON.parse(files.get(`${historyDir}/history-index.json`));
    assert.equal(JSON.parse(files.get(`${historyDir}/${concurrentIndex.shards['2023'].file}`)).length, 1,
        'writing a new year must preserve older files');

    files.set(legacyPath, JSON.stringify([{ date: '2027-05-01', start: '2027-05-01T01:00:00.000Z', end: '2027-05-01T01:25:00.000Z', mode: 'countdown' }]));
    failShardWrites = true;
    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), false, 'failed shard writes must fail migration safely');
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 6, 'failed migration must expose the complete fallback snapshot');
    assert.equal(JSON.parse(files.get(legacyPath)).length, 1, 'failed migration must leave the old source untouched');

    failShardWrites = false;
    await historyContext.store.mutateHistoryRecords(records => {
        const index = records.findIndex(record => record.date === '2027-05-01');
        records.splice(index, 1);
        return true;
    });
    assert.deepEqual(JSON.parse(files.get(legacyPath)), [], 'fallback recovery must clear the stale old source after verification');
    assert.equal(storage.has('history-meta'), false, 'fallback marker must only clear after verified recovery');
    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), true, 'recovered history must remain migration-safe on restart');
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 5, 'deleted fallback records must not resurrect from old files');

    writtenPaths.length = 0;
    failCleanup = true;
    const inferredYearRecord = { date: '2028-01-01', start: '2028-01-01T01:00:00.000Z', end: '2028-01-01T01:10:00.000Z', mode: 'stopwatch' };
    readPaths.length = 0;
    assert.equal(await historyContext.store.mutateHistoryRecords(records => {
        records.push(inferredYearRecord);
        return true;
    }, { record: inferredYearRecord }), true);
    failCleanup = false;
    assert.equal(storage.has('history-meta'), false,
        'best-effort cleanup failures must not invalidate an already committed index');
    assert.equal(writtenPaths.length, 2, 'a normal append must write only its target year and the index');
    assert.ok(writtenPaths.includes(`${historyDir}/history-index.json`));
    assert.match(writtenPaths.find((item) => item !== `${historyDir}/history-index.json`) || '',
        new RegExp(`^${historyDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/2028-\\d+-[0-9a-f]{8}\\.json$`));
    assert.equal(readPaths.some((item) => /\/(?:2023|2024|2025|2026)-[^/]+\.json$/.test(item)), false,
        'an inferred single-year append must not read unrelated history shards');
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 6);

    const movedRecord = (await historyContext.store.loadHistoryRecords({ force: true }))
        .find(record => String(record?.date || '').startsWith('2025-'));
    assert.ok(movedRecord, 'cross-year edit fixture must exist');
    assert.equal(await historyContext.store.mutateHistoryRecords(yearRecords => {
        const index = yearRecords.findIndex(record => String(record?.recordId || '') === String(movedRecord.recordId || ''));
        if (index < 0) return false;
        const target = yearRecords[index];
        target.start = '2026-02-01T01:00:00.000Z';
        target.end = '2026-02-01T01:25:00.000Z';
        target.date = '2026-02-01';
        target.timestamp = Date.parse(target.end);
        target.durationMs = 25 * 60 * 1000;
        target.durationSec = 1500;
        target.durationMin = 25;
        return true;
    }, { record: movedRecord }), true, 'editing a record into another year must commit');
    const movedRecords = await historyContext.store.loadHistoryRecords({ force: true });
    assert.equal(movedRecords.some(record => String(record?.recordId || '') === String(movedRecord.recordId || '')
        && String(record?.date || '').startsWith('2026-')), true,
        'cross-year edit must move the record into the target year shard');

    const committedIndexText = files.get(`${historyDir}/history-index.json`);
    const committedIndex = JSON.parse(committedIndexText);
    failIndexWrites = true;
    assert.equal(await historyContext.store.mutateHistoryRecords(records => {
        records.push({ date: '2029-01-01', start: '2029-01-01T01:00:00.000Z', end: '2029-01-01T01:10:00.000Z', mode: 'stopwatch' });
        return true;
    }, { year: '2029' }), true, 'an index commit failure must preserve the mutation in authoritative fallback storage');
    assert.equal(files.get(`${historyDir}/history-index.json`), committedIndexText,
        'a failed index commit must leave the previous index unchanged');
    Object.values(committedIndex.shards).forEach((meta) => {
        assert.equal(files.has(`${historyDir}/${meta.file}`), true,
            'a failed index commit must not overwrite or delete any previously committed shard');
    });
    assert.equal(storage.has('history-meta'), true);
    failIndexWrites = false;
    assert.equal(await historyContext.store.mutateHistoryRecords(() => true), true,
        'the next serialized mutation must recover the fallback through a new index commit');
    assert.equal(storage.has('history-meta'), false);
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 7);

    historyContext.store.invalidateHistoryStoreCache();
    historyContext.store.retainHistoryShard('small-a.json', 'a', new Array(1000), 1024 * 1024);
    historyContext.store.prepareHistoryShardRead({ count: 20001, textLength: 1 });
    assert.equal(historyContext.store.historyShardCacheRecordCount(), 0,
        'the shard LRU must evict before parsing a new shard that would exceed the transient budget');
    historyContext.store.retainHistoryShard('small-a.json', 'a', new Array(1000), 1024 * 1024);
    historyContext.store.retainHistoryShard('small-b.json', 'b', new Array(1000), 3 * 1024 * 1024);
    assert.equal(historyContext.store.historyShardCacheRecordCount(), 1000,
        'the shard LRU must evict by weighted bytes before reaching its record-count limit');
    assert.ok(historyContext.store.historyShardCacheByteCount() <= 8 * 1024 * 1024);
    historyContext.store.retainHistoryShard('oversized.json', 'x', new Array(100), 5 * 1024 * 1024);
    assert.equal(historyContext.store.historyShardCacheRecordCount(), 1000,
        'a single oversized parsed shard must be returned without becoming resident');

    storage.set('history-meta', JSON.stringify({ updatedAt: Date.now(), recordCount: 250001 }));
    storage.set('history', '[]');
    await assert.rejects(historyContext.store.loadHistoryRangeRecords(
        Date.parse('2028-01-01T00:00:00.000Z'),
        Date.parse('2028-01-02T00:00:00.000Z'),
    ), (error) => error?.code === 'HISTORY_RECORD_LIMIT_EXCEEDED',
    'an oversized authoritative fallback must fail closed instead of reading stale shards');
    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), false,
        'migration must reject oversized fallback metadata before parsing the payload');
    storage.delete('history-meta');
    storage.delete('history');
    console.log('history year sharding behavior tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
