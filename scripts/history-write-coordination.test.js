'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
const start = source.indexOf('const installTomatoHistoryWriter = (');
const end = source.indexOf('\n\nconst loadTomatoStatsCore', start);
assert.ok(start >= 0 && end > start, 'history writer bridge must remain extractable');

let lease = null;
let tokenSequence = 0;
const leaseRpc = async (payload) => {
    if (payload.action === 'acquire') {
        if (lease) return { ok: true, data: { acquired: false, retryAfterMs: 5, leaseUntil: lease.leaseUntil } };
        lease = { token: `token-${++tokenSequence}`, leaseUntil: Date.now() + 1000 };
        return { ok: true, data: { acquired: true, ...lease } };
    }
    if (!lease || payload.token !== lease.token) return { ok: true, data: { acquired: false } };
    if (payload.action === 'renew') {
        lease.leaseUntil = Date.now() + 1000;
        return { ok: true, data: { acquired: true, ...lease } };
    }
    if (payload.action === 'release') {
        lease = null;
        return { ok: true, data: { acquired: false, released: true } };
    }
    return { ok: true, data: { acquired: true, ...lease } };
};
const plugin = { kernel: { rpc: { call: { dockTomatoHistoryWriteLease: leaseRpc } } } };
const context = vm.createContext({
    AbortController,
    Date,
    Error,
    HISTORY_WRITE_LEASE_MS: 1000,
    HISTORY_WRITE_RPC_TIMEOUT_MS: 100,
    HISTORY_WRITE_WAIT_MS: 1000,
    Math,
    Number,
    Promise,
    String,
    TypeError,
    clearInterval,
    clearTimeout,
    console,
    globalThis: null,
    setInterval,
    setTimeout,
});
context.globalThis = context;
vm.runInContext(`${source.slice(start, end)}\nthis.installTomatoHistoryWriter = installTomatoHistoryWriter;`, context);

(async () => {
    let kernelReady = false;
    const fallbackActions = [];
    const fallbackWriter = context.installTomatoHistoryWriter({ kernel: { rpc: { call: {
        dockTomatoHistoryWriteLease: async (payload) => {
            fallbackActions.push(payload.action);
            if (!kernelReady) return { ok: false, error: { code: 'HISTORY_WRITER_UNAVAILABLE' } };
            return leaseRpc(payload);
        },
    } } } });
    try {
        assert.equal(await fallbackWriter.run(async () => {
            await fallbackWriter.assert();
            return true;
        }), true, 'a local fallback commit must not try to renew a lease it never acquired');
        assert.deepEqual(fallbackActions, ['acquire']);
        kernelReady = true;
        await fallbackWriter.run(() => fallbackWriter.assert());
        assert.deepEqual(fallbackActions, ['acquire', 'acquire', 'renew', 'release'],
            'the next write must use Kernel coordination after it becomes available');
    } finally {
        fallbackWriter.dispose();
    }

    const startingPlugin = {};
    const startupActions = [];
    const startupWriter = context.installTomatoHistoryWriter(startingPlugin);
    try {
        await startupWriter.run(async () => {
            await startupWriter.assert();
            startingPlugin.kernel = { rpc: { call: {
                dockTomatoHistoryWriteLease: async (payload) => {
                    startupActions.push(payload.action);
                    return leaseRpc(payload);
                },
            } } };
            await startupWriter.assert();
        });
        assert.deepEqual(startupActions, [], 'Kernel startup must not change an in-flight local write into a leased write');
        await startupWriter.run(() => startupWriter.assert());
        assert.deepEqual(startupActions, ['acquire', 'renew', 'release']);
    } finally {
        startupWriter.dispose();
    }

    const disappearingPlugin = { kernel: plugin.kernel };
    const disappearingWriter = context.installTomatoHistoryWriter(disappearingPlugin);
    try {
        await disappearingWriter.run(async () => {
            disappearingPlugin.kernel = null;
            try {
                await assert.rejects(Promise.resolve().then(() => disappearingWriter.assert()),
                    (error) => error?.code === 'HISTORY_WRITER_UNAVAILABLE',
                    'an acquired lease must not silently downgrade when Kernel RPC disappears');
            } finally {
                disappearingPlugin.kernel = plugin.kernel;
            }
        });
    } finally {
        disappearingWriter.dispose();
    }

    const localWriter = context.installTomatoHistoryWriter({});
    await assert.rejects(Promise.resolve().then(() => localWriter.assert()),
        (error) => error?.code === 'HISTORY_WRITE_LEASE_LOST', 'assertions outside a write must fail even without Kernel RPC');
    await localWriter.run(async (signal) => {
        await localWriter.assert();
        localWriter.dispose();
        assert.equal(signal.aborted, true);
        await assert.rejects(Promise.resolve().then(() => localWriter.assert()),
            (error) => error?.code === 'HISTORY_WRITE_LEASE_LOST', 'disposed local writes must not commit');
    });
    await assert.rejects(localWriter.run(() => true), (error) => error?.code === 'HISTORY_WRITER_DISPOSED');

    const firstWriter = context.installTomatoHistoryWriter(plugin);
    const secondWriter = context.installTomatoHistoryWriter(plugin);
    const order = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const first = firstWriter.run(async () => {
        order.push('first-start');
        await firstGate;
        await firstWriter.assert();
        order.push('first-end');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = secondWriter.run(async () => {
        order.push('second-start');
        await secondWriter.assert();
        order.push('second-end');
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(order, ['first-start'], 'two renderer windows must never enter history commits concurrently');
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
    assert.equal(lease, null, 'the writer bridge must release its Kernel lease after completion');
    firstWriter.dispose();
    secondWriter.dispose();

    const disposingWriter = context.installTomatoHistoryWriter(plugin);
    let markDisposeRunStarted;
    const disposeRunStarted = new Promise((resolve) => { markDisposeRunStarted = resolve; });
    const disposingRun = disposingWriter.run((signal) => new Promise((resolve, reject) => {
        markDisposeRunStarted();
        signal.addEventListener('abort', () => reject(Object.assign(new Error('disposed'), {
            code: 'HISTORY_WRITER_DISPOSED',
        })), { once: true });
    }));
    await disposeRunStarted;
    assert.ok(lease?.token, 'the disposal contract must start with an active lease');
    assert.equal(disposingWriter.dispose(), true, 'dispose must actively release an acquired lease');
    await assert.rejects(disposingRun, (error) => error?.code === 'HISTORY_WRITER_DISPOSED');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lease, null, 'dispose must not retain the lease until its TTL expires');
    console.log('history write coordination tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
