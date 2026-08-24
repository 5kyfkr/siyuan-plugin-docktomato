'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

assert.match(source, /ACCOUNTING_LEDGER_SCHEMA_VERSION = 3/,
    'accounting ledger must have an explicit migration schema');
assert.match(source, /ACCOUNTING_LEDGER_RECENT_ENTRY_LIMIT = 2000/,
    'accounting ledger must keep a bounded recent entry window');
assert.match(source, /function normalizeAccountingLedger\([\s\S]*?indexAccountingEntry\(/,
    'legacy accounting entries must be migrated into indexes');
assert.match(source, /function compactAccountingLedger\([\s\S]*?ACCOUNTING_LEDGER_RECENT_ENTRY_LIMIT/,
    'completed accounting entries must be compacted after indexing');
assert.match(source, /getAccountingEntryTotals\([\s\S]*?ledger\?\.totals\?\./,
    'accounting totals must use the aggregate index before scanning entries');
assert.match(source, /async retryPending\([\s\S]*?applyQueue\(pending, \{ scheduleRetry: false \}\)/,
    'pending accounting effects must retry through a dedicated queue');
assert.match(source, /ackAccountingEffect:[\s\S]*?indexAccountingEntry\(ledger, entry\)/,
    'external accounting acknowledgements must update aggregate indexes');
assert.match(source, /function scheduleAccountingRetry\([\s\S]*?ACCOUNTING_RETRY_MAX_DELAY_MS/,
    'accounting retries must use bounded backoff');
assert.match(source, /delayMs !== null && delayMs !== undefined/,
    'an omitted retry delay must not be coerced into an immediate retry');
assert.match(source, /clearPendingSiyuanSync\(\)\s*\{[\s\S]*?_pendingSiyuanSyncTimer/,
    'SyncManager must own cleanup of its delayed sync timer');

const recoveryStart = source.indexOf('        async recoverJournal(');
const recoveryEnd = source.indexOf('        async execute(command, builder)', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'journal recovery must remain extractable');
const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
assert.doesNotMatch(recoveryBlock, /journal\.status === 'committed' && \(!historyReady \|\| !accountingComplete\)/,
    'pending accounting must not downgrade a committed journal on every transition');
assert.match(recoveryBlock, /journal\.status === 'committed' && !accountingComplete\) scheduleAccountingRetry\(\)/,
    'committed pending accounting must be handed to the background retry queue');

const cleanupStart = source.indexOf('    const cleanupTomato = () => {');
const cleanupEnd = source.indexOf('    globalThis.__TomatoTimerCleanup', cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'cleanup must remain extractable');
assert.match(source.slice(cleanupStart, cleanupEnd), /clearAccountingRetryTimer\(\)/,
    'plugin cleanup must cancel the accounting retry timer');

console.log('accounting lifecycle contract tests passed');
