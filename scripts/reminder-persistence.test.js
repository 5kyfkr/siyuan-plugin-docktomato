'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const between = (first, last) => {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start + first.length);
    assert.ok(start >= 0 && end > start, first);
    return source.slice(start, end);
};

let attrs = {};
let flushCode = 0;
let readCode = 0;
let writeOk = true;
let readMismatch = false;
const calls = [];
const context = vm.createContext({
    Map,
    Promise,
    String,
    Object,
    Array,
    JSON,
    Number,
    postJSON: async (url) => {
        calls.push(url);
        if (url === '/api/sqlite/flushTransaction') return { ok: true, data: { code: flushCode } };
        if (url === '/api/attr/getBlockAttrs') {
            const value = { ...attrs };
            if (readMismatch) value['custom-tomato-reminder'] = 'stale';
            return { ok: readCode === 0, data: { code: readCode, data: value } };
        }
        throw new Error(`unexpected request: ${url}`);
    },
    writeTomatoAttrContextAttrs: async (_context, nextAttrs) => {
        calls.push('write');
        if (writeOk) attrs = { ...attrs, ...nextAttrs };
        return writeOk;
    },
});

vm.runInContext([
    'const __tomatoAttrWriteTails = new Map();',
    between('function withTomatoAttrWriteLock(', '\n    function withTomatoTaskAttrLock('),
    between('async function flushReminderTransaction()', 'async function saveBlockReminder('),
    'this.api = { lock: withTomatoAttrWriteLock, persist: persistReminderAttrsAndVerify };',
].join('\n'), context);

async function run() {
    let releaseFirst;
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const order = [];
    const first = context.api.lock('block-a', async () => {
        order.push('first-start');
        await gate;
        order.push('first-end');
    });
    const second = context.api.lock('block-a', async () => { order.push('second'); });
    await Promise.resolve();
    assert.deepEqual(order, ['first-start'], 'same-host read-modify-write callbacks must serialize');
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);

    const resolved = { kind: 'block', reminderBlockId: 'block-a', attrContext: { kind: 'block' } };
    const nextAttrs = { 'custom-tomato-reminder': '{"completedOccurrences":[]}', bookmark: '⏰' };
    calls.length = 0;
    assert.equal(await context.api.persist(resolved, nextAttrs), true);
    assert.deepEqual(calls, ['write', '/api/sqlite/flushTransaction', '/api/attr/getBlockAttrs']);

    calls.length = 0;
    flushCode = -1;
    assert.equal(await context.api.persist(resolved, nextAttrs), false, 'flush errors must prevent save acknowledgement');
    assert.deepEqual(calls, ['write', '/api/sqlite/flushTransaction'], 'failed flushes must not proceed to verification');

    flushCode = 0;
    readMismatch = true;
    calls.length = 0;
    assert.equal(await context.api.persist(resolved, nextAttrs), false, 'readback mismatch must prevent save acknowledgement');
    readMismatch = false;

    writeOk = false;
    calls.length = 0;
    assert.equal(await context.api.persist(resolved, nextAttrs), false, 'attribute write errors must prevent flush and acknowledgement');
    assert.deepEqual(calls, ['write']);

    const saveStart = source.indexOf('async function saveBlockReminder(');
    const saveEnd = source.indexOf('\n    async function getBlockReminder(', saveStart);
    const saveSource = source.slice(saveStart, saveEnd);
    assert.ok(saveSource.indexOf('withTomatoAttrWriteLock(reminderBlockId') < saveSource.indexOf('getReminderAttrsForWrite(reminderBlockId)'));
    assert.ok(saveSource.indexOf('getReminderAttrsForWrite(reminderBlockId)') < saveSource.indexOf("currentAttrs['custom-tomato-reminder']"));
    assert.match(saveSource, /persistReminderAttrsAndVerify\(resolvedReminder, attrs\)/);
    assert.match(source.slice(source.indexOf('async function deleteBlockReminder(')), /persistReminderAttrsAndVerify\(resolvedReminder, clearAttrs\)/);
    console.log('reminder persistence serialization and verification tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
