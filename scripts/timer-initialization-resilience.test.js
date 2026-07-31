'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const mkdirStart = source.indexOf('    function __tomatoNormalizeDirPath(');
const mkdirEnd = source.indexOf('    const __tomatoEnsuredDirs', mkdirStart);
assert.ok(mkdirStart >= 0 && mkdirEnd > mkdirStart, 'directory helpers must remain extractable');

const requests = [];
class FakeFormData {
    constructor() { this.values = new Map(); }
    append(key, value) { this.values.set(key, value); }
}
class FakeBlob {}
const mkdirContext = vm.createContext({
    Blob: FakeBlob,
    FormData: FakeFormData,
    String,
    fetch: async (url, options) => {
        requests.push({ url, body: options.body });
        return { ok: true, json: async () => ({ code: 0 }) };
    },
    postJSON: async () => ({ ok: false, data: { code: -1 } }),
});
vm.runInContext(`${source.slice(mkdirStart, mkdirEnd)}\nthis.mkdir = __tomatoMkdir;`, mkdirContext);

const updateStart = source.indexOf('        async updateLocal(');
const updateEnd = source.indexOf('        checkStateChanged(', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'sync update method must remain extractable');
const updateMethod = source.slice(updateStart, updateEnd);
const syncContext = vm.createContext({
    Logger: { debug: () => {} },
    Number,
    SYNC_DEVICE_ID: 'test-device',
    isSyncEnabled: () => false,
    syncState: { mode: 'countdown', status: 'IDLE', sequenceId: 0 },
});
vm.runInContext(`
this.manager = {
    localState: null,
    onStateChange: null,
    saveCount: 0,
    checkStateChanged: () => true,
    saveToCloud: async function () { this.saveCount++; },
${updateMethod}
};`, syncContext);

(async () => {
    assert.equal(await mkdirContext.mkdir('/data/storage/petal/siyuan-plugin-docktomato/history'), true);
    assert.equal(requests[0].url, '/api/file/putFile', 'directories must use SiYuan putFile');
    assert.equal(requests[0].body.values.get('isDir'), 'true', 'putFile must explicitly create a directory');

    const updated = await syncContext.manager.updateLocal({ status: 'RUNNING', startTime: 123 }, true);
    assert.equal(updated.status, 'RUNNING');
    assert.equal(updated.sequenceId, 1, 'pre-init updates must bootstrap and advance the sync version');
    assert.equal(updated.lastModifiedDevice, 'test-device');
    assert.equal(syncContext.manager.saveCount, 0, 'disabled sync must never push bootstrapped state to cloud');

    assert.match(source, /let records = \[\];[\s\S]*records = await loadHistoryRecords\(\);[\s\S]*历史记录暂时不可用，计时器继续初始化/, 'history failures must not abort timer initialization');
    assert.doesNotMatch(source, /created \|\| true/, 'failed directory creation must never be cached as successful');
    console.log('timer initialization resilience tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
