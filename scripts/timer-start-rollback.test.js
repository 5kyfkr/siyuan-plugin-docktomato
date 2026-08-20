'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('    async function startTimer(');
const end = source.indexOf('    async function pauseTimer()', start);
assert.ok(start >= 0 && end > start, 'startTimer must remain extractable');
const block = source.slice(start, end);

assert.match(block, /catch \(e\) \{[\s\S]*await rollbackFailedTimerStart\(false\);[\s\S]*throw e;/, 'start failures must fully rollback and remain observable to callers');
assert.doesNotMatch(source, /(?<!await )(?<!function )startTimer\(\);/, 'startTimer calls must be awaited or explicitly caught');

const rollbackStart = source.indexOf('    async function rollbackFailedTimerStart(');
const rollbackEnd = source.indexOf('    function finalizeCurrentSegmentBeforeTransition()', rollbackStart);
const rollbackBlock = source.slice(rollbackStart, rollbackEnd);
assert.match(rollbackBlock, /stopwatchSegmentStartTimestamp = null;[\s\S]*stopwatchSegmentStartTimeMs = 0;[\s\S]*stopwatchSegmentBaseElapsedSeconds = 0;/, 'failed starts must clear every partial stopwatch segment field');
assert.match(rollbackBlock, /syncState\.status = 'IDLE';[\s\S]*syncState\.stopwatchDisplayOffset = 0;/, 'failed starts must leave an internally consistent idle sync state');

console.log('timer start rollback tests passed');
