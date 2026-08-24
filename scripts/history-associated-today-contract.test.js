'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

const helperStart = source.indexOf('    function formatDateKey(');
const helperEnd = source.indexOf('    // ========== 专注目标时间管理', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'history date helpers must remain extractable');

const context = vm.createContext({ Date, Math, String, Number, Set, Array });
vm.runInContext(`${source.slice(helperStart, helperEnd)}
this.getDateKey = getHistoryRecordDateKey;
this.getDateList = buildHistoryDateList;`, context);

assert.equal(context.getDateKey({
    taskBlockId: 'task-a',
    end: '2026-08-24T09:30:00.000Z',
}), '2026-08-24', 'associated records must derive a local date when date is absent');

assert.deepEqual(context.getDateList([
    { taskBlockId: 'task-a', date: '2026-08-24', durationSec: 1500 },
    { date: '2026-08-23', durationSec: 1500 },
    { taskBlockId: 'task-b', end: '2026-08-24T11:00:00.000Z', durationSec: 900 },
]), ['2026-08-24', '2026-08-23'],
    'today date tab input must include both associated and unassociated records');

const executorStart = source.indexOf('    const TransitionExecutor = {');
const executorEnd = source.indexOf('    // Compatibility boundary for legacy UI paths', executorStart);
assert.ok(executorStart >= 0 && executorEnd > executorStart, 'transition executor must remain extractable');
const executorBlock = source.slice(executorStart, executorEnd);
assert.match(executorBlock,
    /const effectOnly = !stateChanged && hasDrafts[\s\S]*command\?\.allowEffectOnly === true \|\| historyDrafts\.length > 0/,
    'history drafts must survive a terminal state no-op');

assert.match(source, /const dateList = buildHistoryDateList\(filteredRecords\)/,
    'history dialog must build date tabs from the normalized date helper');
assert.match(source, /historyState\.dateList = buildHistoryDateList\(historyState\.filteredRecords\)/,
    'history editor refresh must use the same date helper');

console.log('associated history today-tab contract tests passed');
