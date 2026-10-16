'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');
const audioCode = source.slice(source.indexOf('    function clampAudioVolume('), source.indexOf('    function getAudioSettings()'));
const tracks = ['rain.mp3', 'forest.mp3', 'waves.mp3'].map(filename => ({ name: filename, filename }));
const copy = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

class FakeAudio {
    constructor(src) {
        this.src = src;
        this.currentTime = 0;
        this.volume = 0.35;
        this.paused = true;
        this.listeners = new Map();
        this.playCalls = 0;
        this.pauseCalls = 0;
    }
    get src() { return this._src; }
    set src(value) {
        this._src = value;
        this.currentTime = 0;
        this.ended = false;
        this.error = null;
        this.paused = true;
    }
    addEventListener(type, handler) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(handler);
        this.listeners.set(type, listeners);
    }
    emit(type) {
        if (type === 'ended') { this.ended = true; this.paused = true; }
        for (const handler of this.listeners.get(type) || []) handler();
    }
    pause() { this.paused = true; this.pauseCalls += 1; }
    play() {
        this.playCalls += 1;
        this.paused = false;
        this.ended = false;
        if (this.playFailure) {
            this.paused = true;
            return Promise.reject(Object.assign(new Error('play failed'), { name: this.playFailure }));
        }
        return this.playResult || Promise.resolve();
    }
}

function context(settings = {}, overrides = {}) {
    const saved = [];
    const loads = [];
    const revoked = [];
    const toasts = [];
    const timers = new Map();
    const audios = [];
    let uuid = 0;
    const c = vm.createContext({
        userSettings: { audioSettings: copy(settings) }, audioSettings: null,
        workBackgroundAudio: null, breakBackgroundAudio: null, currentBackgroundAudio: null,
        workBackgroundAudioObjectUrl: null, breakBackgroundAudioObjectUrl: null,
        workBackgroundAudioFilename: '', breakBackgroundAudioFilename: '', workBackgroundAudioFailureCount: 0,
        backgroundAudioPreview: null, backgroundAudioPreviewObjectUrl: null, backgroundAudioPreviewTimer: null,
        backgroundAudioPreviewGeneration: 0, backgroundAudioPlaybackGeneration: 0, backgroundAudioInitGeneration: 0,
        timerMode: 'countdown', isRunning: true, isTimerPaused: false,
        document: { getElementById: () => null }, Event: class {},
        Logger: { info() {}, warn() {} }, showMiniToast: message => toasts.push(message),
        URL: { revokeObjectURL: url => revoked.push(url) }, Audio: FakeAudio,
        setTimeout(fn, milliseconds) { const id = timers.size + 1; timers.set(id, { fn, milliseconds }); return id; },
        clearTimeout: id => timers.delete(id),
        createTomatoUuid: () => 'background_' + (++uuid),
        AUDIO_STORAGE_PATH: '/audio/', LEGACY_AUDIO_STORAGE_PATH: '/legacy/', __tomatoAppId: 'test',
        __tomatoEnsureDir: async () => {},
        FormData: class { constructor() { this.values = new Map(); } append(key, value) { this.values.set(key, value); } },
        ...overrides
    });
    vm.runInContext(audioCode, c);
    const storageLoad = c.loadAudioFromStorage;
    c.saveAudioSettings = async () => { saved.push(copy(c.ensureAudioSettingsDefaults())); };
    c.loadAudioFromStorage = async filename => {
        loads.push(filename);
        if (!filename) return { audio: null, objectUrl: null };
        const audio = new FakeAudio('blob:' + filename);
        audios.push(audio);
        return { audio, objectUrl: audio.src };
    };
    c.ensureAudioSettingsDefaults();
    return { c, saved, loads, revoked, toasts, timers, audios, storageLoad };
}

async function testMigrationAndPersistence() {
    const legacy = context({ workBackgroundSound: 'old.mp3' });
    assert.deepEqual(copy(legacy.c.audioSettings.workBackgroundPlaylist), [{ name: 'old.mp3', filename: 'old.mp3' }]);
    assert.equal(legacy.c.audioSettings.workBackgroundPlayMode, 'single');
    const fresh = context({}, { isRunning: false });
    assert.equal(fresh.c.audioSettings.workBackgroundPlayMode, 'sequence');
    await fresh.c.setWorkBackgroundPlaylist(tracks);
    await fresh.c.selectWorkBackgroundSound('forest.mp3');
    await fresh.c.setWorkBackgroundPlayMode('single');
    const restored = context(fresh.saved.at(-1));
    assert.deepEqual(copy(restored.c.audioSettings.workBackgroundPlaylist), tracks);
    assert.equal(restored.c.audioSettings.workBackgroundSound, 'forest.mp3');
    assert.equal(restored.c.audioSettings.workBackgroundPlayMode, 'single');
    const malformed = context({ workBackgroundPlaylist: [{ filename: 'a' }, { filename: 'a' }, null], workBackgroundSound: 'missing' });
    assert.deepEqual(copy(malformed.c.audioSettings.workBackgroundPlaylist), [{ filename: 'a', name: 'a' }]);
    assert.equal(malformed.c.audioSettings.workBackgroundSound, 'a');
}

async function testReorderAndSequence() {
    const { c, loads, saved } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'forest.mp3' });
    await c.initBackgroundAudio();
    const playing = c.workBackgroundAudio;
    playing.currentTime = 17;
    const reordered = [tracks[2], tracks[1], tracks[0]];
    await c.setWorkBackgroundPlaylist(reordered);
    assert.equal(c.workBackgroundAudio, playing, 'sorting must reuse the audio instance');
    assert.equal(playing.currentTime, 17);
    assert.equal(playing.paused, false);
    assert.equal(loads.length, 1);
    assert.deepEqual(saved.at(-1).workBackgroundPlaylist, reordered);
    playing.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3', 'ended must use the latest order');
    await c.nextWorkBackgroundSound();
    assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3', 'next must wrap around');
    assert.deepEqual(copy(c.getWorkBackgroundMenuItems()).map(item => item.label), ['下一首', 'waves.mp3', 'forest.mp3', 'rain.mp3']);
    await c.setWorkBackgroundPlayMode('single');
    assert.equal(c.workBackgroundAudio.loop, true);
    c.workBackgroundAudio.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3');
    await c.nextWorkBackgroundSound();
    assert.equal(c.audioSettings.workBackgroundSound, 'forest.mp3', 'manual next also works in single mode');
}

async function testPauseStopAndSelection() {
    const { c, loads } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3', breakBackgroundSound: 'break.mp3' });
    await c.initBackgroundAudio();
    const audio = c.workBackgroundAudio;
    audio.currentTime = 23;
    c.isRunning = false;
    c.isTimerPaused = true;
    c.pauseBackgroundAudio();
    await c.initBackgroundAudio();
    assert.equal(c.workBackgroundAudio, audio);
    assert.equal(audio.currentTime, 23);
    c.isRunning = true;
    c.isTimerPaused = false;
    await c.syncBackgroundAudioWithTimerState();
    assert.equal(audio.currentTime, 23);
    c.stopBackgroundAudio();
    await c.initBackgroundAudio();
    assert.equal(c.workBackgroundAudio, audio);
    assert.equal(audio.currentTime, 0);
    c.timerMode = 'break';
    await c.syncBackgroundAudioWithTimerState();
    assert.equal(c.currentBackgroundAudio, c.breakBackgroundAudio);
    assert.equal(c.breakBackgroundAudio.loop, true);
    const before = loads.length;
    await c.selectWorkBackgroundSound('waves.mp3');
    assert.equal(loads.length, before, 'selection in a break must only update the focus selection');
    assert.equal(c.breakBackgroundAudio.paused, false);
    c.timerMode = 'stopwatch';
    await c.initBackgroundAudio();
    assert.equal(c.currentBackgroundAudio, c.workBackgroundAudio);
    assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3');
    assert.equal(c.breakBackgroundAudio.paused, true);
    c.isRunning = false;
    c.pauseBackgroundAudio();
    const inactiveLoads = loads.length;
    await c.selectWorkBackgroundSound('forest.mp3');
    assert.equal(loads.length, inactiveLoads);
}

async function testListMutationAndLegacySetter() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'forest.mp3' });
    await c.initBackgroundAudio();
    await c.setWorkBackgroundPlaylist([tracks[0], tracks[2]], 'waves.mp3');
    assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3');
    await c.setBackgroundAudioFile('work', 'legacy.mp3');
    assert.deepEqual(copy(c.audioSettings.workBackgroundPlaylist), [{ name: 'legacy.mp3', filename: 'legacy.mp3' }]);
    const single = c.workBackgroundAudio;
    single.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'legacy.mp3');
    assert.equal(c.workBackgroundAudio.currentTime, 0);
    await c.setWorkBackgroundPlaylist([], '');
    assert.equal(c.currentBackgroundAudio, null);
    assert.equal(c.workBackgroundAudio, null);
    assert.equal(c.audioSettings.workBackgroundSound, '');
    await c.nextWorkBackgroundSound();
    await c.initBackgroundAudio();
    assert.deepEqual(copy(c.audioSettings.workBackgroundPlaylist), []);
}

async function testBatchUpload() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'forest.mp3' }, { isRunning: false });
    const paths = [];
    c.fetch = async (url, options) => {
        assert.equal(url, '/api/file/putFile');
        paths.push(options.body.values.get('path'));
        const bad = options.body.values.get('file').name === 'bad.mp3';
        return { json: async () => ({ code: bad ? 1 : 0 }) };
    };
    const progress = [];
    const result = await c.uploadWorkBackgroundFiles([{ name: 'same.mp3' }, { name: 'bad.mp3' }, { name: 'same.mp3' }], done => progress.push(done));
    assert.deepEqual(copy(result.failures), ['bad.mp3']);
    assert.equal(new Set(paths).size, 3, 'same filenames must not overwrite one another');
    assert.deepEqual(copy(c.audioSettings.workBackgroundPlaylist).slice(3).map(track => track.name), ['same.mp3', 'same.mp3']);
    assert.equal(c.audioSettings.workBackgroundSound, 'forest.mp3');
    assert.deepEqual(progress, [1, 2, 3]);
}

async function testLateLoadsAndPlayPromises() {
    const { c, revoked } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    const pending = new Map();
    c.loadAudioFromStorage = filename => {
        const request = deferred();
        pending.set(filename, request);
        return request.promise;
    };
    const first = c.selectWorkBackgroundSound('rain.mp3');
    const second = c.selectWorkBackgroundSound('forest.mp3');
    const oldAudio = new FakeAudio('blob:old');
    const newAudio = new FakeAudio('blob:new');
    pending.get('forest.mp3').resolve({ audio: newAudio, objectUrl: 'blob:new' });
    await second;
    pending.get('rain.mp3').resolve({ audio: oldAudio, objectUrl: 'blob:old' });
    await first;
    assert.equal(c.workBackgroundAudio, newAudio);
    assert.equal(oldAudio.src, '');
    assert.ok(revoked.includes('blob:old'));
    assert.equal(oldAudio.playCalls, 0);
    const third = c.selectWorkBackgroundSound('waves.mp3');
    c.stopBackgroundAudio();
    const stoppedAudio = new FakeAudio('blob:stopped');
    pending.get('waves.mp3').resolve({ audio: stoppedAudio, objectUrl: 'blob:stopped' });
    await third;
    assert.equal(stoppedAudio.src, '');
    assert.equal(stoppedAudio.playCalls, 0);

    const race = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await race.c.initBackgroundAudio();
    const audio = race.c.workBackgroundAudio;
    const delayed = deferred();
    audio.playResult = delayed.promise;
    const play = race.c.playBackgroundAudioForCurrentMode();
    await race.c.setBackgroundAudioMuted(true);
    delayed.resolve();
    await play;
    assert.equal(audio.paused, true);
    assert.equal(audio.volume, 0);
    race.c.cleanupBackgroundAudioResources();
    assert.equal(audio.src, '');
}

async function testFailuresAndPermission() {
    const missing = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    missing.c.loadAudioFromStorage = async filename => {
        missing.loads.push(filename);
        return { audio: null, objectUrl: null };
    };
    await missing.c.initBackgroundAudio();
    assert.equal(missing.loads.length, tracks.length, 'failure traversal must be bounded');
    assert.equal(missing.toasts.length, 1);

    const broken = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    const load = broken.c.loadAudioFromStorage;
    broken.c.loadAudioFromStorage = async filename => {
        const loaded = await load(filename);
        (broken.c.workBackgroundAudio || loaded.audio).playFailure = 'NotSupportedError';
        return loaded;
    };
    await broken.c.initBackgroundAudio();
    assert.equal(broken.loads.length, tracks.length);
    assert.equal(broken.toasts.length, 1);

    const blocked = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    const blockedLoad = blocked.c.loadAudioFromStorage;
    blocked.c.loadAudioFromStorage = async filename => {
        const loaded = await blockedLoad(filename);
        loaded.audio.playResult = Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
        return loaded;
    };
    await blocked.c.initBackgroundAudio();
    assert.equal(blocked.loads.length, 1, 'permission rejection must not skip tracks');
    assert.equal(blocked.c.audioSettings.workBackgroundSound, 'rain.mp3');
    assert.equal(blocked.toasts.length, 1);
}

async function testPreviewDoesNotAdvance() {
    const { c, timers } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    await c.playBackgroundAudioPreview('work', 'forest.mp3');
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3');
    assert.equal([...timers.values()][0].milliseconds, 5000);
    c.backgroundAudioPreview.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3');
    assert.equal(c.backgroundAudioPreview, null);
}

async function testSelectionWhileMutedAndDisabled() {
    const { c, loads } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    await c.setBackgroundAudioMuted(true);
    await c.selectWorkBackgroundSound('forest.mp3');
    const before = loads.length;
    await c.setBackgroundAudioMuted(false);
    await settle();
    assert.equal(loads.length, before + 1);
    assert.equal(c.audioSettings.workBackgroundSound, 'forest.mp3');
    assert.equal(c.currentBackgroundAudio, c.workBackgroundAudio);
    assert.equal(c.workBackgroundAudio.paused, false);
    c.audioSettings.backgroundEnabled = false;
    await c.syncBackgroundAudioWithTimerState();
    await c.selectWorkBackgroundSound('waves.mp3');
    c.audioSettings.backgroundEnabled = true;
    await c.syncBackgroundAudioWithTimerState();
    assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3');
    assert.equal(c.workBackgroundAudio.paused, false);
}

async function testCanceledLoadsAndResumedPlay() {
    for (const cancel of [c => c.setBackgroundAudioMuted(true), c => {
        c.audioSettings.backgroundEnabled = false;
        c.syncBackgroundAudioWithTimerState();
    }, c => c.cleanupBackgroundAudioResources()]) {
        const { c, revoked } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
        const request = deferred();
        c.loadAudioFromStorage = () => request.promise;
        const loading = c.initBackgroundAudio('work');
        await cancel(c);
        const audio = new FakeAudio('blob:canceled');
        request.resolve({ audio, objectUrl: audio.src });
        await loading;
        assert.equal(audio.playCalls, 0);
        assert.equal(audio.src, '');
        assert.deepEqual(revoked, ['blob:canceled']);
    }
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const audio = c.workBackgroundAudio;
    const request = deferred();
    audio.playResult = request.promise;
    const oldPlay = c.playBackgroundAudioForCurrentMode();
    c.pauseBackgroundAudio();
    audio.playResult = Promise.resolve();
    await c.playBackgroundAudioForCurrentMode();
    request.resolve();
    await oldPlay;
    assert.equal(audio.paused, false, 'an older play promise must not pause the resumed instance');
}

async function testRepeatedNaturalWrapAround() {
    const { c, loads } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'waves.mp3' });
    await c.initBackgroundAudio();
    for (let cycle = 0; cycle < 90; cycle += 1) {
        const playing = c.currentBackgroundAudio;
        playing.ended = true;
        playing.paused = true;
        playing.emit('ended');
        await settle();
        assert.equal(c.audioSettings.workBackgroundSound, tracks[cycle % tracks.length].filename);
        assert.equal(c.currentBackgroundAudio.paused, false, 'natural endings must keep cycling without a gesture');
    }
    assert.equal(loads.length, 91);
}

async function testInterruptedWrapAroundDoesNotSkipFirstTrack() {
    const { c, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'waves.mp3' });
    await c.initBackgroundAudio();
    const load = c.loadAudioFromStorage;
    c.loadAudioFromStorage = async filename => {
        const loaded = await load(filename);
        if (filename === 'rain.mp3') {
            let attempt = 0;
            (c.workBackgroundAudio || loaded.audio).play = function () {
                this.playCalls += 1;
                this.paused = true;
                if (attempt++ === 0) return Promise.reject(Object.assign(new Error('media playback interrupted'), { name: 'AbortError' }));
                this.paused = false;
                return Promise.resolve();
            };
        }
        return loaded;
    };
    c.currentBackgroundAudio.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3', 'a temporary play interruption must not discard the first track after wrapping');
    assert.notEqual(c.currentBackgroundAudio._tomatoBackgroundFailed, true);
    await c.recoverBackgroundAudioIfNeeded(10000);
    assert.equal(c.currentBackgroundAudio.paused, false);
    assert.equal(toasts.length, 0);
}

async function testUnexpectedPauseAndMissedEndedRecover() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'waves.mp3' });
    await c.initBackgroundAudio();
    const audio = c.currentBackgroundAudio;
    audio.currentTime = 620;
    audio.pause();
    await c.recoverBackgroundAudioIfNeeded(10000);
    assert.equal(audio.paused, false, 'a media pause while the timer runs must recover automatically');
    assert.equal(audio.currentTime, 620, 'recovery must preserve the listening position');
    audio.ended = true;
    audio.paused = true;
    await c.recoverBackgroundAudioIfNeeded(20000);
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3', 'a missed ended event on the final track must wrap to the first');
    assert.equal(c.currentBackgroundAudio.paused, false);
    const tickStart = source.indexOf('    async function handleTimerTick()');
    const tickEnd = source.indexOf('    function assertTimerReady()', tickStart);
    assert.match(source.slice(tickStart, tickEnd), /recoverBackgroundAudioIfNeeded/, 'the existing timer heartbeat must own audio recovery');
}

async function testRecoveryHonorsIntentAndPendingPlayback() {
    const { c, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const audio = c.currentBackgroundAudio;
    for (const property of ['isTimerPaused', 'backgroundMuted', 'backgroundEnabled']) {
        audio.pause();
        const before = audio.playCalls;
        const target = property === 'isTimerPaused' ? c : c.audioSettings;
        target[property] = property !== 'backgroundEnabled';
        await c.recoverBackgroundAudioIfNeeded(10000);
        assert.equal(audio.playCalls, before, 'recovery must honor ' + property);
        target[property] = property === 'backgroundEnabled';
    }
    audio.playResult = Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
    await c.playBackgroundAudioForCurrentMode();
    const blockedCalls = audio.playCalls;
    await c.recoverBackgroundAudioIfNeeded(20000);
    assert.equal(audio.playCalls, blockedCalls, 'permission rejection must not cause automatic retry loops');
    assert.equal(toasts.length, 1);
    audio.playResult = null;
    await c.setBackgroundAudioMuted(true);
    await c.setBackgroundAudioMuted(false);
    await settle();
    assert.equal(audio.paused, false, 'the user gesture must still allow retrying');
    const pending = deferred();
    audio.playResult = pending.promise;
    const playing = c.playBackgroundAudioForCurrentMode();
    audio.paused = true;
    const pendingCalls = audio.playCalls;
    await c.recoverBackgroundAudioIfNeeded(30000);
    assert.equal(audio.playCalls, pendingCalls, 'recovery must not interrupt an unresolved play request');
    pending.resolve();
    await playing;
    c.stopBackgroundAudio();
    const stoppedCalls = audio.playCalls;
    await c.recoverBackgroundAudioIfNeeded(40000);
    assert.equal(audio.playCalls, stoppedCalls, 'explicit background stop must remain stopped');
}

async function testStalledNativePlaybackRecovers() {
    const { c, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const stalled = c.currentBackgroundAudio;
    stalled.currentTime = 12;
    const now = Date.now();
    await c.recoverBackgroundAudioIfNeeded(now);
    await c.recoverBackgroundAudioIfNeeded(now + 16000);
    assert.equal(c.audioSettings.workBackgroundSound, 'forest.mp3',
        'native playback can stall without becoming paused or ended; the heartbeat must advance');
    assert.equal(c.currentBackgroundAudio.paused, false);
    assert.equal(stalled.src, 'blob:forest.mp3');
    assert.equal(toasts.length, 0);
}

async function testPendingPlaybackTimeoutAndConcurrentSync() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const stalled = c.currentBackgroundAudio;
    const pending = deferred();
    stalled.playResult = pending.promise;
    const playing = c.playBackgroundAudioForCurrentMode();
    stalled.playResult = null;
    const calls = stalled.playCalls;
    await c.syncBackgroundAudioWithTimerState();
    assert.equal(stalled.playCalls, calls, 'state refreshes must reuse a pending play request');
    const now = Date.now();
    await c.recoverBackgroundAudioIfNeeded(now);
    await c.recoverBackgroundAudioIfNeeded(now + 16000);
    assert.equal(c.audioSettings.workBackgroundSound, 'forest.mp3', 'an unresolved play promise must not block the playlist forever');
    pending.resolve();
    await playing;
    assert.equal(stalled.src, 'blob:forest.mp3', 'a late play completion must not restore the skipped source');
    assert.equal(c.currentBackgroundAudio.paused, false);
}

async function testMissedEndedWithPendingPlayRecovers() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'waves.mp3' });
    await c.initBackgroundAudio();
    const audio = c.currentBackgroundAudio;
    const pending = deferred();
    audio.playResult = pending.promise;
    const playing = c.playBackgroundAudioForCurrentMode();
    audio.playResult = null;
    audio.ended = true;
    audio.paused = true;
    await c.recoverBackgroundAudioIfNeeded(Date.now());
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3', 'a missed ending must recover even when an old play promise is pending');
    pending.resolve();
    await playing;
    assert.equal(c.currentBackgroundAudio.paused, false);
}

async function testNextTrackReadTimeoutRecovers() {
    for (const stage of ['response', 'body']) {
        const { c, storageLoad, timers, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' }, {
            NEW_AUDIO_STORAGE_PATH: '/audio/'
        });
        await c.initBackgroundAudio();
        const pending = deferred();
        let urls = 0;
        c.URL.createObjectURL = () => 'blob:loaded-' + (++urls);
        c.fetch = async (url, options) => {
            const filename = JSON.parse(options.body).path.split('/').at(-1);
            if (filename === 'forest.mp3') {
                if (stage === 'response') return pending.promise;
                return { ok: true, blob: () => pending.promise };
            }
            return { ok: true, blob: async () => ({}) };
        };
        c.loadAudioFromStorage = storageLoad;
        const switching = c.nextWorkBackgroundSound();
        await settle();
        assert.equal(c.currentBackgroundAudio, null);
        const timeout = [...timers.values()].find(timer => timer.milliseconds === 15000);
        assert.ok(timeout, 'loading the next track needs a deadline covering both response and body');
        timeout.fn();
        await switching;
        assert.equal(c.audioSettings.workBackgroundSound, 'waves.mp3', 'an unreadable next track must not strand the player between songs');
        assert.equal(c.currentBackgroundAudio.paused, false);
        assert.equal(toasts.length, 0);
        pending.resolve(stage === 'response' ? { ok: true, blob: async () => ({}) } : {});
        await settle();
        assert.equal(urls, 1, 'late timed-out reads must not allocate an unused media URL');
    }
}

async function testProgressAndLongPauseDoNotSkipHealthyTracks() {
    const { c, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const audio = c.currentBackgroundAudio;
    const now = Date.now();
    for (let tick = 1; tick <= 4; tick += 1) {
        audio.currentTime += 20;
        await c.recoverBackgroundAudioIfNeeded(now + tick * 20000);
        assert.equal(c.currentBackgroundAudio, audio, 'progressing playback must survive infrequent background heartbeats');
    }
    audio.pause();
    const position = audio.currentTime;
    await c.recoverBackgroundAudioIfNeeded(now + 100000);
    assert.equal(c.currentBackgroundAudio, audio, 'an unexpected pause after a long gap must resume the same track');
    assert.equal(audio.currentTime, position);
    assert.equal(audio.paused, false);
    assert.equal(toasts.length, 0);
}

async function testStalledTraversalRemainsBounded() {
    const { c, loads, toasts } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const now = Date.now();
    for (let index = 0; index < tracks.length; index += 1) {
        await c.recoverBackgroundAudioIfNeeded(now + (index + 1) * 20000);
    }
    assert.equal(loads.length, tracks.length, 'a playlist of stalled files must stop after one traversal');
    assert.equal(c.currentBackgroundAudio.paused, true);
    assert.equal(toasts.length, 1);
    await c.recoverBackgroundAudioIfNeeded(now + 100000);
    assert.equal(loads.length, tracks.length, 'failed traversal must not restart on subsequent heartbeats');
}

async function testSequencePreservesElementPlaybackPermission() {
    const { c } = context({ workBackgroundPlaylist: tracks, workBackgroundSound: 'rain.mp3' });
    await c.initBackgroundAudio();
    const permitted = c.currentBackgroundAudio;
    await c.nextWorkBackgroundSound();
    assert.equal(c.currentBackgroundAudio, permitted, 'automatic tracks need the same media element unlocked by the user gesture');
    assert.equal(permitted.src, 'blob:forest.mp3');
    await c.nextWorkBackgroundSound();
    assert.equal(c.currentBackgroundAudio, permitted);
    assert.equal(permitted.listeners.get('ended').length, 1, 'reusing an element must not multiply transition listeners');
    permitted.emit('ended');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, 'rain.mp3', 'one natural ending must advance exactly once');
    await c.setBackgroundAudioMuted(true);
    await c.selectWorkBackgroundSound('waves.mp3');
    await c.setBackgroundAudioMuted(false);
    await settle();
    assert.equal(c.currentBackgroundAudio, permitted, 'selection while muted must also retain the element permission');
    const filename = c.audioSettings.workBackgroundSound;
    permitted.ended = false;
    for (const handler of permitted.listeners.get('ended')) handler();
    permitted.emit('error');
    await settle();
    assert.equal(c.audioSettings.workBackgroundSound, filename, 'queued old-source events must not skip a new source');
}

async function testMissingFile202FallsBackToLegacyDirectory() {
    const { c, storageLoad } = context({}, { NEW_AUDIO_STORAGE_PATH: '/audio/' });
    const paths = [];
    c.fetch = async (url, options) => {
        const requested = JSON.parse(options.body).path;
        paths.push(requested);
        if (requested.startsWith('/audio/')) return { ok: true, status: 202, blob: async () => ({ code: 404 }) };
        return { ok: true, status: 200, blob: async () => ({ audio: true }) };
    };
    c.URL.createObjectURL = blob => {
        assert.equal(blob.audio, true, 'a 202 JSON error response must never reach the media decoder');
        return 'blob:legacy';
    };
    const loaded = await storageLoad('old.mp3', 'work');
    assert.ok(loaded.audio);
    assert.deepEqual(paths, ['/audio/old.mp3', '/legacy/old.mp3']);
}

(async () => {
    for (const test of [testSequencePreservesElementPlaybackPermission, testMissingFile202FallsBackToLegacyDirectory,
        testMigrationAndPersistence, testReorderAndSequence, testPauseStopAndSelection,
        testListMutationAndLegacySetter, testBatchUpload, testLateLoadsAndPlayPromises, testFailuresAndPermission,
        testPreviewDoesNotAdvance, testSelectionWhileMutedAndDisabled, testCanceledLoadsAndResumedPlay,
        testRepeatedNaturalWrapAround, testInterruptedWrapAroundDoesNotSkipFirstTrack,
        testUnexpectedPauseAndMissedEndedRecover, testRecoveryHonorsIntentAndPendingPlayback,
        testStalledNativePlaybackRecovers, testPendingPlaybackTimeoutAndConcurrentSync,
        testMissedEndedWithPendingPlayRecovers, testNextTrackReadTimeoutRecovers,
        testProgressAndLongPauseDoNotSkipHealthyTracks, testStalledTraversalRemainsBounded]) await test();
    console.log('background audio playlist tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
