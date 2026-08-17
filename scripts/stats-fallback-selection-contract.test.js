const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

assert.match(source, /installTomatoStatsFacade = async[\s\S]*readFallbackMarker/,
    'statistics facade setup must reconcile fallback state asynchronously');
assert.match(source, /readPersistedHistoryRevision[\s\S]*TOMATO_HISTORY_INDEX_PATH[\s\S]*reconcileFallbackMarker[\s\S]*persistedRevision >= fallback\.revision[\s\S]*removeItem\(fallbackMetaKey\)/,
    'a stale local fallback marker must be removed when persisted shards are newer');
assert.match(source, /resolveFallbackQuerySource[\s\S]*hydrateKernelHistory\(fallback\.revision\)/,
    'Kernel fallback hydration must retain the original fallback revision');
assert.doesNotMatch(source, /fallbackSnapshotCache|readFallbackSnapshot/,
    'the renderer facade must not retain a second parsed copy of all fallback history');
assert.match(source, /const run = async \(method, coreMethod, options = \{\}, control = \{\}\)[\s\S]*queryOptions = \{ \.\.\.\(options \|\| \{\}\), queryID \}[\s\S]*callKernel\(method, queryOptions\)/,
    'the facade must add only a bounded cancellation ID before calling the Kernel');
assert.match(source, /error\.details = result\?\.error\?\.details \|\| null/,
    'the renderer facade must preserve structured Kernel error details');
assert.match(source, /isRecoverableHistorySourceError[\s\S]*HISTORY_SOURCE_UNAVAILABLE[\s\S]*HISTORY_REVISION_CHANGED/,
    'local fallback must be limited to recoverable history source failures');
assert.match(source, /catch \(kernelError\) \{[\s\S]*if \(!isRecoverableHistorySourceError\(kernelError\)\) throw kernelError/,
    'deterministic statistics errors must not trigger a second local scan');
assert.match(source, /const run = async[\s\S]*resolveFallbackQuerySource\(control\)[\s\S]*fallbackSource\.useLocal[\s\S]*callKernel\(method, queryOptions\)/,
    'every statistics query must resolve authoritative fallback state before reading Kernel data');
assert.match(source, /plugin\?\.kernel\?\.rpc\?\.call\?\.dockTomatoCancelStatsQuery/,
    'the statistics facade must expose the Kernel cancellation RPC');
assert.match(source, /const abortHandler = \(\) => \{ void cancelKernelQuery\(\); \};[\s\S]*signal\?\.addEventListener/,
    'aborting a facade query must explicitly cancel its Kernel scan');
assert.match(source, /kernelSource === "legacy" && kernelRecordCount === 0[\s\S]*loadLocalRecords\(queryOptions, control\)[\s\S]*frontend-local-after-empty-kernel[\s\S]*hydrateKernelHistory/,
    'an empty legacy Kernel result must recover from the authoritative frontend history store');
assert.match(source, /hydrateKernelHistory[\s\S]*history\?\.loadAll[\s\S]*dockTomatoSetHistoryFallback/,
    'on-demand recovery must hydrate a Kernel that cannot read persisted history files');
assert.doesNotMatch(source, /reason:\s*["']renderer-ready["']/,
    'renderer startup must not send the complete history when the Kernel can read persisted shards');

console.log('stats fallback selection contract tests passed');
