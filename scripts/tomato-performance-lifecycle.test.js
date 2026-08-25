'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tomatoSource = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');

assert.doesNotMatch(indexSource, /_dockBadgeRetryTimers/,
    'Dock badge retries must not accumulate timer IDs');
assert.match(indexSource, /_dockBadgeRetryTimer = null;[\s\S]*const scheduleDockBadgeRetry = \(delay = 5000\)/,
    'Dock badge recovery must use one owned retry timer');

const waitStart = tomatoSource.indexOf('    function whenElementExist(');
const waitEnd = tomatoSource.indexOf('    // \u83b7\u53d6\u9009\u4e2d\u7684\u5757', waitStart);
assert.ok(waitStart >= 0 && waitEnd > waitStart, 'DOM wait helper must remain extractable');
const waitBlock = tomatoSource.slice(waitStart, waitEnd);
assert.match(waitBlock, /new MutationObserver/,
    'DOM wait helper must react to mutations');
assert.doesNotMatch(waitBlock, /requestAnimationFrame/,
    'DOM wait helper must not poll every animation frame');
assert.match(waitBlock, /observer\?\.disconnect\?\.\(\)/,
    'DOM wait helper must disconnect after success or timeout');

const badgeStart = tomatoSource.indexOf('    async function updateReminderBadge(');
const badgeEnd = tomatoSource.indexOf('    // \u8bb0\u5f55\u4e0a\u6b21\u68c0\u67e5\u8fc7\u671f\u63d0\u9192', badgeStart);
assert.ok(badgeStart >= 0 && badgeEnd > badgeStart, 'badge updater must remain extractable');
const badgeBlock = tomatoSource.slice(badgeStart, badgeEnd);
assert.equal((badgeBlock.match(/queryAllReminderBlocks\(/g) || []).length, 1,
    'one badge refresh must query reminders once');
assert.match(badgeBlock, /countTodayRemindersFromList\(reminders, now\)[\s\S]*countExpiredRemindersFromList\(reminders, now\)/,
    'badge counts must share the same reminder snapshot');

const queryStart = tomatoSource.indexOf('    async function queryAllReminderBlocks(');
const queryEnd = tomatoSource.indexOf('    const __getReminderDockMeta', queryStart);
assert.ok(queryStart >= 0 && queryEnd > queryStart, 'reminder query must remain extractable');
const queryBlock = tomatoSource.slice(queryStart, queryEnd);
assert.match(queryBlock, /if \(forceRefresh \|\| queryOptions\.flush === true\) await flushReminderTransaction\(\);/,
    'only explicit or force-refresh reads may flush SQLite');
assert.doesNotMatch(queryBlock, /try \{ await postJSON\('\/api\/sqlite\/flushTransaction'/,
    'ordinary reminder reads must not flush SQLite unconditionally');

const cleanupStart = tomatoSource.indexOf('    const cleanupTomato = () => {');
const cleanupEnd = tomatoSource.indexOf('    globalThis.__TomatoTimerCleanup', cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'plugin cleanup must remain extractable');
const cleanupBlock = tomatoSource.slice(cleanupStart, cleanupEnd);
for (const cleanupCall of [
    'uninstallReminderTaskAttrSync()',
    '__disposeReminderDockRuntime()',
    'revokeRoutineIconObjectUrls()',
]) {
    assert.ok(cleanupBlock.includes(cleanupCall), `cleanup must call ${cleanupCall}`);
}
assert.match(cleanupBlock, /clearInterval\(expiredReminderCheckInterval\)/,
    'cleanup must stop the expired-reminder interval');
assert.match(tomatoSource, /removeEventListener\('tm-task-attr-updated', __reminderTaskAttrSyncHandler\)/,
    'task reminder listener must be removable');
assert.match(tomatoSource, /__reminderDockBodyObserver\?\.disconnect\?\.\(\)/,
    'reminder Dock body observer must be disconnected');

const iconStart = tomatoSource.indexOf('    function updateTaskBlockIcon()');
const iconEnd = tomatoSource.indexOf('    // ========== \u6570\u636e\u5e93\u70b9\u51fb\u8ffd\u8e2a', iconStart);
assert.ok(iconStart >= 0 && iconEnd > iconStart, 'task icon updater must remain extractable');
const iconBlock = tomatoSource.slice(iconStart, iconEnd);
assert.equal((iconBlock.match(/applyFocusMode\(false\)/g) || []).length, 1,
    'task icon cleanup must exit focus mode once');
assert.equal((iconBlock.match(/applyDatabaseFocusMode\(false\)/g) || []).length, 1,
    'task icon cleanup must exit database focus mode once');
assert.match(tomatoSource, /function updateDisplay\(animateProgress = true\)[\s\S]*updateProgressBar\(animateProgress\);/,
    'display rendering must own the progress update animation mode');
assert.match(tomatoSource, /function ensureDesktopTimerBackgroundThrottlingDisabled\(reason = ''\)[\s\S]*webContents\.setBackgroundThrottling\(false\)/,
    'desktop timer renderer must disable Electron background timer throttling');
assert.match(tomatoSource, /function startLocalTimerLoop\(\)[\s\S]*ensureDesktopTimerBackgroundThrottlingDisabled\('start-local-timer-loop'\)/,
    'every local timer loop must restore the background timer guarantee');
assert.match(tomatoSource, /contextIsolation: false,\s*backgroundThrottling: false/,
    'detached timer window must not be background-throttled');

console.log('tomato performance lifecycle contract tests passed');
