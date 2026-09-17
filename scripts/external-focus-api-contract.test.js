'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

assert.match(source, /DOCK_TOMATO_FOCUS_API_VERSION\s*=\s*1/, 'the public focus facade must be versioned');
assert.match(source, /globalThis\.__dockTomato\.focus\s*=\s*Object\.freeze/, 'the focus facade must be immutable');
assert.match(source, /capabilities:\s*DOCK_TOMATO_FOCUS_CAPABILITIES/, 'consumers must be able to negotiate supported capabilities');
assert.match(source, /'completion-event'/, 'completion event capability must be declared explicitly');
assert.match(source, /start:\s*\(input\)\s*=>\s*startDockTomatoExternalFocus/, 'the facade must expose start');
assert.match(source, /pause:\s*\(\)\s*=>\s*pauseDockTomatoExternalFocus/, 'the facade must expose non-destructive pause');
assert.match(source, /DOCK_TOMATO_TIMER_BUSY/, 'concurrent external starts must be rejected explicitly');
assert.match(source, /DOCK_TOMATO_NOT_READY/, 'startup recovery must have a stable public error code');
assert.match(source, /DOCK_TOMATO_INVALID_CONTEXT/, 'invalid supplied context must not silently lose correlation');
assert.match(source, /DOCK_TOMATO_EXTERNAL_CONTEXT_MAX_BYTES\s*=\s*4096/, 'external context must have a byte limit');
assert.match(source, /Object\.getOwnPropertyDescriptors\(value\)/, 'context normalization must not execute untrusted getters');
assert.match(source, /Object\.freeze\(safe\)/, 'echoed context must not expose mutable shared state');
assert.match(source, /tomato:focus-api-availability-changed/, 'load and unload availability must be observable');
assert.match(source, /tomato:focus-session-started/, 'successful starts must be observable');
assert.match(source, /tomato:focus-session-paused/, 'adapter pauses must be observable');
assert.match(source, /tomato:focus-session-completed/, 'durably completed focus sessions must be observable');
assert.match(source, /recordData\.phase === 'focus' && recordData\.isCompleted && recordData\.integrationContext/, 'breaks, partial records and abandoned sessions must not emit completion');
assert.match(source, /await pauseTimer\(\)/, 'external stop must preserve resumable elapsed time');
assert.match(source, /integrationContext:\s*String\(syncStateAtEnd[\s\S]*normalizeDockTomatoExternalContext/, 'the durable history draft must retain session-bound safe correlation context');
assert.match(source, /externalFocus:\s*typeof normalizeDockTomatoExternalContext[\s\S]*envelope\.externalFocus/, 'external context must participate in the semantic sync signature');
assert.match(source, /externalFocusSessionId:\s*String\(envelope\.externalFocusSessionId/, 'external context must be bound to one stable focus session');
assert.match(source, /externalFocusSessionId \|\| ''\) === String\(focusSessionIdAtEnd/, 'stale context must never attach to a later manual focus session');
assert.match(source, /segmentTaskBlockId\s*=\s*null;[\s\S]*focusRestoreSource\s*=\s*'';/, 'external starts must not inherit stale segment or focus associations');
assert.match(source, /const previous = \{[\s\S]*envelopeTaskAssociation:[\s\S]*catch \(error\)[\s\S]*currentTaskBlockId = previous\.currentTaskBlockId/, 'failed starts must roll back duration and task association mutations');
assert.doesNotMatch(source, /siyuanCheckin\.recordEvent/, 'Dock Tomato must remain independent from a specific consumer');

console.log('external focus API contract tests passed');
