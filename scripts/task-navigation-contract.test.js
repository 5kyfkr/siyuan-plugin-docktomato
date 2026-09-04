'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tomato.js'), 'utf8');

const navigationStart = source.indexOf('    async function navigateToBlock(blockId)');
const navigationEnd = source.indexOf('    function findBlockElement(blockId)', navigationStart);
assert.ok(navigationStart >= 0 && navigationEnd > navigationStart, 'task navigation must remain inspectable');
const navigation = source.slice(navigationStart, navigationEnd);

assert.match(
    navigation,
    /await __openBlockByOfficialApi\(blockId\)/,
    'history task links must give the official SiYuan API the task block id so it can locate and highlight the block',
);
assert.doesNotMatch(
    navigation,
    /await __openBlockByOfficialApi\(docId \|\| blockId\)/,
    'history task links must not replace the target block id with its document id',
);

console.log('tomato task navigation contract tests passed');
