'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pluginDir = path.resolve(__dirname, '..');
const tomatoSource = fs.readFileSync(path.join(pluginDir, 'tomato.js'), 'utf8');

const normalizeStart = tomatoSource.indexOf('    function normalizeHistoryRecords(');
const normalizeEnd = tomatoSource.indexOf('    function getHistoryRecordDurationMs(', normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'history normalization helpers must remain extractable');
const helperContext = vm.createContext({
    Array, Date, JSON, Math, Number, Object, Promise, Set, String,
    formatDateKey: (value) => {
        const date = new Date(value);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    },
    getTimePeriod: () => '上午',
    normalizeLegacyDate: (value) => String(value).slice(0, 10),
    toDateSafe: (value) => new Date(value),
    hashHistoryText: (value) => `hash:${String(value).length}`,
    assertHistoryRecordCount: () => {},
});
vm.runInContext(`${tomatoSource.slice(normalizeStart, normalizeEnd)}
this.helpers = { normalizeHistoryRecords, updateHistoryRecordTimeFields };`, helperContext);

const legacy = {
    start: '2026-08-25T06:00:00.000Z',
    end: '2026-08-25T06:25:00.000Z',
    durationSec: 1500,
    durationMin: 25,
    mode: 'countdown',
};
helperContext.helpers.normalizeHistoryRecords([legacy]);
assert.equal(typeof legacy.recordId, 'string', 'legacy records must receive a stable recordId');
assert.equal(legacy.disposition, 'normal');
assert.equal(legacy.visibility, 'visible');
assert.equal(legacy.recordKind, 'history');
assert.equal(legacy.durationMs, 1500000);

assert.equal(helperContext.helpers.updateHistoryRecordTimeFields(
    legacy,
    '2026-08-25T07:00:00.000Z',
    '2026-08-25T07:10:00.000Z',
), true);
assert.equal(legacy.durationMs, 600000, 'editing time must update durationMs');
assert.equal(legacy.durationSec, 600);
assert.equal(legacy.durationMin, 10);
assert.equal(legacy.date, '2026-08-25');

const indexStart = tomatoSource.indexOf('    function __tomatoFindHistoryRecordIndex(');
const indexEnd = tomatoSource.indexOf('    function __tomatoNormalizeHistoryRecordFields(', indexStart);
assert.ok(indexStart >= 0 && indexEnd > indexStart, 'history record lookup helper must remain extractable');
const indexContext = vm.createContext({ Array, String });
vm.runInContext(`${tomatoSource.slice(indexStart, indexEnd)}
this.find = __tomatoFindHistoryRecordIndex;`, indexContext);
const records = [{ recordId: 'r-1', start: 'old', end: 'old-end', mode: 'countdown', timestamp: 1 }];
assert.equal(indexContext.find(records, { recordId: 'r-1' }), 0, 'recordId lookup must work without stale time fields');
assert.equal(indexContext.find(records, { start: 'old', end: 'old-end', mode: 'countdown', timestamp: 1 }), 0,
    'legacy time-field lookup must remain supported');

const editorStart = tomatoSource.indexOf('    function showHistoryEditorPage(container, dateKey) {');
const editorEnd = tomatoSource.indexOf('\n    function showDayPage(', editorStart);
assert.ok(editorStart >= 0 && editorEnd > editorStart, 'history editor must remain extractable');
const editorBlock = tomatoSource.slice(editorStart, editorEnd);
assert.match(editorBlock, /historyState\.editorDate = selectedDate;\s*const records = getAllRecords\(\);/,
    'history editor must keep a mutable records view for manual append refreshes');
assert.match(editorBlock, /void createEditorRecordAtMinute\(minute\)\.catch/,
    'blank-space append failures must not be silently swallowed');

const writerSource = fs.readFileSync(path.join(pluginDir, 'index.js'), 'utf8');
const writerStart = writerSource.indexOf('const installTomatoHistoryWriter = (plugin) => {');
const writerEnd = writerSource.indexOf('\n\nconst loadTomatoStatsCore', writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, 'history writer bridge must remain extractable');
const writerContext = vm.createContext({
    AbortController, Date, Error, Math, Number, Promise, String, TypeError,
    clearInterval, clearTimeout, setInterval, setTimeout,
    HISTORY_WRITE_LEASE_MS: 1000,
    HISTORY_WRITE_RPC_TIMEOUT_MS: 100,
    HISTORY_WRITE_WAIT_MS: 1000,
});
vm.runInContext(`${writerSource.slice(writerStart, writerEnd)}
this.install = installTomatoHistoryWriter;`, writerContext);

(async () => {
    const writer = writerContext.install({ kernel: { rpc: { call: {} } } });
    let signalSeen = false;
    const result = await writer.run((signal) => {
        signalSeen = !!signal && signal.aborted === false;
        return 'local-fallback-ok';
    });
    assert.equal(result, 'local-fallback-ok', 'missing Kernel lease RPC must use local serialized writer');
    assert.equal(signalSeen, true);
    assert.equal(writer.assert(), true);
    writer.dispose();

    assert.match(tomatoSource, /async function writeHistoryYearRecords\(year, records, currentIndex\) \{[\s\S]*?normalizeHistoryRecords\(records\)/,
        'year-shard writes must normalize newly created or edited records');
    assert.match(tomatoSource, /applyRoutineButtonMetaToRecord\(newRecord, routineMeta\);\s*normalizeHistoryRecords\(\[newRecord\]\);/,
        'manual history append must persist the v2 record schema');
    console.log('history edit regression tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
