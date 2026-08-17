'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tomato.js'), 'utf8');
const start = source.indexOf('function showExpiredRemindersNotification(expiredEntries)');
const end = source.indexOf('let expiredReminderNotificationTimer', start);

assert.ok(start >= 0 && end > start, 'expired reminder notification block must remain extractable');
const block = source.slice(start, end);

assert.match(block, /\.tomy-expired-notification \{[\s\S]*?cursor: pointer;/, 'the full reminder notification must present a clickable affordance');
assert.match(block, /const stopAutoClose = \(\) => \{[\s\S]*?clearTimeout\(autoCloseTimer\)/, 'interacting with the reminder must cancel automatic dismissal');
assert.match(block, /const dismissNotification = \(\) => \{[\s\S]*?stopAutoClose\(\)[\s\S]*?closeExpiredNotification\(notification\)/, 'click dismissal must cancel the automatic close timer');
assert.match(block, /notification\.addEventListener\('click', dismissNotification, \{ once: true \}\)/, 'clicking anywhere on the reminder notification must dismiss it once');
assert.match(block, /autoCloseTimer = setTimeout\([\s\S]*?closeExpiredNotification\(notification\)[\s\S]*?5000\)/, 'automatic dismissal must remain available');
assert.match(block, /\.tomy-expired-item-name \{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-word;/, 'long reminder names must wrap even when they contain no spaces');
assert.match(block, /\.tomy-expired-notification \{[\s\S]*?padding: 8px 12px;[\s\S]*?grid-template-columns: 22px minmax\(0, 1fr\);[\s\S]*?column-gap: 8px;/, 'the expired notification shell must stay compact');
assert.match(block, /\.tomy-notification-content \{[\s\S]*?display: contents;/, 'the header wrapper must not reserve an empty icon column beside the reminder list');
assert.match(block, /\.tomy-expired-list \{[\s\S]*?grid-column: 1 \/ -1;/, 'the reminder list must span the full notification width without a left gutter');
assert.match(block, /\.tomy-expired-item \{[\s\S]*?padding: 4px 0;[\s\S]*?grid-template-columns: 70px minmax\(0, 1fr\) 26px;[\s\S]*?gap: 8px;/, 'the expired item must follow the Dock time-rail, task, action layout');
assert.match(block, /\.tomy-expired-item-name \{[\s\S]*?font-size: 14px;/, 'the task name must remain prominent in the compact layout');
assert.match(block, /\.tomy-notification-close \{[\s\S]*?position: absolute;/, 'the close action must not reserve an empty column beside every reminder');
assert.match(block, /occurrenceTime\.textContent = entry\.timeKey;[\s\S]*?occurrenceDate\.textContent = entry\.dateKey;/, 'each expired reminder must visibly render its concrete occurrence date and time');
assert.match(block, /__setReminderDockIcon\(notificationIcon, 'alarm'\)/, 'the notification header must reuse the Dock alarm icon language');
assert.match(block, /completeBtn\.onclick = async \(event\) => \{[\s\S]*?event\.stopPropagation\(\)[\s\S]*?stopAutoClose\(\)/, 'completion must not bubble into notification dismissal and must stop the timer');
assert.match(block, /__markReminderOccurrenceCompleted\(entry\.blockId, entry\.dateKey, entry\.timeKey,[\s\S]*?docktomato-expired-notification/, 'completion must preserve and submit the exact reminder occurrence identity');
assert.match(block, /if \(!ok\) \{[\s\S]*?completeBtn\.disabled = false[\s\S]*?showMiniToast\('标记失败'\)[\s\S]*?return;/, 'a failed completion must restore the button without closing the notification');
assert.match(block, /pendingEntries = pendingEntries\.filter\(item => item !== entry\)[\s\S]*?pendingEntries\.length === 0[\s\S]*?dismissNotification\(\)[\s\S]*?renderItems\(\)/, 'a successful completion must remove only its item and keep rendering remaining reminders');

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.className = '';
        this.textContent = '';
        this.disabled = false;
        this.listeners = {};
    }

    set innerHTML(value) {
        this.children = [];
        if (!String(value).includes('tomy-expired-list')) return;
        const count = new FakeElement('span');
        count.setAttribute('data-role', 'expired-count');
        const list = new FakeElement('div');
        list.className = 'tomy-expired-list';
        this.appendChild(count);
        this.appendChild(list);
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
        children.forEach(child => this.appendChild(child));
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    addEventListener(name, handler) {
        this.listeners[name] = handler;
    }

    matches(selector) {
        if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
        const attrMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
        return !!(attrMatch && this.attributes[attrMatch[1]] === attrMatch[2]);
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        for (const child of this.children) {
            if (child.matches(selector)) matches.push(child);
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }
}

(async () => {
    const body = new FakeElement('body');
    const document = {
        body,
        head: new FakeElement('head'),
        createElement: tagName => new FakeElement(tagName),
        getElementById: id => id === 'tomy-expired-notification-styles' ? {} : null,
        querySelector: selector => body.querySelector(selector),
    };
    const completionCalls = [];
    const toasts = [];
    let shouldComplete = false;
    const context = vm.createContext({
        Date,
        document,
        clearTimeout() {},
        setTimeout: () => 1,
        toDateSafe: value => value instanceof Date ? value : new Date(value),
        formatDateKey: value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
        closeExpiredNotification: notification => notification.remove(),
        showMiniToast: message => toasts.push(message),
        __setReminderDockIcon: target => { target.textContent = '✓'; },
        __markReminderOccurrenceCompleted: async (...args) => {
            completionCalls.push(args);
            return shouldComplete;
        },
    });
    vm.runInContext(`${block}\nthis.showExpired = showExpiredRemindersNotification;`, context);

    const longTaskName = '提醒已过期通知增加具体发生时间及完成按钮'.repeat(8) + ' https://example.com/a/very/long/unbroken/path';
    context.showExpired([
        { reminder: { blockId: 'task-a', blockName: longTaskName }, at: new Date(2026, 7, 16, 9, 5) },
        { reminder: { blockId: 'task-b', blockName: '任务 B' }, at: new Date(2026, 7, 16, 10, 30) },
    ]);
    const notification = body.querySelector('.tomy-expired-notification');
    assert.ok(notification, 'expired notification must be mounted');
    const list = notification.querySelector('.tomy-expired-list');
    assert.equal(list.querySelectorAll('.tomy-expired-item').length, 2, 'all pending reminders must remain visible');
    assert.equal(list.querySelector('.tomy-expired-item-name').textContent, longTaskName, 'long CJK and URL task names must not be truncated in JavaScript');
    assert.equal(list.querySelector('.tomy-expired-time-main').textContent, '09:05', 'the concrete occurrence time must be visible in the time rail');
    assert.equal(list.querySelector('.tomy-expired-time-date').textContent, '2026-08-16', 'the concrete occurrence date must be visible in the time rail');

    let stopped = false;
    const firstButton = list.querySelector('.tomy-expired-complete');
    await firstButton.onclick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true, 'the completion click must stop notification dismissal');
    assert.equal(list.querySelectorAll('.tomy-expired-item').length, 2, 'a failed completion must retain every reminder');
    assert.equal(firstButton.disabled, false, 'a failed completion must restore the button');
    assert.equal(toasts.at(-1), '标记失败');

    shouldComplete = true;
    await firstButton.onclick({ stopPropagation() {} });
    assert.equal(list.querySelectorAll('.tomy-expired-item').length, 1, 'a successful completion must remove only its reminder');
    assert.deepEqual(completionCalls[1].slice(0, 3), ['task-a', '2026-08-16', '09:05']);
    assert.ok(body.querySelector('.tomy-expired-notification'), 'the notification must stay open while reminders remain');

    const remainingButton = list.querySelector('.tomy-expired-complete');
    await remainingButton.onclick({ stopPropagation() {} });
    assert.equal(body.querySelector('.tomy-expired-notification'), null, 'the notification must close after the final completion');

    console.log('reminder popup click-dismiss tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
