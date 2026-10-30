'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createI18n, normalizeLanguage, normalizePreference } = require('../i18n/runtime');
const root = path.resolve(__dirname, '..');
const messages = { en: require('../i18n/en.json'), 'zh-CN': require('../i18n/zh-CN.json') };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf('\n    }', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(start, end + 6);
}

test('normalizes host languages and restricts saved choices', () => {
    assert.deepEqual(['zh_CN', 'zh-CN', 'zh-TW', 'en_US', 'de_DE', ''].map(normalizeLanguage),
        ['zh-CN', 'zh-CN', 'zh-CN', 'en', 'en', 'en']);
    assert.deepEqual(['system', 'en', 'zh-CN', 'zh_CN', null].map(normalizePreference), ['system', 'en', 'zh-CN', 'system', 'system']);
});

test('parameters remain data, HTML is escaped, and plurals retain counts', () => {
    const api = createI18n({ __locale: 'en', sample: '{name}: {name}', 'items.one': '{count} item', 'items.other': '{count} items' });
    assert.equal(api.t('sample', { name: '$& ${neverRun()} <b>' }), '$& ${neverRun()} <b>: $& ${neverRun()} <b>');
    assert.equal(api.html('sample', { name: '<img>' }), '&lt;img&gt;: &lt;img&gt;');
    assert.equal(api.t('items', { count: 1 }), '1 item');
    assert.equal(api.t('items', { count: 2 }), '2 items');
});

test('the host reads the shared preference before scripts initialize and saves it with main settings', async () => {
    const source = read('index.js');
    const requests = [];
    const host = { module: { exports: {} }, console, Date, Map, Set, Promise, JSON, Blob, FormData, AbortController,
        setTimeout, clearTimeout, setInterval, clearInterval,
        __dockTomatoMainSettings: { uiLanguage: 'en', remindersEnabled: false },
        __taskHorizonHostBridge: { i18n: { locale: 'zh-CN' } },
        siyuan: { config: { appearance: { lang: 'zh_CN' } } },
        require: () => ({ Plugin: class {}, Setting: class {}, platformUtils: {} }),
    };
    const context = vm.createContext(host);
    host.document = { createElement: () => ({ remove() {} }), head: { appendChild: script => vm.runInContext(script.textContent, context) } };
    host.fetch = async (_url, options) => {
        if (options.body instanceof FormData) {
            const file = options.body.get('file');
            if (file) requests.push(JSON.parse(await file.text()));
            return { ok: true, json: async () => ({ code: 0 }) };
        }
        const payload = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => payload.path.endsWith('runtime.js')
            ? read('i18n/runtime.js') : JSON.stringify(messages[payload.path.endsWith('zh-CN.json') ? 'zh-CN' : 'en']) };
    };
    vm.runInContext(source + '\nglobalThis.saveMainForTest = saveMainSettings;', context);
    const plugin = new host.module.exports();
    plugin.i18n = messages['zh-CN'];
    await plugin.initializeLanguage();
    assert.equal(host.__dockTomatoI18n.locale, 'en');
    assert.equal(host.__taskHorizonHostBridge.i18n.locale, 'zh-CN', 'Task Horizon has an independent language');
    assert.equal(await host.saveMainForTest({ remindersEnabled: false, uiLanguage: 'en' }), true);
    assert.deepEqual(requests.at(-1), { remindersEnabled: false, uiLanguage: 'en' });
    const onload = source.slice(source.indexOf('    async onload()'));
    assert.ok(onload.indexOf('await loadMainSettings()') < onload.indexOf('await this.initializeLanguage()'));
    assert.ok(onload.indexOf('await this.initializeLanguage()') < onload.indexOf('await loadTomatoScript()'));
    assert.match(source, /if \(!await saveMainSettings\(next\)\) throw/);
});

test('default distraction notices translate while custom text stays intact', () => {
    const source = extractFunction(read('tomato.js'), 'getDistractionToastText');
    for (const locale of ['en', 'zh-CN']) {
        const settings = { main: { distractionToastText: '已记录一次分心（{count} 次）' } };
        const context = vm.createContext({ userSettings: settings, ensureUserSettings() {}, __tt: createI18n(messages[locale]).t });
        vm.runInContext(source, context);
        assert.equal(context.getDistractionToastText(3), locale === 'en' ? 'Distraction recorded (3 total)' : '已记录一次分心（3 次）');
        assert.equal(settings.main.distractionToastText, '已记录一次分心（{count} 次）');
        settings.main.distractionToastText = '我的自定义提示 {count}';
        assert.equal(context.getDistractionToastText(2), '我的自定义提示 2');
    }
});

test('Chinese parsing and journal path tokens remain independent from the interface language', () => {
    const source = read('tomato.js');
    for (const name of ['runLuminaDateFunc', 'renderLuminaDailyNotePath']) assert.doesNotMatch(extractFunction(source, name), /__tt\(/);
    const start = source.indexOf('const __normalizeSemanticText =');
    const end = source.indexOf('async function __tryAutoSaveReminderFromTitle', start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(source.slice(start, end), /__tt\(/);
});

test('kernel queries use the shared language override and cache each dictionary', async () => {
    const handlers = new Map(), reads = [];
    let preference = 'en', now = Date.now();
    class ClockDate extends Date { static now() { return now; } }
    const siyuan = { plugin: { i18n: messages['zh-CN'], lifecycle: {} },
        rpc: { bind: async (name, handler) => handlers.set(name, handler), unbind: async name => handlers.delete(name) },
        client: { fetch: async (_url, options) => {
            const file = JSON.parse(options.body).path;
            reads.push(file);
            return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(
                file.endsWith('tomato-main-settings.json') ? { uiLanguage: preference }
                    : messages[file.endsWith('zh-CN.json') ? 'zh-CN' : 'en']) };
        } },
    };
    const context = vm.createContext({ siyuan, Date: ClockDate, console, setTimeout, clearTimeout, AbortController, TextDecoder });
    vm.runInContext(read('kernel.js'), context);
    await siyuan.plugin.lifecycle.onload();
    const query = () => handlers.get('dockTomatoQueryFocus')({ from: 'invalid', to: 'invalid' });
    assert.doesNotMatch((await query()).error.message, /\p{Script=Han}/u);
    await query();
    assert.equal(reads.filter(file => file.endsWith('/en.json')).length, 1);
    preference = 'system'; now += 6000;
    assert.match((await query()).error.message, /\p{Script=Han}/u);
    assert.equal(reads.filter(file => file.endsWith('/zh-CN.json')).length, 1);
    await siyuan.plugin.lifecycle.onunload();
});
