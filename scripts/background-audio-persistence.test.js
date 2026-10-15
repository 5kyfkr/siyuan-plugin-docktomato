'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const root = '/data/storage/petal/siyuan-plugin-docktomato';
const settingsPath = root + '/tomato-settings.json';
const playlistPath = root + '/tomato-work-background-playlist.json';
const audioPath = root + '/tomato-audio/';
const copy = value => JSON.parse(JSON.stringify(value));
const extract = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker);
    return source.slice(start, end);
};
const code = extract('    const __tomatoFileTextCache =', '    async function __tomatoSelectStoragePaths()')
    + extract('    async function __tomatoPutFileText(', '    async function __tomatoRemoveFile(')
    + extract('    async function loadUserSettings()', '    // ========== 专注时间设置管理 ==========')
    + extract('    function clampAudioVolume(', '    function getAudioSettings()')
    + extract('    async function saveAudioSettings(', '    async function setAudioFile(');

function context(options = {}) {
    const files = options.files || new Map([[settingsPath, JSON.stringify({ audioSettings: {} })]]);
    const local = options.local || new Map();
    const requests = [];
    const notices = [];
    let uuid = 0;
    const c = vm.createContext({
        userSettings: { audioSettings: {} }, audioSettings: null,
        SETTINGS_FILE_PATH: settingsPath, PLUGIN_STORAGE_DIR: root,
        NEW_AUDIO_STORAGE_PATH: audioPath,
        WORK_BACKGROUND_PLAYLIST_PATH: playlistPath,
        AUDIO_STORAGE_PATH: audioPath, LEGACY_AUDIO_STORAGE_PATH: '/data/storage/tomato-audio/',
        __tomatoAppId: 'test-window', userSettingsAutoFixPending: false,
        __tomatoEnsureDir: async () => true, ensureUserSettings() {},
        localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
        safeJsonParse: JSON.parse, Blob,
        Logger: { info() {}, warn() {}, error() {} }, showMiniToast: message => notices.push(message),
        FormData: class { constructor() { this.values = new Map(); } append(key, value) { this.values.set(key, value); } },
        Audio: class { constructor(src) { this.src = src; } addEventListener() {} pause() {} },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        setTimeout() {}, clearTimeout() {},
        workEndAudio: null, breakEndAudio: null, workEndAudioObjectUrl: null, breakEndAudioObjectUrl: null,
        workBackgroundAudio: null, breakBackgroundAudio: null, currentBackgroundAudio: null,
        workBackgroundAudioObjectUrl: null, breakBackgroundAudioObjectUrl: null,
        workBackgroundAudioFilename: '', breakBackgroundAudioFilename: '', workBackgroundAudioFailureCount: 0,
        backgroundAudioPreview: null, backgroundAudioPreviewObjectUrl: null, backgroundAudioPreviewTimer: null,
        backgroundAudioPreviewGeneration: 0, backgroundAudioPlaybackGeneration: 0, backgroundAudioInitGeneration: 0,
        isRunning: false, isTimerPaused: false, timerMode: 'countdown',
        document: { getElementById: () => null }, Event: class {},
        refreshUploadedAudioPickers() {},
        createTomatoUuid: () => 'background-' + (++uuid),
        fetch: async (url, request) => {
            const filePath = url === '/api/file/putFile' ? request.body.values.get('path') : JSON.parse(request.body).path;
            requests.push({ url, path: filePath });
            if (url === '/api/file/putFile') {
                assert.equal(request.body.values.get('app'), 'test-window');
                if ((options.writeFails === true && (filePath === settingsPath || filePath === playlistPath))
                    || options.writeFails === filePath) {
                    return { ok: true, json: async () => ({ code: 1, msg: 'write failed' }) };
                }
                const file = request.body.values.get('file');
                files.set(filePath, file instanceof Blob ? await file.text() : file);
                return { ok: true, json: async () => ({ code: 0 }) };
            }
            assert.equal(url, '/api/file/getFile');
            if (options.readPlaylistFails && filePath === playlistPath) return { ok: false, status: 503 };
            if ((options.readAudioFails === true || options.readAudioFails === 'throw') && filePath.startsWith(audioPath)) {
                if (options.readAudioFails === 'throw') throw new Error('read interrupted');
                return { ok: false, status: 503 };
            }
            if (!files.has(filePath)) return { ok: false, status: 404 };
            return { ok: true, text: async () => files.get(filePath), blob: async () => {
                if (options.readAudioFails === 'blob' && filePath.startsWith(audioPath)) throw new Error('blob interrupted');
                return new Blob(['audio']);
            } };
        },
    });
    vm.runInContext(code, c);
    c.ensureAudioSettingsDefaults();
    return { c, files, local, requests, notices, options };
}

async function upload(ctx, names = ['rain.mp3', 'forest.mp3']) {
    return ctx.c.uploadWorkBackgroundFiles(names.map(name => ({ name })));
}

async function testStaleSettingsCannotErasePlaylist() {
    const a = context();
    const b = context({ files: a.files });
    await b.c.loadUserSettings();
    await upload(a);
    const expected = copy(a.c.audioSettings.workBackgroundPlaylist);
    b.c.userSettings.main = { defaultTomatoTime: 30 };
    await b.c.saveUserSettings();
    await a.c.loadUserSettings();
    assert.deepEqual(copy(a.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), expected,
        'saving stale general settings in another window must preserve the uploaded list');
    await b.c.loadUserSettings();
    assert.deepEqual(copy(b.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), expected,
        'a reload must bypass the other window\'s old playlist cache');
    b.c.audioSettings.backgroundVolume = 0.2;
    await b.c.saveAudioSettings();
    assert.deepEqual(JSON.parse(a.files.get(playlistPath)), expected);
}

async function testFailedSaveSurvivesRestartAndRetries() {
    for (const writeFails of [true, playlistPath, settingsPath]) {
        const ctx = context({ writeFails });
        const result = await upload(ctx);
        assert.equal(result.playlistSaved, writeFails === settingsPath, 'the upload result must expose a pending playlist save');
        const expected = copy(ctx.c.audioSettings.workBackgroundPlaylist);
        const restarted = context({ files: ctx.files, local: ctx.local, writeFails });
        await restarted.c.loadUserSettings();
        assert.deepEqual(copy(restarted.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), expected,
            'a readable but older main settings file must not discard the local pending playlist');
        restarted.options.writeFails = false;
        await restarted.c.loadUserSettings();
        assert.deepEqual(JSON.parse(restarted.files.get(playlistPath)), expected, 'reloading after recovery must retry persistence');
        const otherDevice = context({ files: restarted.files });
        await otherDevice.c.loadUserSettings();
        assert.deepEqual(copy(otherDevice.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), expected);
    }
}

async function testQueuedSaveKeepsNewerPendingEdit() {
    const ctx = context();
    let releaseFirstWrite;
    const barrier = new Promise(resolve => { releaseFirstWrite = resolve; });
    const put = ctx.c.__tomatoPutFileText;
    let writes = 0;
    ctx.c.__tomatoPutFileText = async (filePath, text) => {
        if (filePath === playlistPath) {
            writes += 1;
            if (writes === 1) await barrier;
            else return false;
        }
        return put(filePath, text);
    };
    const first = [{ name: 'rain', filename: 'rain.mp3' }];
    const second = [...first, { name: 'forest', filename: 'forest.mp3' }];
    const firstSave = ctx.c.setWorkBackgroundPlaylist(first);
    const secondSave = ctx.c.setWorkBackgroundPlaylist(second);
    releaseFirstWrite();
    assert.equal(await firstSave, true);
    assert.equal(await secondSave, false);
    assert.deepEqual(JSON.parse(ctx.files.get(playlistPath)), first);
    const restarted = context({ files: ctx.files, local: ctx.local });
    await restarted.c.loadUserSettings();
    assert.deepEqual(copy(restarted.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), second,
        'completion of an older write must not clear the newer failed edit from the recovery record');
    assert.deepEqual(JSON.parse(ctx.files.get(playlistPath)), second);
}

async function testRemovalClearAndReadFailures() {
    const ctx = context();
    await upload(ctx);
    const original = copy(ctx.c.audioSettings.workBackgroundPlaylist);
    await ctx.c.setWorkBackgroundPlaylist([original[1]]);
    const other = context({ files: ctx.files });
    await other.c.loadUserSettings();
    assert.deepEqual(copy(other.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), [original[1]]);
    await ctx.c.setWorkBackgroundPlaylist([], '');
    await other.c.loadUserSettings();
    assert.deepEqual(copy(other.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), [],
        'an intentionally cleared remote list must override an older successful local backup');
    assert.equal(other.c.audioSettings.workBackgroundSound, '');

    await upload(ctx);
    const expected = copy(ctx.c.audioSettings.workBackgroundPlaylist);
    const offline = context({ files: ctx.files, local: ctx.local, readPlaylistFails: true });
    await offline.c.loadUserSettings();
    assert.deepEqual(copy(offline.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), expected);
    assert.deepEqual(JSON.parse(ctx.files.get(playlistPath)), expected, 'read errors must never write an empty list');

    ctx.options.writeFails = true;
    assert.equal(await ctx.c.setWorkBackgroundPlaylist([], ''), false);
    const restarted = context({ files: ctx.files, local: ctx.local });
    await restarted.c.loadUserSettings();
    assert.deepEqual(copy(restarted.c.ensureAudioSettingsDefaults().workBackgroundPlaylist), [], 'a pending clear must survive restart');
    assert.deepEqual(JSON.parse(ctx.files.get(playlistPath)), []);
}

async function testLegacyMigration() {
    for (const audioSettings of [
        { workBackgroundPlaylist: [{ name: '旧音频', filename: 'legacy.mp3' }], workBackgroundSound: 'legacy.mp3' },
        { workBackgroundSound: 'legacy.mp3' },
    ]) {
        const ctx = context({ files: new Map([[settingsPath, JSON.stringify({ audioSettings })]]) });
        await ctx.c.loadUserSettings();
        assert.equal(ctx.c.ensureAudioSettingsDefaults().workBackgroundPlaylist[0].filename, 'legacy.mp3');
        assert.equal(JSON.parse(ctx.files.get(playlistPath))[0].filename, 'legacy.mp3', 'existing lists must gain protection without another upload');
    }
}

async function testEndSoundReadbackDoesNotBlockSettings() {
    for (const type of ['work', 'break']) {
        for (const readAudioFails of [true, 'throw', 'blob']) {
            const ctx = context({ readAudioFails });
            ctx.c.audioSettings[type + 'EndPreset'] = 'bell';
            const oldAudio = { src: 'blob:old', pause() {} };
            ctx.c[type + 'EndAudio'] = oldAudio;
            ctx.c[type + 'EndAudioObjectUrl'] = 'blob:old';
            for (const name of ['FileInput', 'UploadStatus', 'UploadBtn', 'PresetSelect', 'SoundInput']) ctx.c[type + name] = { style: {}, value: '' };
            vm.runInContext(extract('        ' + type + 'FileInput.onchange = async (e) => {', '        ' + type + 'UploadContainer.appendChild('), ctx.c);
            await ctx.c[type + 'FileInput'].onchange({ target: { files: [{ name: type + '.mp3' }], value: 'selected' } });
            const saved = JSON.parse(ctx.files.get(settingsPath)).audioSettings;
            assert.equal(saved[type + 'EndSound'], type + '.mp3', 'the filename must persist even when preview readback fails');
            assert.equal(saved[type + 'EndPreset'], '');
            assert.equal(ctx.c[type + 'SoundInput'].value, type + '.mp3');
            assert.match(ctx.c[type + 'UploadStatus'].textContent, /预览/);
            assert.doesNotMatch(ctx.c[type + 'UploadStatus'].textContent, /上传失败/);
            assert.equal(ctx.c[type + 'EndAudio'], null, 'readback failure must not keep playing the previous sound');
            assert.equal(oldAudio.src, '');
        }
    }
}

(async () => {
    for (const test of [testStaleSettingsCannotErasePlaylist, testFailedSaveSurvivesRestartAndRetries,
        testQueuedSaveKeepsNewerPendingEdit, testRemovalClearAndReadFailures, testLegacyMigration,
        testEndSoundReadbackDoesNotBlockSettings]) await test();
    console.log('background audio persistence tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
