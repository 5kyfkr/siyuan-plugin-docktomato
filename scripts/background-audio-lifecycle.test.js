'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${startMarker.trim()} must remain extractable`);
    return source.slice(start, end);
}

const releaseAudioBlock = extract(
    '    function releaseAudio(',
    '    function cleanupEndAudioResources()'
);
const lifecycleBlock = extract(
    '    function stopBackgroundAudioPreview()',
    '    async function loadAudioFromStorage('
);
const muteBlock = extract(
    '    async function setBackgroundAudioMuted(',
    '    function isBreakAudioMode('
);
const playbackBlock = extract(
    '    function isBreakAudioMode(',
    '    async function initBackgroundAudio('
);
const initBlock = extract(
    '    async function initBackgroundAudio(',
    '    async function playBackgroundAudioPreview('
);
const previewBlock = extract(
    '    async function playBackgroundAudioPreview(',
    '    /**\r\n     * 加载音频配置'
);

function createAudio(name, options = {}) {
    return {
        name,
        src: `${name}.ogg`,
        volume: 0.35,
        currentTime: 12,
        pauseCalls: 0,
        playCalls: 0,
        pause() { this.pauseCalls += 1; },
        play() {
            this.playCalls += 1;
            return options.playPromise;
        },
    };
}

function createBaseContext(overrides = {}) {
    const audioSettings = {
        workBackgroundSound: 'rain.ogg',
        breakBackgroundSound: '',
        backgroundVolume: 0.35,
        backgroundEnabled: true,
        backgroundMuted: false,
    };
    return vm.createContext({
        Promise,
        Set,
        URL: { revokeObjectURL() {} },
        clearTimeout() {},
        Logger: { info() {}, warn() {} },
        audioSettings,
        ensureAudioSettingsDefaults: () => audioSettings,
        clampAudioVolume: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        workBackgroundAudio: null,
        breakBackgroundAudio: null,
        currentBackgroundAudio: null,
        workBackgroundAudioObjectUrl: null,
        breakBackgroundAudioObjectUrl: null,
        backgroundAudioPreview: null,
        backgroundAudioPreviewObjectUrl: null,
        backgroundAudioPreviewTimer: null,
        backgroundAudioPreviewGeneration: 0,
        backgroundAudioPlaybackGeneration: 0,
        backgroundAudioInitGeneration: 0,
        isRunning: true,
        isTimerPaused: false,
        timerMode: 'countdown',
        ...overrides,
    });
}

function installLifecycle(context) {
    vm.runInContext(`${releaseAudioBlock}\n${lifecycleBlock}\n${playbackBlock}`, context);
}

async function testStopOwnsEveryBackgroundAudioInstance() {
    const work = createAudio('work');
    const rest = createAudio('break');
    const orphan = createAudio('orphan');
    const preview = createAudio('preview');
    const context = createBaseContext({
        workBackgroundAudio: work,
        breakBackgroundAudio: rest,
        currentBackgroundAudio: orphan,
        backgroundAudioPreview: preview,
    });
    installLifecycle(context);

    vm.runInContext('stopBackgroundAudio()', context);

    for (const audio of [work, rest, orphan, preview]) {
        assert.ok(audio.pauseCalls >= 1, `${audio.name} audio must be stopped`);
    }
    assert.equal(work.currentTime, 0);
    assert.equal(rest.currentTime, 0);
    assert.equal(orphan.currentTime, 0);
    assert.equal(context.currentBackgroundAudio, null);
    assert.equal(context.backgroundAudioPreview, null);
}

async function testMuteAppliesBeforePersistenceFinishes() {
    const work = createAudio('work');
    const preview = createAudio('preview');
    let resolveSave;
    const savePromise = new Promise(resolve => { resolveSave = resolve; });
    const context = createBaseContext({
        workBackgroundAudio: work,
        currentBackgroundAudio: work,
        backgroundAudioPreview: preview,
        saveAudioSettings: () => savePromise,
    });
    installLifecycle(context);
    vm.runInContext(muteBlock, context);

    const pendingMute = vm.runInContext('setBackgroundAudioMuted(true)', context);
    assert.equal(work.volume, 0, 'running background audio must mute immediately');
    assert.equal(preview.volume, 0, 'preview audio must mute immediately');
    assert.ok(work.pauseCalls >= 1, 'running background audio must pause before persistence resolves');

    resolveSave();
    await pendingMute;
}

async function testPendingPlayCannotSurviveStop() {
    let resolvePlay;
    const playPromise = new Promise(resolve => { resolvePlay = resolve; });
    const work = createAudio('work', { playPromise });
    const context = createBaseContext({ workBackgroundAudio: work });
    installLifecycle(context);

    const pendingPlay = vm.runInContext('playBackgroundAudioForCurrentMode()', context);
    vm.runInContext('stopBackgroundAudio()', context);
    resolvePlay();
    await pendingPlay;

    assert.ok(work.pauseCalls >= 2, 'a play promise resolving after stop must be paused again');
    assert.equal(context.currentBackgroundAudio, null);
}

async function testStaleInitializationCannotRestoreAudioAfterStop() {
    let resolveLoad;
    const loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    const stale = createAudio('stale');
    const revoked = [];
    const context = createBaseContext({
        loadAudioFromStorage: () => loadPromise,
        updateBackgroundAudioVolume() {},
        syncBackgroundAudioWithTimerState() {},
        URL: { revokeObjectURL: value => revoked.push(value) },
    });
    installLifecycle(context);
    vm.runInContext(initBlock, context);

    const pendingInit = vm.runInContext('initBackgroundAudio()', context);
    vm.runInContext('stopBackgroundAudio()', context);
    resolveLoad({ audio: stale, objectUrl: 'blob:stale' });
    await pendingInit;

    assert.equal(context.workBackgroundAudio, null, 'a canceled initialization must not publish stale audio');
    assert.ok(stale.pauseCalls >= 1, 'a canceled initialization must release its audio');
    assert.equal(stale.src, '');
    assert.deepEqual(revoked, ['blob:stale']);
}

async function testPendingPreviewLoadCannotSurviveStop() {
    let resolveLoad;
    const loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    const loaded = createAudio('loaded-preview');
    const revoked = [];
    let createdPreviews = 0;
    const context = createBaseContext({
        loadAudioFromStorage: () => loadPromise,
        showMiniToast() {},
        setTimeout() { return 1; },
        Audio() { createdPreviews += 1; },
        URL: { revokeObjectURL: value => revoked.push(value) },
    });
    installLifecycle(context);
    vm.runInContext(previewBlock, context);

    const pendingPreview = vm.runInContext("playBackgroundAudioPreview('work')", context);
    vm.runInContext('stopBackgroundAudio()', context);
    resolveLoad({ audio: loaded, objectUrl: 'blob:preview' });
    await pendingPreview;

    assert.equal(createdPreviews, 0, 'a canceled preview load must not create a playable audio instance');
    assert.equal(context.backgroundAudioPreview, null);
    assert.equal(loaded.src, '');
    assert.deepEqual(revoked, ['blob:preview']);
}

const completeBlock = extract(
    '    async function completeCurrentTomato(',
    '    function isCurrentTaskAssociation('
);
assert.match(completeBlock, /stopBackgroundAudio\(\)/,
    'manual tomato completion must synchronously stop background and preview audio');

(async () => {
    await testStopOwnsEveryBackgroundAudioInstance();
    await testMuteAppliesBeforePersistenceFinishes();
    await testPendingPlayCannotSurviveStop();
    await testStaleInitializationCannotRestoreAudioAfterStop();
    await testPendingPreviewLoadCannotSurviveStop();
    console.log('background audio lifecycle tests passed');
})().catch(error => {
    process.nextTick(() => { throw error; });
});
