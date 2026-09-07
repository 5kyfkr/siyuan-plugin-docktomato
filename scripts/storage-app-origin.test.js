'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const pluginSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
const extract = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker + ' must remain extractable');
    return text.slice(start, end);
};
const appId = 'current-tomato-window';
const storagePath = '/data/storage/petal/siyuan-plugin-docktomato';
const requests = [];
const reloads = [];
const context = vm.createContext({
    AbortController,
    Blob,
    FormData,
    Map,
    __tomatoPluginApp: { appId },
    tomatoAppId: appId,
    PLUGIN_STORAGE_DIR: storagePath,
    MAIN_SETTINGS_PATH: storagePath + '/tomato-main-settings.json',
    SYNC_FILE_PATH: storagePath + '/tomato-sync.json',
    REMINDER_SETTINGS_PATH: storagePath + '/tomato-reminder-settings.json',
    AUDIO_STORAGE_PATH: storagePath + '/tomato-audio/',
    reminderSettings: { enabled: true },
    __tomatoFileTextCache: new Map(),
    __tomatoEnsureDir: async () => true,
    ensureDir: async () => true,
    sanitizeMainSettings: (settings) => settings,
    cloneSyncState: (state) => structuredClone(state),
    Logger: { info() {}, warn() {}, error() {} },
    safeJsonParse: (text) => JSON.parse(text),
    fetch: async (url, options) => {
        const payload = options.body instanceof FormData
            ? Object.fromEntries(options.body.entries())
            : JSON.parse(options.body);
        requests.push({ url, payload, signal: options.signal });
        const validRequest = url !== '/api/file/removeFile' || !(options.body instanceof FormData);
        if (validRequest && payload.isDir !== 'true' && payload.path.startsWith(storagePath)) {
            if (payload.app !== appId) reloads.push({ url, path: payload.path });
        }
        const result = { code: validRequest ? 0 : 400 };
        return { ok: true, status: 200, json: async () => result, text: async () => JSON.stringify(result) };
    },
});
vm.runInContext([
    extract(source, '    const __getPluginApp =', '    const __getPluginInstance ='),
    extract(source, '    async function __tomatoPutFileText(', '    async function ensureTomatoStorageMigration('),
    extract(source, '    async function postJSON(', '    function openTomatoColorPickerDialog('),
    extract(source, '    async function uploadAudioFileToStorage(', '    async function setBackgroundAudioFile('),
    extract(source, '    async function saveReminderSettings()', '    const __getReminderDialogDefaultStartDate ='),
    extract(pluginSource, 'const saveMainSettings =', 'module.exports = class TomatoTimerPlugin'),
    'this.syncManager = { scheduleSiyuanSync() {}, ' + extract(source, '        async saveToCloud(', '        enqueueDeferredSync(') + ' };',
    'this.putText = __tomatoPutFileText; this.removeText = __tomatoRemoveFile;',
    'this.upload = uploadAudioFileToStorage; this.saveReminders = saveReminderSettings;',
    'this.saveMain = saveMainSettings; this.removeMain = removeFile;',
].join('\n'), context);

(async () => {
    const controller = new AbortController();
    const historyPath = storagePath + '/history/2026.json';
    context.__tomatoFileTextCache.set(historyPath, 'stale');
    assert.equal(await context.putText(historyPath, '[]', 'application/json', { signal: controller.signal }), true);
    assert.equal(requests[0].payload.app, appId, 'history writes must exclude their own frontend from SiYuan data-change reloads');
    assert.equal(requests[0].signal, controller.signal, 'origin metadata must preserve write cancellation');
    assert.equal(context.__tomatoFileTextCache.has(historyPath), false);
    assert.equal(await context.syncManager.saveToCloud({ status: 'RUNNING' }, false, { confirm: false }), true);
    assert.equal(await context.saveReminders(), true);
    assert.equal(await context.saveMain({ enabled: true }), true);
    const audioFile = new Blob(['audio'], { type: 'audio/wav' });
    audioFile.name = 'alarm.wav';
    assert.equal(await context.upload(audioFile), 'alarm.wav');
    assert.equal(await context.removeText(historyPath, false, { signal: controller.signal }), true);
    assert.equal(await context.removeMain(storagePath + '/old-settings.json'), true);
    for (const request of requests) {
        assert.equal(request.payload.app, appId, request.url + ' must identify the originating frontend');
    }
    assert.deepEqual(reloads, [], 'saving timer state, history, settings, audio, or pruning history must not reload the current plugin');
    delete context.__tomatoPluginApp;
    assert.equal(await context.removeText(storagePath + '/old-history.json'), true);
    assert.equal(requests.at(-1).payload.app, appId, 'cleanup must retain its origin after the plugin globals are removed');
    assert.deepEqual(reloads, []);
    for (const script of [source, pluginSource]) {
        for (const match of script.matchAll(/await fetch\(['"]\/api\/file\/putFile['"]/g)) {
            const formStart = script.lastIndexOf('const formData = new FormData();', match.index);
            assert.ok(formStart >= 0, 'file writes must expose their request form');
            const form = script.slice(formStart, match.index);
            if (/append\(['"]isDir['"], ['"]true['"]\)/.test(form)) continue;
            assert.match(form, /append\(['"]app['"], (?:__tomatoAppId|tomatoAppId)\)/,
                'every file upload, including both end-audio controls, must identify its originating frontend');
        }
    }
    assert.match(pluginSource, /tomatoAppId = String\(this\.app\?\.appId \|\| ""\)/, 'plugin startup must capture the official frontend app ID');
    console.log('storage app origin tests passed');
})().catch((error) => {
    process.nextTick(() => { throw error; });
});
