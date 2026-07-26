'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tomato.js'), 'utf8');

function loadHelpers() {
    const start = source.indexOf('function stableWechatReminderHash(');
    const end = source.indexOf('async function reconcileWechatReminders(', start);
    assert.ok(start >= 0 && end > start, 'wechat helper block must remain extractable');
    const context = {
        Array,
        Date,
        Map,
        Math,
        Number,
        Object,
        String,
        REMINDER_DEVICE_SCHEDULE_MAX_OCCURRENCES: 64,
        REMINDER_DEVICE_SCHEDULE_WINDOW_DAYS: 7,
        reminderSettings: { enabled: false, wechatEnabled: false },
        __collectReminderScheduleTargets: () => [],
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.__test = { stableWechatReminderHash, buildWechatReminderTarget, limitWechatReminderContent, collectWechatTargets, diffWechatReminderTargets, mergeWechatReminderTargetsIntoRegistry, shouldDeferWechatReconcileUntilRegistryLoaded, setScheduleTargetCollector: (collector) => { globalThis.__collectReminderScheduleTargets = collector; } };`, context);
    return context.__test;
}

function run() {
    const helpers = loadHelpers();
    const atMs = Date.now() + 60 * 60 * 1000;
    const first = helpers.buildWechatReminderTarget('dock-tomato', 'task:a:1', atMs, '任务提醒：测试');
    const same = helpers.buildWechatReminderTarget('dock-tomato', 'task:a:1', atMs, '任务提醒：测试');
    const other = helpers.buildWechatReminderTarget('task-horizon', 'task:a:1', atMs, '任务提醒：测试');

    assert.match(first.dataId, /^\d{14}-[a-z0-9]{7}$/);
    assert.equal(first.dataId, same.dataId, 'same occurrence must keep a stable cloud id');
    assert.notEqual(first.dataId, other.dataId, 'plugin namespaces must not collide');
    assert.equal(Array.from(helpers.limitWechatReminderContent('测'.repeat(140))).length, 128);

    const current = { [first.dataId]: first };
    const unchanged = helpers.diffWechatReminderTargets(current, new Map([[first.dataId, first]]));
    assert.equal(unchanged.removals.length, 0);
    assert.equal(unchanged.upserts.length, 0);
    const changed = { ...first, content: '任务提醒：已修改', fingerprint: helpers.stableWechatReminderHash('changed') };
    assert.equal(helpers.diffWechatReminderTargets(current, new Map([[changed.dataId, changed]])).upserts.length, 1);
    assert.equal(helpers.diffWechatReminderTargets(current, new Map()).removals.length, 1);

    const now = Date.now();
    helpers.setScheduleTargetCollector(() => [
        { occurrenceKey: 'within', atMs: now + 60 * 60 * 1000 },
        { occurrenceKey: 'outside', atMs: now + 8 * 86400000 },
    ]);
    const reminders = [{ blockId: 'task-a', blockName: '待取消任务', enabled: true }];
    assert.equal(helpers.collectWechatTargets(reminders).size, 0, 'disabled periodic collection must be empty');
    const forcedTargets = helpers.collectWechatTargets(reminders, { force: true });
    assert.equal(forcedTargets.size, 1, 'explicit disable must recover only targets inside the 7-day window');
    const forcedRegistry = helpers.mergeWechatReminderTargetsIntoRegistry({}, forcedTargets);
    const disableDiff = helpers.diffWechatReminderTargets(forcedRegistry, new Map());
    assert.equal(disableDiff.removals.length, 1, 'explicit disable must cancel recovered current targets');
    assert.equal(disableDiff.upserts.length, 0);
    assert.equal(helpers.shouldDeferWechatReconcileUntilRegistryLoaded('startup', false), true, 'startup must wait for the synced registry snapshot');
    assert.equal(helpers.shouldDeferWechatReconcileUntilRegistryLoaded('sync-end', false), true, 'sync-end must not bulk-register when the snapshot is still unavailable');
    assert.equal(helpers.shouldDeferWechatReconcileUntilRegistryLoaded('settings-enable', false), false, 'explicit enable may bootstrap the registry');
    assert.equal(helpers.shouldDeferWechatReconcileUntilRegistryLoaded('startup', true), false, 'startup may diff once a durable snapshot exists');

    assert.match(source, /\/api\/cloud\/setCloudReminder/);
    assert.match(source, /REMINDER_DEVICE_SCHEDULE_WINDOW_DAYS\s*=\s*7/);
    assert.match(source, /wechatEnabled:\s*false/);
    assert.match(source, /eventSource === 'task-horizon-agent-reminder'[\s\S]*?'agent-reminder'/, 'Agent reminder writes must request interactive WeChat reconciliation');
    assert.match(source, /settings\|manual\|enable\|disable\|agent-reminder/, 'Agent reconciliation must report WeChat registration results');
    const deviceSyncStart = source.indexOf('async function __syncReminderDeviceScheduleOnce');
    const deviceSyncEnd = source.indexOf('\n    async function __syncReminderDeviceSchedule(', deviceSyncStart);
    const deviceSyncBlock = source.slice(deviceSyncStart, deviceSyncEnd);
    assert.match(deviceSyncBlock, /skipWechatReconcile:\s*true/, 'device-only schedule metadata must not trigger WeChat reconciliation');
    assert.match(deviceSyncBlock, /skipReminderUpdatedEvent:\s*true/, 'device-only schedule metadata must not dirty ICS publication');
    assert.match(deviceSyncBlock, /skipTaskAttrUpdatedEvent:\s*true/, 'device-only schedule metadata must not re-enter the business reminder listener');
}

run();
