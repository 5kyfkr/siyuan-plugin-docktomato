'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const historyStart = source.indexOf('    const HistoryRepository = {');
const historyEnd = source.indexOf('    function mergeUniqueHistoryRecords(', historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart, 'history repository must remain extractable');
assert.match(source.slice(historyStart, historyEnd), /async discardFocusSession\(focusSessionId, correctionId = null\)[\s\S]*record\.disposition = 'discarded'/,
    'abandoning a tomato must tombstone all focus history segments for its session');

const accountingStart = source.indexOf('    const AccountingRepository = {');
const accountingEnd = source.indexOf('    function clearAccountingRetryTimer()', accountingStart);
assert.ok(accountingStart >= 0 && accountingEnd > accountingStart, 'accounting repository must remain extractable');
assert.match(source.slice(accountingStart, accountingEnd), /async discardFocusSession\(focusSessionId, correctionId = null\)[\s\S]*entry\.status = 'discarded'/,
    'abandoning a tomato must discard its accounting effects');
assert.match(source.slice(accountingStart, accountingEnd), /reprojectPolicy\(getTomatoAccountingPolicy\(\), \{ includeZero: true \}\)/,
    'discarded accounting must reproject zero totals to task attributes');
const reprojectBlock = source.slice(accountingStart, accountingEnd);
assert.ok(reprojectBlock.indexOf('if (includeZero)') < reprojectBlock.indexOf('const patch = {};'),
    'zero-total accounting keys must be included before the task attribute patch is built');

const abandonStart = source.indexOf('    async function abandonCurrentTomato(');
const abandonEnd = source.indexOf('    async function resetCurrentMode(', abandonStart);
assert.ok(abandonStart >= 0 && abandonEnd > abandonStart, 'abandon handler must remain extractable');
const abandonBlock = source.slice(abandonStart, abandonEnd);
assert.doesNotMatch(abandonBlock, /recordEndTime\(/, 'abandoning a tomato must not create a new elapsed history record');
assert.match(abandonBlock, /HistoryRepository\.discardFocusSession\(focusSessionId, correctionId\)/,
    'abandon handler must discard persisted focus segments');
assert.match(abandonBlock, /AccountingRepository\.discardFocusSession\(focusSessionId, correctionId\)/,
    'abandon handler must discard persisted task accounting');
assert.match(abandonBlock, /next\.activeTimer = null[\s\S]*next\.writerLease = null/,
    'abandon handler must clear canonical timer ownership');

const menuLabelCount = (source.match(/'放弃番茄钟'/g) || []).length;
assert.equal(menuLabelCount, 2, 'both timer menus must use the abandon label');
assert.match(source, /if \(timerMode === 'countdown'\) await abandonCurrentTomato\(\)/,
    'context menu countdown action must use the abandon handler');
assert.match(source, /else if \(timerMode === 'countdown'\) \{\s*await abandonCurrentTomato\(\);/,
    'desktop float menu countdown action must use the abandon handler');

console.log('tomato abandon contract tests passed');
