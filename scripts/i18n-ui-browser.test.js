'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('i18n/runtime.js');
let source = read('tomato.js');
// Defer application startup; exercise production renderers with an isolated host.
source = source.replace('injectInitTimeout = setTimeout(inject, 1000);', 'injectInitTimeout = null;');
const end = source.lastIndexOf('})();');
assert.ok(end > 0);
source = source.slice(0, end) + `
    globalThis.__tomatoI18nTest = { showSettingsDialog, renderFocusTimeSettings, buildDesktopFloatWindowHtml,
        createReminderPanelContent, getDistractionToastText, settings: () => userSettings,
        focusSettings: () => focusTimeSettings, showReminderDialog, showReminderSettingsDialog };
` + source.slice(end);
source = '(function(){const MutationObserver = class { observe() {} disconnect() {} };\n' + source + '\n})();';
const html = '<html><head><style>:root{--b3-theme-primary:#3574bd;--b3-theme-background:#fff;--b3-theme-surface:#f3f4f6;--b3-theme-surface-light:#e7e9ed;--b3-theme-on-background:#222;--b3-theme-on-surface:#333;--b3-theme-on-surface-light:#666;--b3-border-color:#ddd;--b3-theme-error:#c33}body{font:14px Arial;margin:0}</style></head><body></body></html>';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const errors = [], missing = [];
    fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
    try {
        for (const locale of ['en', 'zh-CN']) for (const width of [1100, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 850 } });
            page.on('pageerror', error => errors.push(locale + ': ' + error.message));
            page.on('console', message => { if (message.text().includes('Missing translation')) missing.push(message.text()); });
            await page.setContent(html);
            await page.addScriptTag({ content: runtime });
            await page.evaluate(({ messages, locale }) => {
                globalThis.__dockTomatoI18n = __dockTomatoI18nRuntime.createI18n(messages, { preference: locale });
                globalThis.__dockTomatoMainSettings = { remindersEnabled: true, uiLanguage: locale };
                globalThis.__dockTomatoSetLanguage = async value => {
                    if (globalThis.__failLanguageSave) throw new Error(__dockTomatoI18n.t('settings.languageSaveFailed'));
                    __dockTomatoMainSettings.uiLanguage = value;
                    return value;
                };
                globalThis.siyuan = { config: { appearance: { lang: locale }, system: { container: 'windows' } } };
                globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, data: [] }) });
            }, { messages: JSON.parse(read('i18n/' + locale + '.json')), locale });
            await page.addScriptTag({ content: source });
            await page.evaluate(() => __tomatoI18nTest.showSettingsDialog());
            assert.equal(await page.locator('#tomato-ui-language').inputValue(), locale);
            const reload = page.getByRole('button', { name: locale === 'en' ? 'Reload interface' : '重新加载界面', exact: true });
            assert.equal(await reload.isDisabled(), true);
            await page.locator('#tomato-ui-language').selectOption('system');
            await page.waitForFunction(() => __dockTomatoMainSettings.uiLanguage === 'system');
            assert.equal(await reload.isDisabled(), false);
            await page.evaluate(() => { globalThis.__failLanguageSave = true; });
            await page.locator('#tomato-ui-language').selectOption(locale);
            await page.waitForFunction(() => !document.getElementById('tomato-ui-language').disabled);
            assert.equal(await page.locator('#tomato-ui-language').inputValue(), 'system', 'failed writes restore the saved selection');
            assert.equal(await page.evaluate(() => __dockTomatoMainSettings.uiLanguage), 'system');
            await page.evaluate(() => { globalThis.__failLanguageSave = false; });

            for (const tab of ['main', 'audio', 'appearance', 'taskblock', 'sync']) {
                await page.locator('#tomato-settings-dialog [data-tab="' + tab + '"]').click();
                const text = await page.locator('#tomato-settings-dialog').innerText();
                if (locale === 'en') assert.doesNotMatch(text.replaceAll('简体中文', ''), /\p{Script=Han}/u, tab + ' must display English');
                const bounds = await page.locator('#tomato-settings-dialog').boundingBox();
                assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'dialog stays within the viewport');
                await page.screenshot({ path: path.join(root, `output/playwright/i18n-${locale}-${width}-${tab}.png`) });
            }
            if (width === 1100) {
                const floatHtml = await page.evaluate(() => __tomatoI18nTest.buildDesktopFloatWindowHtml());
                const floating = await browser.newPage({ viewport: { width: 300, height: 180 } });
                floating.on('pageerror', error => errors.push('floating: ' + error.message));
                await floating.setContent(floatHtml);
                await floating.evaluate(() => __setTomatoFloatState({ running: true, timeText: '24:59', durationSeconds: 1500, timerStyle: 'square' }));
                assert.equal(await floating.locator('html').getAttribute('lang'), locale);
                assert.equal(await floating.locator('#toggle-run').getAttribute('title'), locale === 'en' ? 'Pause' : '暂停');
                await floating.evaluate(() => __setTomatoFloatState({ paused: true, timeText: '24:59', taskText: '我的自定义任务', timerStyle: 'square' }));
                assert.equal(await floating.locator('#task').innerText(), '我的自定义任务');
                await floating.screenshot({ path: path.join(root, `output/playwright/i18n-${locale}-floating.png`) });
                await floating.close();

                await page.evaluate(() => {
                    document.body.innerHTML = '<div id="focus-settings"></div>';
                    __tomatoI18nTest.renderFocusTimeSettings(document.getElementById('focus-settings'));
                });
                const groupName = page.locator('#focus-settings input[type="text"]').first();
                assert.equal(await groupName.inputValue(), locale === 'en' ? 'Weekday focus periods' : '工作日专注时间');
                await groupName.focus();
                await groupName.blur();
                assert.equal(await page.evaluate(() => __tomatoI18nTest.focusSettings().groups[0].name), '工作日专注时间');
                await page.evaluate(() => {
                    document.body.innerHTML = '';
                    document.body.appendChild(__tomatoI18nTest.createReminderPanelContent());
                });
                await page.locator('.tomato-reminder-panel').waitFor();
                if (locale === 'en') assert.doesNotMatch(await page.locator('.tomato-reminder-panel').innerText(), /\p{Script=Han}/u);
                await page.screenshot({ path: path.join(root, `output/playwright/i18n-${locale}-reminders.png`) });
                await page.evaluate(() => {
                    __tomatoI18nTest.showReminderSettingsDialog();
                });
                if (locale === 'en') assert.doesNotMatch(await page.locator('#tomato-reminder-settings-dialog').innerText(), /\p{Script=Han}/u);
                await page.evaluate(() => {
                    document.getElementById('tomato-reminder-settings-backdrop')?.remove();
                    __tomatoI18nTest.showReminderDialog('20261030120000-testabc', 'Example task', {
                        enabled: true, interval: 'monthly', times: ['09:00'], startDate: '2026-10-30',
                        calendarMode: 'lunar', repeatMode: 'manual',
                    }, null, { draftMode: true });
                });
                if (locale === 'en') assert.doesNotMatch(await page.locator('#tomato-reminder-dialog').innerText(), /\p{Script=Han}/u);
                await page.screenshot({ path: path.join(root, `output/playwright/i18n-${locale}-reminder-editor.png`) });
            }
            await page.close();
        }
        assert.deepEqual(missing, [], 'No missing messages');
        assert.deepEqual(errors, [], 'No runtime errors');
        console.log('English/Chinese settings, synchronized language selection, save rollback, custom names, reminder panel and desktop floating window passed at 1100/390/320px');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
