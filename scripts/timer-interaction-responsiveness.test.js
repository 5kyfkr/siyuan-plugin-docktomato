'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const dialogStart = source.indexOf('    function showToastDialog(');
const dialogEnd = source.indexOf('    function removeProgressBarEffects()', dialogStart);
assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, 'timer end dialog must remain extractable');
const dialogBlock = source.slice(dialogStart, dialogEnd);

const actionStart = dialogBlock.indexOf('        const runEndDialogAction =');
const actionEnd = dialogBlock.indexOf('        const acknowledgeAndCloseEndDialog =', actionStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart, 'end dialog actions must use one shared dispatcher');
const actionBlock = dialogBlock.slice(actionStart, actionEnd);
assert.ok(actionBlock.indexOf('closeDialog();') < actionBlock.indexOf('syncAcknowledgeEndDialogClose('), 'end dialog must close visually before asynchronous acknowledgement');
assert.match(actionBlock, /const closeSyncPromise = syncAcknowledgeEndDialogClose\(endDialogId, \{ confirm: false \}\);[\s\S]*const actionPromise = Promise\.resolve\(\)\.then\(action\)/, 'timer actions must run in parallel with the non-blocking close acknowledgement');
assert.match(actionBlock, /syncAcknowledgeEndDialogClose\(endDialogId, \{ confirm: false \}\)/, 'dialog acknowledgement must skip a second confirmation prompt');

assert.match(source, /\.tomato-dialog-action:hover:not\(:disabled\)/, 'end dialog actions must expose hover feedback');
assert.match(source, /\.tomato-dialog-action:active:not\(:disabled\)/, 'end dialog actions must expose pressed feedback');
assert.match(source, /\.tomato-dialog-action:focus-visible/, 'end dialog actions must expose keyboard focus feedback');
assert.ok((dialogBlock.match(/className = 'tomato-dialog-action'/g) || []).length >= 8, 'all end-dialog timer actions must share the interactive action class');
assert.doesNotMatch(dialogBlock, /await syncAcknowledgeEndDialogClose\(endDialogId/, 'individual timer buttons must not keep the modal open while acknowledgement resolves');
assert.match(dialogBlock, /const acknowledgeAndCloseEndDialog = \(\) => runEndDialogAction\([\s\S]*reportError: false/, 'acknowledging an end dialog must not show a second failure toast for background cleanup');

console.log('timer interaction responsiveness tests passed');
