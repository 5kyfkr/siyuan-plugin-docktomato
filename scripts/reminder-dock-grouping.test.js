'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const renderStart = source.indexOf('async function __renderReminderDockListNow');
const renderEnd = source.indexOf('\n    async function renderReminderDockList', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, 'reminder dock renderer must remain extractable');
const renderBlock = source.slice(renderStart, renderEnd);

assert.match(source, /const __reminderDockCollapsedGroups = new Set\(\);/,
    'unfinished reminder groups, including later, must start expanded');
assert.doesNotMatch(source, /const __reminderDockCollapsedGroups = new Set\(\['later'\]\);/,
    'the later group must not be collapsed by default');
assert.match(renderBlock, /viewOptions = \[\{ key: 'unfinished'[\s\S]*\{ key: 'completed'/,
    'dock must keep only unfinished and completed views');
assert.doesNotMatch(renderBlock, /key: 'expired'/,
    'expired reminders must be a time group instead of a separate view');
assert.match(renderBlock, /key: 'overdue'[\s\S]*key: 'today'[\s\S]*key: 'tomorrow'[\s\S]*key: 'week'[\s\S]*key: 'later'/,
    'unfinished reminders must render in the approved time-group order');
assert.match(renderBlock, /entryYear > now\.getFullYear\(\)[\s\S]*`year-\$\{entryYear\}`/,
    'reminders beyond the current year must leave the later group');
assert.match(renderBlock, /futureYearDefinitions[\s\S]*sort\(\(a, b\) => a - b\)[\s\S]*label: `\$\{year\}年`/,
    'future years must render as ascending dynamic groups');
assert.match(renderBlock, /key: 'later', label: '更晚', detail: '到12月31日'/,
    'the later group must clearly stop at the end of the current year');
assert.match(renderBlock, /completedRecentStart = new Date\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\) - 7\)/,
    'completed reminders must use a seven-day calendar boundary');
assert.match(renderBlock, /key: 'completed-today', label: '今天'[\s\S]*key: 'completed-recent', label: '近7天'[\s\S]*key: 'completed-older', label: '7天前'/,
    'completed reminders must render in today, recent seven days, and older group order');
assert.match(renderBlock, /groupedCompletedEntries[\s\S]*tomato-reminder-group-toggle[\s\S]*tomato-reminder-group-content/,
    'completed reminders must use the same collapsible group structure');
assert.match(renderBlock, /expiredBlockIds\.has\(blockId\)/,
    'an overdue recurring reminder must not also appear as a future pending row');
assert.match(renderBlock, /__assignReminderDockUnfinishedRenderKeys\(entries\)/,
    'all unfinished time groups must receive collision-safe Dock render keys');
assert.match(renderBlock, /createBadge\(repeatLabel, 'repeat'\)/,
    'recurring reminders must expose a repeat badge');
assert.match(renderBlock, /createBadge\('跟随', 'follow'\)/,
    'task-following reminders must expose an independent follow badge');
assert.match(renderBlock, /date\.getFullYear\(\) !== now\.getFullYear\(\)[\s\S]*date\.getMonth\(\) \+ 1\}月\$\{date\.getDate\(\)\}日/,
    'next reminders in the current year must use the compact Chinese month-day format');
assert.match(renderBlock, /`下次 \$\{formatDockNextDateTime\(nextAt\)\}/,
    'dock next-time copy must use the compact formatter');
assert.match(renderBlock, /nextText\.title = nextText\.textContent/,
    'truncated next-time text must expose its full value as a hover tooltip');
assert.match(renderBlock, /__openReminderDockActionMenu\(refs\.moreBtn/,
    'edit and delete actions must be placed in the overflow menu');
const nameNavigationHandlers = renderBlock.match(/refs\.name\.onclick = \(event\) => \{[\s\S]*?navigateToBlock\(reminder\.blockId\);[\s\S]*?\};/g) || [];
assert.equal(nameNavigationHandlers.length, 2,
    'unfinished and completed task names must be the only document navigation targets');
const rowEditHandlers = renderBlock.match(/item\.onclick = \(event\) => \{[\s\S]*?editReminder\(\);[\s\S]*?\};/g) || [];
assert.equal(rowEditHandlers.length, 2,
    'unfinished and completed row clicks must open reminder editing');
assert.match(source, /phosphor-icons-core-2\.1\.1\/assets\/bold/,
    'dock icons must document their Phosphor Bold source');
assert.match(renderBlock, /__createReminderDockIcon\('chevron', 'tomato-reminder-group-chevron'\)/,
    'group disclosure controls must use a consistently sized Phosphor icon');
assert.doesNotMatch(renderBlock, /textContent\s*=\s*['"](?:↻|⚙|✓|•••|⌄|▯|↶)['"]/,
    'dock controls must not fall back to font-dependent Unicode glyphs');

const styleStart = source.indexOf('function ensureReminderDockStyles');
const styleEnd = source.indexOf('\n    let __reminderDockActionMenu', styleStart);
const styleBlock = source.slice(styleStart, styleEnd);
assert.match(styleBlock, /grid-template-columns:\s*48px minmax\(0, 1fr\) auto/,
    'all dock widths must retain the left time rail');
assert.match(styleBlock, /\.tomato-reminder-task-name\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?max-width:\s*100%/,
    'document navigation hit area must stop at the visible task-name text');
assert.doesNotMatch(styleBlock, /font-family\s*:/,
    'the dock must inherit SiYuan font settings instead of overriding typography');
assert.doesNotMatch(styleBlock, /@container|@media\s*\([^)]*width/,
    'the resizable dock must not switch to a second width-specific row layout');

const expiredStart = source.indexOf('function __collectExpiredReminderEntries');
const expiredEnd = source.indexOf('\n    /**', expiredStart);
assert.ok(expiredStart >= 0 && expiredEnd > expiredStart, 'expired reminder collector must remain extractable');
const expiredBlock = source.slice(expiredStart, expiredEnd);
assert.doesNotMatch(expiredBlock, /const seen = new Set|seen\.has\(/,
    'the expired collector must not merge reminders that share a storage host');

const expiredContext = vm.createContext({
    Date,
    toDateSafe: value => value instanceof Date ? value : new Date(value),
    __getLastDueReminderDateTime: reminder => new Date(reminder.dueAt),
    getNextReminderDateTime: () => null,
});
vm.runInContext(`${expiredBlock}\nthis.collectExpired = __collectExpiredReminderEntries;`, expiredContext);
const sameDayEntries = expiredContext.collectExpired([
    { blockId: 'shared-host', blockName: '同日任务 A', enabled: true, dueAt: '2026-08-16T09:00:00' },
    { blockId: 'shared-host', blockName: '同日任务 B', enabled: true, dueAt: '2026-08-16T09:00:00' },
], new Date('2026-08-17T12:00:00'));
assert.equal(sameDayEntries.length, 2, 'same-day same-time reminders must all remain in the overdue group');
assert.deepEqual(Array.from(sameDayEntries, entry => entry.reminder.blockName), ['同日任务 A', '同日任务 B']);

const keyStart = source.indexOf('const __assignReminderDockUnfinishedRenderKeys =');
const keyEnd = source.indexOf('\n    // 尝试通过 eventBus', keyStart);
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'unfinished reminder render-key helper must remain extractable');
const keyContext = vm.createContext({
    Map,
    String,
    Array,
    formatDateKey: value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
});
vm.runInContext(`${source.slice(keyStart, keyEnd)}\nthis.assignKeys = __assignReminderDockUnfinishedRenderKeys;`, keyContext);
const futureEntries = [
    { kind: 'pending', groupKey: 'tomorrow', reminder: { blockId: 'shared-host', blockName: '明天任务 A' }, at: new Date(2026, 7, 18, 9, 0) },
    { kind: 'pending', groupKey: 'tomorrow', reminder: { blockId: 'shared-host', blockName: '明天任务 B' }, at: new Date(2026, 7, 18, 9, 0) },
    { kind: 'pending', groupKey: 'week', reminder: { blockId: 'task-c', blockName: '本周任务 C' }, at: new Date(2026, 7, 20, 9, 0) },
    { kind: 'pending', groupKey: 'week', reminder: { blockId: 'task-d', blockName: '本周任务 D' }, at: new Date(2026, 7, 20, 9, 0) },
];
const futureKeys = Array.from(keyContext.assignKeys(futureEntries));
assert.equal(new Set(futureKeys).size, 4, 'tomorrow and week groups must keep every same-date same-time reminder row');

console.log('reminder dock grouping tests passed');
