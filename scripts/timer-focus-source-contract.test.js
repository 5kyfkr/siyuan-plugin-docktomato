'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const sourceStart = source.indexOf('    function normalizeFocusRestoreSource');
const sourceEnd = source.indexOf('    function getCurrentFocusRestoreOptions', sourceStart);
assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, 'focus source helpers must remain extractable');
const helpers = source.slice(sourceStart, sourceEnd);

const context = vm.createContext({
    currentTaskBlockId: 'task-1',
    currentDatabaseBlockId: '',
    focusRestoreSource: '',
    syncState: {
        taskBlockId: null,
        integrationEnvelope: {
            taskAssociation: {
                taskBlockId: 'task-1',
                source: 'task-horizon',
            },
        },
    },
    getLocalTaskAssociationSidecar: () => null,
    lastCompletedAssociationFocusSnapshot: null,
});
vm.runInContext(`${helpers}\nthis.resolveSource = resolveCurrentAssociationFocusSource;`, context);

assert.equal(context.resolveSource(), 'task-horizon', 'current canonical association must restore its trusted source');

context.syncState.integrationEnvelope.taskAssociation = {
    taskBlockId: 'task-1',
    source: 'manual',
};
assert.equal(context.resolveSource(), '', 'manual associations must not trigger integration focus');
context.focusRestoreSource = 'task-horizon';
assert.equal(context.resolveSource(), '', 'a stale trusted source must not override a matching manual association');

context.currentTaskBlockId = '';
context.currentDatabaseBlockId = 'db-1';
context.syncState.integrationEnvelope.taskAssociation = null;
context.getLocalTaskAssociationSidecar = () => ({
    association: { databaseBlockId: 'db-1', sourceKind: 'database-menu' },
});
assert.equal(context.resolveSource(), 'database-menu', 'local database associations must restore their trusted source');

context.currentTaskBlockId = '';
context.currentDatabaseBlockId = '';
context.getLocalTaskAssociationSidecar = () => null;
assert.equal(context.resolveSource(), '', 'unassociated timers must remain unfocused');

const countdownStart = source.slice(
    source.indexOf('    async function switchToCountdownAndStart('),
    source.indexOf('    // 带任务块关联的番茄钟切换', source.indexOf('    async function switchToCountdownAndStart(')),
);
const stopwatchStart = source.slice(
    source.indexOf('    async function switchToStopwatchAndStart('),
    source.indexOf('    // 带任务块关联的正计时切换', source.indexOf('    async function switchToStopwatchAndStart(')),
);
assert.match(countdownStart, /setFocusRestoreSource\(resolveCurrentAssociationFocusSource\(\)\)/);
assert.match(stopwatchStart, /setFocusRestoreSource\(resolveCurrentAssociationFocusSource\(\)\)/);

console.log('timer focus source contract tests passed');
