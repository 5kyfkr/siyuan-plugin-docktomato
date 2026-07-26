'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('function showExpiredRemindersNotification(expiredItems)');
const end = source.indexOf('let expiredReminderNotificationTimer', start);

assert.ok(start >= 0 && end > start, 'expired reminder notification block must remain extractable');
const block = source.slice(start, end);

assert.match(block, /\.tomy-expired-notification \{[\s\S]*?cursor: pointer;/, 'the full reminder notification must present a clickable affordance');
assert.match(block, /const dismissNotification = \(\) => \{[\s\S]*?clearTimeout\(autoCloseTimer\)[\s\S]*?closeExpiredNotification\(notification\)/, 'click dismissal must cancel the automatic close timer');
assert.match(block, /notification\.addEventListener\('click', dismissNotification, \{ once: true \}\)/, 'clicking anywhere on the reminder notification must dismiss it once');
assert.match(block, /autoCloseTimer = setTimeout\([\s\S]*?closeExpiredNotification\(notification\)[\s\S]*?5000\)/, 'automatic dismissal must remain available');

console.log('reminder popup click-dismiss tests passed');
