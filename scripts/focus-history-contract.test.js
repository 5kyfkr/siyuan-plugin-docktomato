const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const recordStart = source.indexOf('    async function recordEndTime(');
const recordEnd = source.indexOf('    async function clearCurrentRecordAssociation()', recordStart);
assert.ok(recordStart >= 0 && recordEnd > recordStart, 'recordEndTime block must remain extractable');
const recordBlock = source.slice(recordStart, recordEnd);

assert.match(recordBlock, /durationMin:\s*durationMinToSave,[\s\S]*durationSec:\s*durationSecToSave/, 'history records must publish actual focus duration fields');
assert.match(recordBlock, /taskBlockId:\s*shouldSaveTaskAssociation \? assocTaskBlockId : null/, 'history records must retain task association');
assert.match(recordBlock, /databaseBlockId:\s*shouldSaveTaskAssociation \? assocDatabaseBlockId : null/, 'history records must retain database task association');
assert.match(recordBlock, /sessionId:\s*recordSessionId/, 'history records must retain the pomodoro session ID');
assert.match(recordBlock, /didSaveHistoryRecords = await mutateHistoryRecords\(records =>[\s\S]*countDelta:\s*shouldUpdateTomatoCount \? 1 : 0/, 'actual tomato count updates must occur only after serialized history persistence');
assert.doesNotMatch(recordBlock, /estimateAttrName|tomatoEstimateCount|custom-tomato-estimate-count/, 'estimated tomato count must not gate or alter history persistence');

console.log('focus history contract tests passed');
