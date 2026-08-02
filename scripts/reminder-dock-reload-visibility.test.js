'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

const segment = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing segment start: ${start}`);
    assert.notEqual(to, -1, `missing segment end: ${end}`);
    return source.slice(from, to);
};

const resetReloadVisibility = segment('const resetReminderDockReloadVisibility =', 'const fetchText =');
const persisted = [];
const sandbox = {
    siyuan: {
        storage: {
            'local-plugin-docks': {
                'siyuan-plugin-docktomato': {
                    'siyuan-plugin-docktomato::tomato-reminder': { position: 'RightBottom', index: 3, show: true },
                },
            },
        },
    },
    platformUtils: {
        setStorageVal: (key, value) => persisted.push({ key, value }),
    },
};

vm.runInNewContext(`
const PLUGIN_ID = "siyuan-plugin-docktomato";
const REMINDER_DOCK_TYPE = "::tomato-reminder";
${resetReloadVisibility}
this.resetReminderDockReloadVisibility = resetReminderDockReloadVisibility;
`, sandbox);

sandbox.resetReminderDockReloadVisibility({ name: 'siyuan-plugin-docktomato' });
assert.equal(sandbox.siyuan.storage['local-plugin-docks']['siyuan-plugin-docktomato']['siyuan-plugin-docktomato::tomato-reminder'].show, false);
assert.equal(persisted.length, 1);
assert.equal(persisted[0].key, 'local-plugin-docks');
sandbox.resetReminderDockReloadVisibility({ name: 'siyuan-plugin-docktomato' });
assert.equal(persisted.length, 1, 'an already closed reminder Dock must not be persisted again');

const layoutReady = segment('    onLayoutReady() {', '    onunload() {');
assert.match(layoutReady, /resetReminderDockReloadVisibility\(this\)/);

console.log('reminder Dock reload visibility tests passed');
