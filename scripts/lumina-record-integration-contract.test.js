'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const lookupStart = source.indexOf('    function getLuminaPluginInstance()');
const lookupEnd = source.indexOf('    function hasLuminaHistoryRecords(', lookupStart);
assert.ok(lookupStart >= 0 && lookupEnd > lookupStart, 'Lumina plugin lookup must remain extractable');
const lookupBlock = source.slice(lookupStart, lookupEnd);
assert.match(lookupBlock, /__getPluginApp\(\)\?\.plugins/, 'Lumina must be resolved from the official app plugin list');
assert.match(lookupBlock, /plugin\?\.name === 'siyuan-lumina'/, 'Lumina must be resolved by its stable plugin name');

const tagFormatterStart = source.indexOf('    function formatLuminaBreezeTag(');
const tagFormatterEnd = source.indexOf('    async function buildLuminaTimerStatusTail(', tagFormatterStart);
assert.ok(tagFormatterStart >= 0 && tagFormatterEnd > tagFormatterStart, 'Lumina tag formatter must remain extractable');
const tagFormatterSource = source.slice(tagFormatterStart, tagFormatterEnd).trim();
const formatLuminaBreezeTag = new Function(`return (${tagFormatterSource});`)();
assert.equal(formatLuminaBreezeTag(`\u5de5\u4f5c\u200B`), '#\u5de5\u4f5c', 'zero-width suffixes must be removed from routine tags');
assert.equal(formatLuminaBreezeTag(`\u6df1\u5ea6 \u5de5\u4f5c`), '#\u6df1\u5ea6-\u5de5\u4f5c', 'spaces must produce one valid Breeze tag');

const statusStart = source.indexOf('    async function buildLuminaTimerStatusTail(');
const statusEnd = source.indexOf('    function getLuminaActiveTimerSnapshot(', statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, 'Lumina timer status builder must remain extractable');
const statusBlock = source.slice(statusStart, statusEnd);
assert.match(statusBlock, /const routineTagLine = formatLuminaBreezeTag\(getActiveRoutineNameForLuminaTag\(taskBlockId\)\);/, 'active routine tags must be embedded in the timer status');
assert.match(statusBlock, /const displayTaskName = routineTagLine \|\| taskName;/, 'the embedded routine tag must replace the duplicate plain routine name');

const writerStart = source.indexOf('    async function writeTimelineLuminaRecord(');
const writerEnd = source.indexOf('    function findHistoryRecordCoveringTimestamp(', writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, 'Lumina record writer must remain extractable');
const writerBlock = source.slice(writerStart, writerEnd);
assert.match(writerBlock, /const luminaTag = routineTag \|\| fallbackTag;/, 'the active routine name must remain the preferred tag');
assert.match(writerBlock, /const recordContent = tagLine/, 'the Lumina tag must be added to the stored content');
assert.match(writerBlock, /await luminaPlugin\.addBreezeNote\(\{ content: recordContent, timestamp \}\)/, 'records must be persisted by Lumina');
assert.match(writerBlock, /noteId/, 'the returned Lumina note ID must be retained');
assert.doesNotMatch(writerBlock, /readTimelineLuminaConfig|appendTimelineLumina|custom-lumina/, 'the active writer must not use the legacy block integration');

const normalizeStart = source.indexOf('    function normalizeLuminaRecordEntry(');
const normalizeEnd = source.indexOf('    function formatLuminaDateTimeAttr(', normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'Lumina history normalization must remain extractable');
const normalizeBlock = source.slice(normalizeStart, normalizeEnd);
assert.match(normalizeBlock, /noteId: String\(entry\?\.noteId/, 'Lumina history must persist the note ID');
assert.match(normalizeBlock, /normalized\.noteId \|\| normalized\.blockId/, 'history deduplication must prefer the new note ID');

console.log('Lumina record integration contract tests passed');
