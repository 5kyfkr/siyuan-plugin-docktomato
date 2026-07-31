'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
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
assert.match(source, /verifyHistoryMigration[\s\S]*clearLegacyHistorySources/, 'legacy sources may only be cleared after migration verification');
assert.match(source, /clearLegacyHistorySources[\s\S]*LEGACY_HISTORY_FILE_PATH[\s\S]*NEW_HISTORY_FILE_PATH/, 'both old history files must be emptied after migration');
assert.match(source, /hasLocalFallback[\s\S]*\? normalizeHistoryRecords\(localRecords\)[\s\S]*: mergeUniqueHistoryRecords/, 'a fallback snapshot must replace stale files instead of resurrecting deleted records');
assert.match(source, /readOptionalHistoryJsonFileStrict[\s\S]*response\.status === 404[\s\S]*throw new Error/, 'migration may only treat explicit missing files as empty');
assert.match(source, /hasLocalFallback && !localRaw\.trim\(\)[\s\S]*throw new Error/, 'an orphan fallback marker must never erase year shards');
assert.match(source, /catch \(e\) \{[\s\S]*HISTORY_LOCAL_FALLBACK_META_KEY[\s\S]*旧数据源未主动清理/, 'a partial migration failure must retain the merged snapshot as fallback data');

console.log('history year sharding tests passed');

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
let failShardWrites = false;
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
    HISTORY_STORAGE_DIR: historyDir,
    LEGACY_HISTORY_FILE_PATH: legacyPath,
    NEW_HISTORY_FILE_PATH: currentPath,
    __tomatoFileTextCache: new Map(),
    __tomatoHistoryParseCache: { source: '', raw: '', records: null, recordsAll: null },
    __tomatoHistoryLoadPromise: null,
    __tomatoHistoryMutationQueue: Promise.resolve(),
    __tomatoEnsureDir: async () => true,
    __tomatoGetFileText: async (filePath) => files.has(filePath)
        ? { exists: true, text: files.get(filePath) }
        : { exists: false, text: '' },
    __tomatoPutFileText: async (filePath, textValue) => {
        if (failShardWrites && filePath.startsWith(`${historyDir}/`)) return false;
        files.set(filePath, String(textValue));
        return true;
    },
    __tomatoRemoveFile: async (filePath) => files.delete(filePath),
    fetch: async (_url, options) => {
        const filePath = JSON.parse(options.body).path;
        const exists = files.has(filePath);
        return {
            ok: exists,
            status: exists ? 200 : 404,
            text: async () => exists ? files.get(filePath) : '',
        };
    },
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
vm.runInContext(`${source.slice(historyStart, historyEnd)}\nthis.store = { migrateLegacyHistoryToYearShards, loadHistoryRecords, mutateHistoryRecords };`, historyContext);

(async () => {
    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), true);
    assert.deepEqual(JSON.parse(files.get(legacyPath)), [], 'legacy root history must be emptied after verification');
    assert.deepEqual(JSON.parse(files.get(currentPath)), [], 'legacy plugin history must be emptied after verification');
    assert.equal((await historyContext.store.loadHistoryRecords({ force: true })).length, 3, 'all migrated years must remain readable');

    assert.equal(await historyContext.store.migrateLegacyHistoryToYearShards(), true, 'migration must be idempotent');
    await Promise.all([
        historyContext.store.mutateHistoryRecords(records => { records.push({ date: '2026-01-01', start: '2026-01-01T01:00:00.000Z', end: '2026-01-01T01:10:00.000Z', mode: 'stopwatch' }); return true; }),
        historyContext.store.mutateHistoryRecords(records => { records.push({ date: '2026-01-02', start: '2026-01-02T01:00:00.000Z', end: '2026-01-02T01:10:00.000Z', mode: 'stopwatch' }); return true; }),
    ]);
    const finalRecords = await historyContext.store.loadHistoryRecords({ force: true });
    assert.equal(finalRecords.length, 5, 'serialized mutations must retain both concurrent appends');
    assert.equal(JSON.parse(files.get(`${historyDir}/2023.json`)).length, 1, 'writing a new year must preserve older files');

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
    console.log('history year sharding behavior tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
