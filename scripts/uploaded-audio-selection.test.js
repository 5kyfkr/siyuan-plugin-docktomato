'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const extract = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, startMarker);
    return source.slice(start, end);
};
const copy = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.listeners = new Map(); this.value = ''; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.listeners.set(name, [...this.listeners.get(name) || [], handler]); }
    dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [
            ...(selector === '.' + child.className ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }
}

function context() {
    const container = new Element('main');
    const folders = new Map([
        ['/new', [{ name: 'rain.mp3' }, { name: 'bell.wav' }, { name: 'notes.json' }, { name: 'folder.mp3', isDir: true }]],
        ['/legacy', [{ name: 'rain.mp3' }, { name: '休息.OGG' }, { name: '../outside.mp3' }]],
    ]);
    const requests = [];
    const saves = [];
    const c = vm.createContext({
        userSettings: { audioSettings: { workBackgroundPlaylist: [{ name: '轻柔雨声', filename: 'rain.mp3' }] } }, audioSettings: null,
        AUDIO_STORAGE_PATH: '/legacy/', NEW_AUDIO_STORAGE_PATH: '/new/', LEGACY_AUDIO_STORAGE_PATH: '/legacy/',
        __tomatoAppId: 'test', __tomatoNormalizeDirPath: directory => directory.replace(/\/$/, ''),
        document: { createElement: tag => new Element(tag), getElementById: id => walk(container).find(element => element.id === id) || null },
        Event: class { constructor(type) { this.type = type; } },
        Logger: { info() {}, warn() {}, error() {} }, showMiniToast() {},
        workEndAudio: null, breakEndAudio: null, workEndAudioObjectUrl: null, breakEndAudioObjectUrl: null,
        workBackgroundAudio: null, breakBackgroundAudio: null, currentBackgroundAudio: null,
        workBackgroundAudioObjectUrl: null, breakBackgroundAudioObjectUrl: null,
        workBackgroundAudioFilename: '', breakBackgroundAudioFilename: '', workBackgroundAudioFailureCount: 0,
        backgroundAudioPreview: null, backgroundAudioPreviewObjectUrl: null, backgroundAudioPreviewTimer: null,
        backgroundAudioPreviewGeneration: 0, backgroundAudioPlaybackGeneration: 0, backgroundAudioInitGeneration: 0,
        isRunning: false, isTimerPaused: false, timerMode: 'countdown',
        setTimeout() {}, clearTimeout() {},
        saveUserSettings: async () => { saves.push(copy(c.userSettings)); return true; },
        saveWorkBackgroundPlaylist: async () => true,
        postJSON: async (url, body) => {
            assert.equal(url, '/api/file/readDir');
            requests.push(body.path);
            if (c.directoryFailure) return { data: { code: 500, msg: 'read failed' } };
            return { data: { code: folders.has(body.path) ? 0 : 404, data: folders.get(body.path), msg: 'path does not exist' } };
        },
    });
    vm.runInContext(
        extract('    async function __tomatoReadDir(', '    async function __tomatoRenamePath(')
        + extract('    function clampAudioVolume(', '    async function initAudio()')
        + extract('    function createUploadedAudioPicker(', '    function renderTaskBlockSettings('), c);
    c.initAudio = async () => {};
    c.initBackgroundAudio = async () => {};
    c.ensureAudioSettingsDefaults();
    return { c, container, folders, requests, saves };
}

function walk(element) { return [element, ...element.children.flatMap(walk)]; }
function picker(ctx, label) {
    return walk(ctx.container).find(element => element.tagName === 'select' && element.attributes['aria-label'] === label + '：已上传音频');
}

async function testCatalogAndDirectoryFallback() {
    const ctx = context();
    const files = await ctx.c.listUploadedAudioFiles();
    assert.deepEqual(new Set(files.map(file => file.filename)), new Set(['rain.mp3', 'bell.wav', '休息.OGG']));
    assert.equal(files.find(file => file.filename === 'rain.mp3').name, '轻柔雨声');
    assert.equal(ctx.requests.length, 2, 'the same active and legacy directory must not be scanned twice');
    const paths = [];
    ctx.c.fetch = async (url, options) => {
        assert.equal(url, '/api/file/getFile');
        const filePath = JSON.parse(options.body).path;
        paths.push(filePath);
        return { ok: filePath === '/new/bell.wav' };
    };
    assert.equal((await ctx.c.readAudioFileFromStorage('bell.wav')).ok, true);
    assert.deepEqual(paths, ['/legacy/bell.wav', '/new/bell.wav'], 'new-directory choices must play when the active directory is legacy');
}

async function testAllSelectorsPersistAndRefresh() {
    const ctx = context();
    ctx.c.renderAudioSettings(ctx.container);
    await settle();
    assert.equal(ctx.requests.length, 2, 'all four pickers must share one directory scan');
    const work = picker(ctx, '工作结束提示音');
    const rest = picker(ctx, '休息结束提示音');
    const background = picker(ctx, '休息背景音');
    const focus = picker(ctx, '添加专注背景音');
    assert.ok(work && rest && background && focus);
    ctx.c.audioSettings.workEndPreset = 'bell';
    work.value = 'bell.wav';
    await work.onchange();
    assert.equal(ctx.c.audioSettings.workEndSound, 'bell.wav');
    assert.equal(ctx.c.audioSettings.workEndPreset, '');
    assert.equal(ctx.saves.at(-1).audioSettings.workEndSound, 'bell.wav');
    rest.value = '休息.OGG';
    await rest.onchange();
    assert.equal(ctx.saves.at(-1).audioSettings.breakEndSound, '休息.OGG');
    background.value = 'rain.mp3';
    await background.onchange();
    assert.equal(ctx.saves.at(-1).audioSettings.breakBackgroundSound, 'rain.mp3');
    focus.value = 'bell.wav';
    await focus.onchange();
    focus.value = 'bell.wav';
    await focus.onchange();
    assert.deepEqual(copy(ctx.c.audioSettings.workBackgroundPlaylist).map(track => track.filename), ['rain.mp3', 'bell.wav'], 'selecting an existing track must not duplicate it');
    ctx.folders.get('/new').push({ name: 'newly-uploaded.mp3' });
    walk(ctx.container).find(element => element.attributes['aria-label'] === '刷新工作结束提示音的已上传音频').onclick();
    await settle();
    for (const control of [work, rest, background, focus]) assert.ok(control.children.some(option => option.value === 'newly-uploaded.mp3'));
    assert.equal(work.value, 'bell.wav', 'refreshing options must preserve the selected sound');
    assert.equal(ctx.requests.length, 4);
}

async function testEmptyAndErrorStates() {
    const ctx = context();
    ctx.folders.clear();
    ctx.c.renderAudioSettings(ctx.container);
    await settle();
    const work = picker(ctx, '工作结束提示音');
    assert.equal(work.disabled, true);
    assert.match(work.children[0].textContent, /暂无已上传/);
    ctx.c.directoryFailure = true;
    const refresh = walk(ctx.container).find(element => element.attributes['aria-label'] === '刷新工作结束提示音的已上传音频');
    refresh.onclick();
    await settle();
    assert.match(work.children[0].textContent, /读取失败/);
    assert.equal(refresh.disabled, false, 'a failed scan must remain retryable');
    ctx.c.directoryFailure = false;
    ctx.folders.set('/new', [{ name: 'recovered.mp3' }]);
    refresh.onclick();
    await settle();
    assert.equal(work.disabled, false);
    assert.equal(work.children[1].value, 'recovered.mp3');
}

(async () => {
    for (const test of [testCatalogAndDirectoryFallback, testAllSelectorsPersistAndRefresh, testEmptyAndErrorStates]) await test();
    console.log('uploaded audio selection tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
