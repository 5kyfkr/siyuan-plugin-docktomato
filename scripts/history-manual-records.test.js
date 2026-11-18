'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tomato.js'), 'utf8');
const now = Date.parse('2026-11-17T14:00:00Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
let records = [], serial = Promise.resolve(), sequence = 0, timer = null, refreshes = 0;
const clone = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({
    Date: Clock, console, SyncManager: { getState: () => ({ activeTimer: timer }) },
    cloneSyncState: clone, createTomatoUuid: prefix => `${prefix}-${++sequence}`,
    hashHistoryText: value => value, assertHistoryRecordCount() {},
    normalizeLegacyDate: value => value, toDateSafe: value => new Clock(value),
    formatDateKey: value => new Clock(value).toISOString().slice(0, 10), getTimePeriod: () => 'afternoon',
    __tomatoHistoryRefreshUI: async () => { refreshes++; },
    mutateHistoryRecords: mutator => {
        const operation = serial.then(async () => {
            const draft = clone(records), result = await mutator(draft);
            if (result !== false) records = draft;
            return result;
        });
        serial = operation.catch(() => {});
        return operation;
    },
});
vm.runInContext(source.slice(source.indexOf('    function normalizeHistoryRecords('), source.indexOf('    function getHistoryRecordDurationMs(')), context);
vm.runInContext(source.slice(source.indexOf('    function __tomatoFindHistoryRecordIndex('), source.indexOf('    async function __tomatoHistoryLoadAll(')), context);
vm.runInContext(source.slice(source.indexOf('    function __tomatoHistoryAvailableParts('), source.indexOf('    async function __tomatoHistoryRefreshUI(')), context);
const time = value => `2026-11-17T${value}:00.000Z`;
const input = (start, end, extra = {}) => ({ start: time(start), end: time(end), mode: 'countdown', ...extra });
const minutes = list => list.reduce((sum, record) => sum + record.durationMin, 0);
const visible = () => records.filter(record => record.disposition !== 'discarded');
const record = (id, start, end, extra = {}) => {
    const item = { recordId:id, mode:'countdown', taskBlockId:'old-task', ...extra };
    context.updateHistoryRecordTimeFields(item, time(start), time(end));
    return clone(context.normalizeHistoryRecords([item])[0]);
};

(async () => {
    records = [
        record('focus', '10:00', '10:25'),
        record('break', '10:25', '10:30', { mode:'break' }),
    ];
    const initial = clone(records);
    const result = await context.__tomatoHistoryCreate(input('09:50', '10:50', { source: 'schedule', sourceScheduleId: 'schedule-1', taskBlockId: 'task-1' }));
    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1, 'conversion covers the entire selected interval');
    assert.equal(minutes(result.records), 60);
    assert.equal(visible().length, 1, 'fully covered focus and rest records are removed from display');
    assert.ok(records.filter(item => item.recordId === 'focus' || item.recordId === 'break').every(item => item.disposition === 'discarded'), 'tombstones prevent journal replay');
    assert.equal(result.records[0].taskBlockId, 'task-1');
    assert.equal(result.records[0].entrySource, 'schedule');
    assert.equal(result.records[0].isCompleted, false, 'manual records do not complete timer rounds');
    assert.equal(new Set(records.map(record => record.recordId)).size, records.length);
    const count = records.length;
    const repeated = await context.__tomatoHistoryCreate(input('09:50', '10:50', { source:'schedule', sourceScheduleId:'schedule-1', taskBlockId:'task-1' }));
    assert.equal(repeated.ok, true, 'repeating an unchanged conversion succeeds without duplicate records');
    assert.equal(repeated.undo, undefined);
    assert.equal(records.length, count);
    assert.equal((await context.__tomatoHistoryCreate(input('10:40', '11:00'))).error, 'OVERLAP');
    assert.equal(records.length, count, 'invalid manual append is atomic');
    assert.equal((await context.__tomatoHistoryCreate(input('13:00', '15:00'))).error, 'INVALID_TIME');
    assert.equal((await context.__tomatoHistoryCreate(input('13:00', '12:00'))).error, 'INVALID_TIME');
    assert.equal(await context.__tomatoHistoryUndo(result.undo), true);
    assert.deepEqual(records, initial, 'undo restores fully covered records and their metadata');
    for (const [start, end, expected] of [
        ['09:50', '10:20', [['10:20','11:00']]],
        ['10:40', '11:10', [['10:00','10:40']]],
        ['10:20', '10:40', [['10:00','10:20'],['10:40','11:00']]],
        ['10:00', '11:00', []],
    ]) {
        records = [record('original', '10:00', '11:00', {taskBlockName:'Original task', note:'keep metadata', sessionId:'session-1'})];
        const original = clone(records);
        const conversion = await context.__tomatoHistoryCreate(input(start, end, {source:'schedule', taskBlockId:'new-task'}));
        assert.equal(conversion.ok, true);
        const retained = visible().filter(item => item.taskBlockId === 'old-task').sort((a,b) => a.start.localeCompare(b.start));
        assert.deepEqual(retained.map(item => [item.start.slice(11,16),item.end.slice(11,16)]), expected, 'trim edges or split the original interval');
        if (retained.length) assert.equal(retained[0].recordId, 'original', 'first remainder preserves record identity');
        assert.ok(retained.every(item => item.taskBlockName === 'Original task' && item.note === 'keep metadata' && item.sessionId === 'session-1'));
        if (retained.length === 2) assert.notEqual(retained[1].recordId, retained[0].recordId, 'split remainder gets a unique ID');
        assert.equal(minutes(conversion.records), (Date.parse(time(end)) - Date.parse(time(start))) / 60000);
        assert.equal(await context.__tomatoHistoryUndo(conversion.undo), true);
        assert.deepEqual(records, original, 'one undo restores the original interval exactly');
    }
    records = [record('a','09:50','10:20'), record('b','10:20','10:40'), record('c','10:40','11:10'), record('unrelated','12:00','12:15')];
    const originalMany = clone(records);
    const spanning = await context.__tomatoHistoryCreate(input('10:00','11:00',{source:'schedule', taskBlockId:'new-task'}));
    assert.equal(spanning.ok, true);
    assert.deepEqual(visible().filter(item => item.taskBlockId === 'old-task').map(item => [item.start.slice(11,16),item.end.slice(11,16)]).sort(), [['09:50','10:00'],['11:00','11:10'],['12:00','12:15']]);
    const remainder = visible().find(item => item.recordId === 'a');
    const remainderEdit = await context.__tomatoHistoryUpdate(remainder, input('09:45','10:00'));
    assert.equal(remainderEdit.ok, true);
    assert.equal(await context.__tomatoHistoryUndo(spanning.undo), false, 'undo refuses a subsequently edited remainder');
    assert.equal(await context.__tomatoHistoryUndo(remainderEdit.undo), true);
    assert.equal(await context.__tomatoHistoryUndo(spanning.undo), true);
    assert.deepEqual(records.slice().sort((a,b) => a.recordId.localeCompare(b.recordId)), originalMany.slice().sort((a,b) => a.recordId.localeCompare(b.recordId)));
    records = initial;
    const duplicates = await Promise.all([context.__tomatoHistoryCreate(input('11:00', '11:30')), context.__tomatoHistoryCreate(input('11:00', '11:30'))]);
    assert.equal(duplicates.filter(value => value.ok).length, 1, 'serialized concurrent submissions recheck occupied time');
    const added = duplicates.find(value => value.ok).records[0];
    const changed = await context.__tomatoHistoryUpdate(added, input('11:10', '11:40'));
    assert.equal(changed.ok, true);
    assert.equal(changed.records[0].recordId, added.recordId, 'editing retains record identity');
    assert.equal(changed.records[0].durationMin, 30);
    assert.equal((await context.__tomatoHistoryUpdate(added, input('11:20', '11:50'))).error, 'STALE_RECORD');
    assert.equal(await context.__tomatoHistoryUndo(duplicates.find(value => value.ok).undo), false, 'undo refuses a subsequently edited record');
    assert.equal(await context.__tomatoHistoryUndo(changed.undo), true);
    const beforeMove = clone(records);
    const moved = await context.__tomatoHistoryUpdate(added, input('10:10','10:40'));
    assert.equal(moved.ok,true,'moving into other records automatically trims them');
    assert.equal(moved.records[0].recordId,added.recordId);
    assert.deepEqual(visible().map(item=>[item.start.slice(11,16),item.end.slice(11,16)]).sort(),[['10:00','10:10'],['10:10','10:40']]);
    assert.equal(await context.__tomatoHistoryUndo(moved.undo),true);
    assert.deepEqual(records.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)),beforeMove.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)),'undo restores the edited record and every displaced neighbour');
    const editFixture = clone(records);
    records = [record('existing-a','08:45','09:50'),record('existing-b','09:40','10:00')];
    const shrinkExisting = await context.__tomatoHistoryUpdate(clone(records[0]),input('08:50','09:45'));
    assert.equal(shrinkExisting.ok,true,'editing an existing overlap trims its neighbour');
    assert.equal(visible().find(item=>item.recordId==='existing-b').start,time('09:45'));
    const extended = await context.__tomatoHistoryUpdate(shrinkExisting.records[0],input('08:50','10:10'));
    assert.equal(extended.ok,true,'extending over a neighbour covers it');
    assert.equal(visible().length,1);
    assert.equal(await context.__tomatoHistoryUndo(extended.undo),true);
    assert.equal(await context.__tomatoHistoryUndo(shrinkExisting.undo),true,'undo restores the allowed pre-existing overlap');
    for (const [start,end,expected] of [
        ['09:50','10:20',[['10:20','11:00']]],
        ['10:40','11:10',[['10:00','10:40']]],
        ['10:20','10:40',[['10:00','10:20'],['10:40','11:00']]],
        ['10:00','11:00',[]],
    ]) {
        records=[record('editing','08:00','08:30',{taskBlockId:'edit-task'}),record('neighbour','10:00','11:00',{note:'keep',taskBlockId:'other-task',mode:'stopwatch'})];
        const original=clone(records);
        const adjusted=await context.__tomatoHistoryUpdate(clone(records[0]),input(start,end));
        assert.equal(adjusted.ok,true);
        assert.equal(adjusted.records[0].recordId,'editing','edited identity is retained');
        assert.deepEqual(visible().filter(item=>item.taskBlockId==='other-task').map(item=>[item.start.slice(11,16),item.end.slice(11,16)]),expected);
        assert.ok(visible().filter(item=>item.taskBlockId==='other-task').every(item=>item.note==='keep'&&item.mode==='stopwatch'),'untouched neighbour metadata is retained');
        assert.equal(await context.__tomatoHistoryUndo(adjusted.undo),true);
        assert.deepEqual(records.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)),original.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)));
    }
    records = editFixture;
    timer = { status: 'RUNNING', segmentStartMs: Date.parse(time('13:00')), openRecordId: 'live' };
    assert.equal((await context.__tomatoHistoryCreate(input('13:10', '13:30'))).ok, false, 'active timer time is reserved');
    assert.equal((await context.__tomatoHistoryCreate(input('13:10', '13:30', {source:'schedule'}))).error, 'ACTIVE_RECORD', 'conversion cannot replace the active timer');
    const editingPast=clone(records.find(item=>item.recordId===added.recordId));
    assert.equal((await context.__tomatoHistoryUpdate(editingPast,input('13:10','13:30'))).error,'ACTIVE_RECORD','record edits cannot displace the running timer');
    timer = null;
    records.push(record('pending','12:00','12:15',{disposition:'pending'}));
    const beforePending = clone(records);
    assert.equal((await context.__tomatoHistoryCreate(input('12:00','12:30',{source:'schedule'}))).error, 'ACTIVE_RECORD');
    assert.deepEqual(records, beforePending, 'pending journal writes are not overwritten');
    assert.equal((await context.__tomatoHistoryUpdate(editingPast,input('12:00','12:30'))).error,'ACTIVE_RECORD','record edits cannot displace pending journal writes');
    assert.deepEqual(records,beforePending);
    const crossing = await context.__tomatoHistoryCreate({ start: '2025-12-31T23:50:00Z', end: '2026-01-01T00:20:00Z' });
    assert.equal(crossing.ok, true, 'year boundary records use one atomic write');
    assert.equal(minutes(crossing.records), 30);
    const spanningYear = {recordId:'year-original', mode:'countdown', taskBlockId:'old-year-task'};
    context.updateHistoryRecordTimeFields(spanningYear, '2025-12-31T23:30:00Z', '2026-01-01T00:30:00Z');
    records = clone(context.normalizeHistoryRecords([spanningYear]));
    const originalYear = clone(records);
    const yearConversion = await context.__tomatoHistoryCreate({start:'2025-12-31T23:50:00Z',end:'2026-01-01T00:10:00Z',source:'schedule',taskBlockId:'new-year-task'});
    assert.equal(yearConversion.ok, true);
    assert.equal(visible().length, 3, 'conversion splits a record across the year boundary');
    assert.equal(minutes(visible()), 60, 'split durations account for the original full hour');
    assert.equal(await context.__tomatoHistoryUndo(yearConversion.undo), true);
    assert.deepEqual(records, originalYear, 'undo restores the original cross-year interval');
    records.push(record('editing-year','08:00','08:30'));
    const beforeYearEdit=clone(records);
    const yearEdit=await context.__tomatoHistoryUpdate(clone(records[1]),{start:'2025-12-31T23:50:00Z',end:'2026-01-01T00:10:00Z'});
    assert.equal(yearEdit.ok,true,'editing across years displaces records outside the original archive year');
    assert.equal(visible().length,3);
    assert.equal(await context.__tomatoHistoryUndo(yearEdit.undo),true);
    assert.deepEqual(records.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)),beforeYearEdit.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId)));
    assert.ok(refreshes >= 5);
    console.log('manual history create/update/undo tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
