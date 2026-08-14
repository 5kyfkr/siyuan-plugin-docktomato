'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('const __getReminderDialogDefaultStartDate =');
const end = source.indexOf('\n    function showReminderDialog', start);
assert.ok(start >= 0 && end > start, 'reminder dialog default-date helper must remain extractable');

const normalizeDateKey = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const part = (number) => String(number).padStart(2, '0');
        return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`;
    }
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};

const context = vm.createContext({
    Date,
    REMINDER_REPEAT_MODE_FOLLOW_TASK: 'followTaskRepeat',
    __normalizeReminderDateKey: normalizeDateKey,
    formatDateKey: normalizeDateKey,
});
vm.runInContext(`${source.slice(start, end)}\nthis.getDefaultStartDate = __getReminderDialogDefaultStartDate;`, context);

const now = new Date('2026-07-18T12:00:00');
const getDefault = context.getDefaultStartDate;

assert.equal(getDefault({ startDate: '2026-02-07' }, {}, 'followTaskRepeat', null, now), '2026-02-07', 'editing must preserve the saved reminder date');
assert.equal(getDefault({ startDate: '2026-02-07' }, { taskCompletionTime: '2026-07-20' }, 'followTaskRepeat', null, now), '2026-07-20', 'an existing follow reminder must display the current task due date');
assert.equal(getDefault(null, { taskCompletionTime: '2026-07-20', taskStartDate: '2026-08-01' }, 'followTaskRepeat', null, now), '2026-07-20', 'follow mode must use a current or future due date');
assert.equal(getDefault(null, { taskStartDate: '2026-08-01' }, 'followTaskRepeat', null, now), '2026-07-18', 'follow mode without a due date must use today, not the task start date');
assert.equal(getDefault(null, { taskCompletionTime: '2026-02-07', taskStartDate: '2026-08-01' }, 'followTaskRepeat', null, now), '2026-07-18', 'follow mode must not default to a past due date');
assert.equal(getDefault(null, { taskCompletionTime: '2026-07-20', taskStartDate: '2026-08-01' }, 'manual', null, now), '2026-07-18', 'independent mode must not inherit task dates');
assert.equal(getDefault(null, {}, 'manual', { startDateKey: '2026-07-22' }, now), '2026-07-22', 'independent mode may use a future semantic date');
assert.equal(getDefault(null, {}, 'manual', { startDateKey: '2026-02-07' }, now), '2026-07-18', 'independent mode must not default to a past semantic date');

const taskContextStart = source.indexOf('async function __getReminderTaskContext');
const taskContextEnd = source.indexOf('\n    async function resolveReminderTaskAttrContext', taskContextStart);
assert.ok(taskContextStart >= 0 && taskContextEnd > taskContextStart, 'task-context reader must remain extractable');
const taskContextBlock = source.slice(taskContextStart, taskContextEnd);
assert.match(taskContextBlock, /resolveReminderTaskAttrContext\(id\)[\s\S]*?readCanonicalTomatoTaskAttrs\(attrContext\)/, 'task context must resolve and read only the canonical attribute host');
