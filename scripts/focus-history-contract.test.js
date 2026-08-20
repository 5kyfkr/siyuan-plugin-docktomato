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
assert.match(recordBlock, /sessionId:\s*physicalSessionId/, 'history records must retain a physical session ID');
assert.match(recordBlock, /TransitionExecutor\.execute\([\s\S]*historyDrafts[\s\S]*accountingDrafts/, 'history and accounting must commit through the ordered transition executor');
assert.match(recordBlock, /effectId:\s*`count:\$\{recordData\.focusSessionId\}`/, 'actual tomato count updates must remain idempotent per focus session');
assert.doesNotMatch(recordBlock, /estimateAttrName|tomatoEstimateCount|custom-tomato-estimate-count/, 'estimated tomato count must not gate or alter history persistence');
assert.match(recordBlock, /hideShortRecordsAtEnd && durationMsToSave < 60000/, 'sub-minute history visibility must use authoritative milliseconds and respect the user setting');

const repositoryStart = source.indexOf('    const HistoryRepository = {');
const repositoryEnd = source.indexOf('    function mergeUniqueHistoryRecords(', repositoryStart);
const repositoryBlock = source.slice(repositoryStart, repositoryEnd);
assert.match(repositoryBlock, /displayView\(records, options = \{\}\)[\s\S]*includeShort[\s\S]*isSubMinuteHistoryRecord\(record\)/, 'the history dialog must be able to restore persisted short records when filtering is disabled');

const cardStart = source.indexOf('    function createHistoryItem(');
const cardEnd = source.indexOf('\n    function exitProtyleFocusMode(', cardStart);
const cardBlock = source.slice(cardStart, cardEnd);
assert.match(cardBlock, /roundedSeconds = Math\.max\(0, Math\.round\([\s\S]*Math\.round\(Number\(min\)/, 'history cards must render integer seconds and minutes');

console.log('focus history contract tests passed');
