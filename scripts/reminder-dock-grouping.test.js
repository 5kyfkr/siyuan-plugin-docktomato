'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

console.log('reminder dock grouping tests passed');
