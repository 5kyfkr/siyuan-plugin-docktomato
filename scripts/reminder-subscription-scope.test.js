'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.resolve(__dirname, '../tomato.js'), 'utf8');
const start = source.indexOf('    const __listReminderOccurrencesForSubscription =');
const end = source.indexOf('    const __getLastDueReminderDateTime', start);
const at = Date.UTC(2026, 9, 18, 9);
function fixture() {
    const queries = [], expanded = [];
    const context = vm.createContext({ Date, Set, Map,
        queryAllReminderBlocks: async (force, options) => { queries.push(options); return [
            { blockId: 'outside', rootId: 'outside-doc', enabled: true },
            { blockId: 'selected', rootId: 'selected-doc', enabled: true },
        ]; },
        __parseReminderTaskRepeatRule: () => null, __getReminderRepeatMode: () => 'manual',
        REMINDER_REPEAT_MODE_FOLLOW_TASK: 'follow-task',
        getNextReminderDateTime: (reminder, cursor) => {
            expanded.push(reminder.blockId);
            return new Date(cursor.getTime() < at ? at : at + 86400000);
        },
        formatDateKey: date => date.toISOString().slice(0, 10),
        __reminderOccurrenceKey: (date, time) => `${date}:${time}`,
    });
    vm.runInContext(source.slice(start, end) + '\nthis.list = __listReminderOccurrencesForSubscription;', context);
    return { context, queries, expanded };
}
test('scope is applied before reminder expansion and limits, with document metadata returned', async () => {
    const h = fixture();
    const result = await h.context.list({ startAt: at - 1, endAt: at + 60000, limit: 1, docIds: ['selected-doc'] });
    assert.deepEqual(Array.from(h.queries[0].docIds), ['selected-doc']);
    assert.deepEqual(h.expanded, ['selected', 'selected']);
    assert.equal(result.truncated, false);
    assert.equal(result.occurrences[0].docId, 'selected-doc');
    assert.equal(result.occurrences[0].blockId, 'selected');
});
test('empty scope does not query reminders, while an omitted scope retains all reminders', async () => {
    const h = fixture();
    assert.equal((await h.context.list({ startAt: at - 1, endAt: at + 60000, docIds: [] })).occurrences.length, 0);
    assert.equal(h.queries.length, 0);
    assert.equal((await h.context.list({ startAt: at - 1, endAt: at + 60000 })).occurrences.length, 2);
    assert.equal(h.queries[0].docIds, undefined);
});
test('reminder SQL restricts source documents before its row limit', async () => {
    const from = source.indexOf('    async function queryAllReminderBlocks(');
    const to = source.indexOf('    const __getReminderDockMeta =', from);
    const queries = [];
    const context = vm.createContext({
        TASK_START_DATE_ATTR: 'start', TASK_COMPLETION_TIME_ATTR: 'end', TASK_REPEAT_RULE_ATTR: 'repeat', TASK_REPEAT_STATE_ATTR: 'state',
        Logger: { warn() {} },
        postJSON: async (endpoint, body) => { queries.push(body.stmt); return { ok: true, data: { code: 0, data: [] } }; },
    });
    vm.runInContext(source.slice(from, to), context);
    await context.queryAllReminderBlocks(false, { docIds: ["doc'quoted"], limit: 1, throwOnError: true });
    assert.match(queries[0], /AND b\.root_id IN \('doc''quoted'\)[\s\S]*ORDER BY[\s\S]*LIMIT 2/);
    await context.queryAllReminderBlocks(false, { docIds: [] });
    assert.equal(queries.length, 1);
});

test('future check-ins do not consume subscription limits or hide independent future reminders', async () => {
    const h = fixture();
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-10-18T12:00:00'])); }
        static [Symbol.hasInstance](value) { return value instanceof Date; }
    }
    const future = new Date('2026-10-19T09:00:00').getTime();
    const rule = { enabled: true, type: 'daily', trigger: 'checkin' };
    Object.assign(h.context, {
        Date: Clock,
        __parseReminderTaskRepeatRule: value => value,
        __getReminderRepeatMode: reminder => reminder.repeatMode,
        __getReminderCompletedSet: () => new Set(),
        __getReminderCompletedOccurrences: () => [],
        __getReminderExcludedSet: () => new Set(),
        queryAllReminderBlocks: async () => [
            { blockId: 'habit', enabled: true, repeatMode: 'follow-task', taskRepeatRule: rule },
            { blockId: 'independent', enabled: true, repeatMode: 'manual', taskRepeatRule: rule },
        ],
        getNextReminderDateTime: (reminder, cursor) => cursor.getTime() < future ? new Date(future) : null,
    });
    const result = await h.context.list({ startAt: new Date('2026-10-18T00:00:00').getTime(), endAt: new Date('2026-10-20T00:00:00').getTime(), limit: 1 });
    assert.equal(result.truncated, false);
    assert.deepEqual(Array.from(result.occurrences, occurrence => occurrence.blockId), ['independent']);
});
