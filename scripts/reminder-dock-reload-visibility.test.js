'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./i18n-vm-fixture');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

const segment = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing segment start: ${start}`);
    assert.notEqual(to, -1, `missing segment end: ${end}`);
    return source.slice(from, to);
};

const layoutReady = segment('    onLayoutReady() {', '    onunload() {');

// SiYuan runs onLayoutReady before mounting plugin docks. This hook must not
// rewrite the persisted show state, otherwise every startup clears the dock
// that the user left open in the previous session.
assert.doesNotMatch(source, /resetReminderDockReloadVisibility/);
assert.doesNotMatch(layoutReady, /local-plugin-docks|setStorageVal|\.show\s*=/);

const dockKey = 'siyuan-plugin-docktomato::tomato-reminder';
const savedDocks = {
    'siyuan-plugin-docktomato': {
        [dockKey]: {position: 'RightTop', index: 8, show: true},
    },
};
const {onLayoutReady} = vm.runInNewContext(`({${layoutReady}})`, {savedDocks});

const calls = [];
const registered = {
    _reminderDockAdded: true,
    _registerReminderDock: (reason) => calls.push(`register:${reason}`),
    _scheduleReminderDockRecover: (reason) => calls.push(`recover:${reason}`),
};
onLayoutReady.call(registered);
assert.deepEqual(calls, ['recover:layout-ready']);
assert.equal(savedDocks['siyuan-plugin-docktomato'][dockKey].show, true,
    'an open Dock must survive the startup layout hook');

calls.length = 0;
const unregistered = {
    _reminderDockAdded: false,
    _registerReminderDock: (reason) => calls.push(`register:${reason}`),
    _scheduleReminderDockRecover: (reason) => calls.push(`recover:${reason}`),
};
onLayoutReady.call(unregistered);
assert.deepEqual(calls, ['register:layout-ready']);
assert.equal(savedDocks['siyuan-plugin-docktomato'][dockKey].show, true,
    'registering during startup must not rewrite the saved open state');

savedDocks['siyuan-plugin-docktomato'][dockKey].show = false;
onLayoutReady.call(registered);
assert.equal(savedDocks['siyuan-plugin-docktomato'][dockKey].show, false,
    'a closed Dock must stay closed');

console.log('reminder Dock startup visibility tests passed');
