'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
const tomatoSource = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const registerStart = source.indexOf('_registerReminderDock(reason = "manual", options = {})');
const registerEnd = source.indexOf('\n    async onload()', registerStart);

assert.ok(registerStart >= 0 && registerEnd > registerStart, 'reminder Dock registration block must remain extractable');

const registration = source.slice(registerStart, registerEnd);
assert.match(registration, /const refreshBadgeNow = async \(\) => \{[\s\S]*?__tomatoUpdateReminderBadge\(\)[\s\S]*?findAndCreateDockBadge\(\)[\s\S]*?updateBadgeCount\(\)/, 'startup refresh must calculate, mount, then render the badge');
assert.match(registration, /window\.addEventListener\("tomato-reminder-badge-update"[\s\S]*?Promise\.resolve\(\)\.then\(refreshBadgeNow\)/, 'Dock registration must refresh once after the badge listener is installed');
assert.match(registration, /setInterval\(async \(\) => \{\s*await refreshBadgeNow\(\);\s*\}, 60000\);/, 'the single periodic badge refresh must run once per minute');
assert.doesNotMatch(tomatoSource, /setInterval\(async \(\) => \{\s*await updateReminderBadge\(\);\s*\}, 60000\);/, 'tomato runtime must not install a duplicate badge interval');
