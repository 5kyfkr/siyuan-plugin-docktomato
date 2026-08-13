'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tomato.js'), 'utf8');

assert.match(
    source,
    /getDefaultTomatoTimeMinutes:\s*\(\)\s*=>\s*__getDefaultTomatoTimeMinutes\(\)/,
    'Dock Tomato must expose its configured default duration',
);
assert.match(
    source,
    /new CustomEvent\('tomato:default-duration-changed',\s*\{\s*detail\s*\}\)/,
    'Dock Tomato must publish default duration changes',
);
assert.match(
    source,
    /await saveUserSettings\(\);\s*__publishTomatoDefaultDuration\('settings'\)/,
    'the settings event must be sent after persistence completes',
);
assert.match(
    source,
    /__publishTomatoDefaultDuration\('load'\)/,
    'the loaded duration must be announced for plugins loaded in either order',
);

console.log('default tomato duration API contract tests passed');
