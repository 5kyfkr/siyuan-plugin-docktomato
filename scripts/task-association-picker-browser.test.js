'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(require.resolve('../tomato.js'), 'utf8');
let runtime = source.replace('injectInitTimeout = setTimeout(inject, 1000);', 'injectInitTimeout = null;');
const end = runtime.lastIndexOf('})();');
runtime = runtime.slice(0, end) + `
    globalThis.menuTest = { open: () => showContextMenu(20, 700),
        mountStatusBar: () => {
            const bar = document.createElement('div');
            bar.className = 'status';
            bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0';
            document.body.appendChild(bar);
            createWidget(bar);
            updateTaskBlockIcon();
        },
        start: () => { isRunning = true; currentSessionId = 'new-session'; },
        linked: () => currentTaskBlockId };
    setTaskAssociation = async (id, title) => {
        if (window.failAssociation) return false;
        currentTaskBlockId = id;
        currentTaskBlockName = title;
        return true;
    };
` + runtime.slice(end);

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const width of [320, 1100]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('https://timer.test/**', route => route.fulfill({ contentType: 'text/html', body: '<style>body{font:14px system-ui;--b3-theme-background:#fff;--b3-theme-primary:#3574bd;--b3-theme-surface:#f3f4f6;--b3-theme-surface-light:#e7e9ed;--b3-theme-on-background:#222;--b3-theme-on-surface-light:#666}</style>' }));
            await page.goto('https://timer.test');
            await page.addScriptTag({ path: require.resolve('../i18n/runtime.js') });
            await page.evaluate(({ messages, width }) => {
                window.__dockTomatoI18n = __dockTomatoI18nRuntime.createI18n(messages, { preference: 'en' });
                window.siyuan = { config: { appearance: { lang: 'en' }, system: { container: width === 320 ? 'android' : 'windows' } } };
                window.fetch = async () => ({ ok: true, text: async () => '', json: async () => ({ code: 0, data: [] }) });
                const items = [
                    { id: 'a', title: 'Prepare release', docName: 'Project notebook', done: true },
                    ...Array.from({ length: 4 }, (_, index) => ({ id: `done-${index}`, title: `Completed task ${index}`, docName: 'Archive', done: true })),
                    { id: 'b', title: 'Review issues', docName: 'Inbox', done: false },
                    { id: 'c', title: 'Plan migration', docName: 'Roadmap', done: false },
                    ...Array.from({ length: 13 }, (_, index) => ({ id: `open-${index}`, title: `Open task ${index}`, docName: 'Inbox', done: false })),
                ];
                window['siyuan-plugin-task-horizon'] = { aiBridge: { async searchTasks(query, options = {}) {
                    return items.filter(item => (item.title + ' ' + item.docName).toLowerCase().includes(query.toLowerCase())).slice(0, options.limit || 10);
                } } };
            }, { messages: require('../i18n/en.json'), width });
            await page.addScriptTag({ content: '(function(){const MutationObserver = class { observe() {} disconnect() {} };' + runtime + '})();' });
            await page.evaluate(() => menuTest.open());
            await page.getByRole('button', { name: 'Link task', exact: true }).click();
            const dialog = page.getByRole('dialog');
            const input = dialog.getByRole('searchbox');
            await dialog.locator('.tomato-association-result').first().waitFor();
            assert.equal(await dialog.locator('.tomato-association-result').count(), 10, 'hidden completed tasks do not reduce the visible result limit');
            await input.fill('project notebook');
            await dialog.getByText('No matching tasks', { exact: true }).waitFor();
            assert.equal(await dialog.locator('.tomato-association-result').count(), 0, 'completed tasks are hidden from the tomato picker');
            await input.fill('Inbox');
            const option = dialog.getByRole('button', { name: 'Review issues Inbox', exact: true });
            await option.waitFor();
            assert.equal(await dialog.locator('.tomato-association-result').count(), 10, 'matching unfinished tasks are capped at 10 visible results');
            const bounds = await dialog.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
            await input.press('ArrowDown');
            assert.ok(await option.evaluate(el => el === document.activeElement));
            await option.press('Enter');
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await page.evaluate(() => menuTest.linked()), 'b');
            await page.evaluate(() => menuTest.open());
            const menu = page.locator('#tomy-tomato-context-menu');
            const changeTask = menu.getByRole('button', { name: 'Change linked task', exact: true });
            const taskRow = await menu.locator('.tomato-menu-task').boundingBox();
            const changeTaskBox = await changeTask.boundingBox();
            const historyBox = await menu.getByRole('button', { name: 'View history', exact: true }).boundingBox();
            assert.equal(changeTaskBox.x, historyBox.x, 'task association and history buttons share a left edge');
            assert.equal(changeTaskBox.x + changeTaskBox.width, historyBox.x + historyBox.width,
                'task association and history buttons share a right edge');
            const associationGroup = menu.locator('.tomato-menu-association');
            const groupBox = await associationGroup.boundingBox();
            const borderWidth = await associationGroup.evaluate(el => parseFloat(getComputedStyle(el).borderBottomWidth));
            const focusBox = await menu.locator('.tomato-menu-group').first().boundingBox();
            assert.ok(taskRow.y + taskRow.height <= changeTaskBox.y && borderWidth > 0
                && changeTaskBox.y + changeTaskBox.height <= groupBox.y + groupBox.height - borderWidth
                && groupBox.y + groupBox.height <= focusBox.y,
                'Change linked task appears below the current task and above the divider and focus controls');
            await changeTask.click();
            await page.evaluate(() => { window.failAssociation = true; });
            await dialog.getByRole('button', { name: 'Clear task link' }).click();
            await dialog.getByText('Task link was not saved. Try again.').waitFor();
            assert.equal(await page.evaluate(() => menuTest.linked()), 'b');
            await page.evaluate(() => { window.failAssociation = false; menuTest.start(); });
            await dialog.getByRole('button', { name: 'Clear task link' }).click();
            await dialog.getByText('The timer changed. Reopen task linking to continue.').waitFor();
            assert.equal(await page.evaluate(() => menuTest.linked()), 'b');
            await input.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            if (width === 1100) {
                await page.evaluate(() => menuTest.mountStatusBar());
                const icon = page.locator('#tomy-task-block-icon');
                const tooltip = page.locator('#tomy-task-block-tooltip');
                const taskName = tooltip.locator('#tomy-tooltip-task-name');
                await icon.hover();
                await tooltip.waitFor();
                assert.equal((await taskName.innerText()).trim(), 'Review issues');
                const clear = tooltip.getByRole('button', { name: 'Clear', exact: true });
                const change = tooltip.getByRole('button', { name: 'Change', exact: true });
                assert.equal(await change.count(), 1, 'the linked task tooltip has a change button');
                const clearBox = await clear.boundingBox();
                const changeBox = await change.boundingBox();
                assert.ok(clearBox.x >= changeBox.x + changeBox.width && changeBox.y === clearBox.y,
                    'Change is on the same row to the left of Clear');
                await change.click();
                await tooltip.waitFor({ state: 'hidden' });
                await page.getByRole('dialog', { name: 'Change linked task' }).waitFor();
                await input.fill('Roadmap');
                await dialog.getByRole('button', { name: 'Plan migration Roadmap', exact: true }).click();
                await dialog.waitFor({ state: 'detached' });
                assert.equal(await page.evaluate(() => menuTest.linked()), 'c');
                await icon.hover();
                assert.match(await taskName.innerText(), /Plan migration/);
                await page.mouse.move(20, 20);
            }
            await page.evaluate(() => menuTest.open());
            await page.getByRole('button', { name: 'Change linked task', exact: true }).click();
            await dialog.getByRole('button', { name: 'Clear task link' }).click();
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await page.evaluate(() => menuTest.linked()), null);
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log('Task association menu, status bar replacement, search, keyboard, stale state and unlink passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
