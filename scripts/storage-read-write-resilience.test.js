'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const readStart = source.indexOf('    async function __tomatoGetFileText(path)');
const readEnd = source.indexOf('    async function __tomatoSelectStoragePaths()', readStart);
assert.ok(readStart >= 0 && readEnd > readStart, 'shared file reader must remain extractable');
const readBlock = source.slice(readStart, readEnd);
assert.match(readBlock, /available: false/, 'transport failures must be distinguishable from an absent file');
assert.doesNotMatch(readBlock.slice(0, readBlock.indexOf('const text = await response.text();')), /__tomatoFileTextCache\.set/, 'failed HTTP responses must not enter the read cache');
assert.match(readBlock, /const v = \{ exists: true, available: true, text:/, 'successful reads must remain cacheable');

const settingsStart = source.indexOf('    async function loadUserSettings()');
const settingsEnd = source.indexOf('    // ========== 历史记录管理 ==========', settingsStart);
assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, 'settings read/write block must remain extractable');
const settingsBlock = source.slice(settingsStart, settingsEnd);
const pathSelectionStart = source.indexOf('    async function __tomatoSelectStoragePaths()');
const pathSelectionEnd = source.indexOf('    async function __tomatoPutFileText(', pathSelectionStart);
assert.ok(pathSelectionStart >= 0 && pathSelectionEnd > pathSelectionStart, 'storage path selection must remain extractable');
const pathSelectionBlock = source.slice(pathSelectionStart, pathSelectionEnd);
assert.match(pathSelectionBlock, /Array\.isArray\(obj\.routineButtons\)[\s\S]*obj\.routineButtons\.length > 0/, 'settings path selection must preserve legacy files that only contain routine buttons');
assert.match(settingsBlock, /if \(!sharedLoaded\)[\s\S]*localStorage\.getItem\('tomato-user-settings'\)/,
    'settings must use localStorage when shared settings are unavailable');
assert.match(settingsBlock, /if \(!sharedLoaded\)[\s\S]*localStorage\.getItem\('focus-time-settings'\)/,
    'focus settings must use localStorage when shared settings are unavailable');
assert.match(settingsBlock, /__tomatoQueueFileWrite\(SETTINGS_FILE_PATH/,
    'settings writes must be serialized per file');
assert.match(settingsBlock, /__tomatoQueueFileWrite\(FOCUS_TIME_SETTINGS_PATH/,
    'focus settings writes must be serialized per file');

const journalStart = source.indexOf('        async recoverJournal()');
const journalEnd = source.indexOf('        async execute(command, builder)', journalStart);
assert.match(source.slice(journalStart, journalEnd), /journal\?\.unavailable[\s\S]*blocking: true/,
    'journal read failures must block recovery in sync mode');
assert.match(source, /if \(sharedReadUnavailable\)[\s\S]*ACCOUNTING_LEDGER_READ_FAILED/,
    'shared accounting read failures must not initialize an empty ledger');

console.log('storage read/write resilience tests passed');
