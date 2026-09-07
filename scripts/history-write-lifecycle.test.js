'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const extract = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker + ' must remain extractable');
    return source.slice(start, end);
};
const historyIndex = { revision: 1, shards: {} };
const context = vm.createContext({
    Error,
    Promise,
    __tomatoDestroyed: false,
    historyIndexIdentity: (index) => JSON.stringify(index),
    readHistoryIndex: async () => historyIndex,
});
vm.runInContext([
    extract('    let __tomatoHistoryMutationQueue =', '    const HISTORY_LOCAL_STORAGE_KEY ='),
    extract('    function historyWriterDisposedError()', '    function isHistoryWriteCoordinationError('),
    extract('    async function assertHistoryIndexCommitAllowed(', '    function createHistoryShardFileName('),
    extract('    function queueHistoryOperation(', '    async function persistHistoryRecords('),
    'this.queue = queueHistoryOperation; this.assertCommit = assertHistoryIndexCommitAllowed;',
].join('\n'), context);
const createWriter = () => ({
    active: false,
    runs: 0,
    assertions: 0,
    controller: new AbortController(),
    async run(operation) {
        this.active = true;
        this.runs += 1;
        try {
            return await operation(this.controller.signal);
        } finally {
            this.active = false;
        }
    },
    async assert() {
        this.assertions += 1;
        assert.equal(this.active, true, 'commits must be checked by the writer that owns the operation');
    },
});

(async () => {
    const originalWriter = createWriter();
    const replacementWriter = createWriter();
    context.__dockTomatoHistoryWriter = originalWriter;
    await context.queue(async () => {
        await Promise.resolve();
        context.__dockTomatoHistoryWriter = replacementWriter;
        assert.equal(await context.assertCommit(historyIndex), true);
    });
    assert.equal(originalWriter.assertions, 1, 'bridge replacement must not change an in-flight write owner');
    assert.equal(replacementWriter.assertions, 0, 'the new bridge has no lease for the old write');
    await context.queue(() => context.assertCommit(historyIndex));
    assert.equal(replacementWriter.assertions, 1, 'the next write must use the replacement bridge');

    delete context.__dockTomatoHistoryWriter;
    const lateWriter = createWriter();
    await context.queue(async () => {
        context.__dockTomatoHistoryWriter = lateWriter;
        await context.assertCommit(historyIndex);
    });
    assert.equal(lateWriter.assertions, 0, 'standalone writes must not assert against a newly installed bridge');

    const abortedWriter = createWriter();
    context.__dockTomatoHistoryWriter = abortedWriter;
    await assert.rejects(context.queue(async () => {
        abortedWriter.controller.abort();
        context.__dockTomatoHistoryWriter = createWriter();
        await context.assertCommit(historyIndex);
    }), (error) => error?.code === 'HISTORY_WRITER_DISPOSED');
    await context.queue(() => context.assertCommit(historyIndex));

    context.readHistoryIndex = async () => ({ revision: 2, shards: {} });
    await assert.rejects(context.queue(() => context.assertCommit(historyIndex)),
        (error) => error?.code === 'HISTORY_REVISION_CHANGED', 'revision conflict checks must remain enforced');
    context.readHistoryIndex = async () => historyIndex;
    await context.queue(() => context.assertCommit(historyIndex));

    delete context.__dockTomatoHistoryWriter;
    let queuedOperationRan = false;
    let queued;
    const pending = context.queue(async () => {
        context.__tomatoDestroyed = true;
        queued = assert.rejects(context.queue(() => { queuedOperationRan = true; }),
            (error) => error?.code === 'HISTORY_WRITER_DISPOSED');
        return context.assertCommit(historyIndex);
    });
    await assert.rejects(pending, (error) => error?.code === 'HISTORY_WRITER_DISPOSED');
    await queued;
    assert.equal(queuedOperationRan, false, 'unloaded timers must not commit or start queued history operations');
    const newRuntimeWriter = createWriter();
    context.__dockTomatoHistoryWriter = newRuntimeWriter;
    await assert.rejects(context.queue(() => true), (error) => error?.code === 'HISTORY_WRITER_DISPOSED');
    assert.equal(newRuntimeWriter.runs, 0, 'old queues must not acquire a new runtime writer');
    console.log('history write lifecycle tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
