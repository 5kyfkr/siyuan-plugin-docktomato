// @name         思源笔记简易番茄钟
// @namespace    https://ld246.com/article/1767077931114
// @version      1.0
// @description  增加进度条霓虹风格，支持自定义颜色、呼吸效果、平滑效果等

(function () {
    'use strict';

    if (globalThis.__TomatoTimerLoaded) return;
    globalThis.__TomatoTimerLoaded = true;
    let __tomatoDestroyed = false;

    let __siyuanSdk = null;
    try {
        if (typeof require === 'function') {
            __siyuanSdk = require('siyuan');
        }
    } catch (e) {}
    const __openTab = globalThis.__tomatoOpenTab || __siyuanSdk?.openTab;
    const __openMobileFileById = globalThis.__tomatoOpenMobileFileById || __siyuanSdk?.openMobileFileById;
    const __getPluginApp = () => globalThis.__tomatoPluginApp || null;
    const __canUseOfficialOpenBlock = () => !!__getPluginApp() && (typeof __openTab === 'function' || typeof __openMobileFileById === 'function');

    const __openBlockByOfficialApi = async (blockId) => {
        const app = __getPluginApp();
        if (!app || !blockId) return false;
        try {
            if (isMobileDevice()) {
                if (typeof __openMobileFileById === 'function') {
                    __openMobileFileById(app, blockId);
                    return true;
                }
                return false;
            }
            if (typeof __openTab === 'function') {
                __openTab({ app, doc: { id: blockId } });
                return true;
            }
        } catch (e) {}
        return false;
    };

    globalThis.__dockTomato = {
        openSettings: () => showSettingsDialog(),
        openFocusSettings: () => showFocusTimeSettingsDialog(),
        openTimelineSettings: () => showTimelineSettingsDialog(),
        openHistory: (page) => showHistoryDialog(page),
    };
    
    // ========== 配置项 ==========
    const DEFAULT_TOMATO_DURATIONS = [5, 15, 30, 60, 120];
    const DEFAULT_BREAK_DURATIONS = [5, 10, 15, 30];

    const PLUGIN_STORAGE_PARENT_DIR = '/data/storage/petal';
    const PLUGIN_STORAGE_DIR = '/data/storage/petal/siyuan-plugin-docktomato';
    const LEGACY_HISTORY_FILE_PATH = '/data/storage/tomato-history.json';
    const LEGACY_SETTINGS_FILE_PATH = '/data/storage/tomato-settings.json';
    const LEGACY_FOCUS_TIME_SETTINGS_PATH = '/data/storage/tomato-focus-settings.json';
    const LEGACY_SYNC_FILE_PATH = '/data/storage/tomato-sync.json';
    const LEGACY_AUDIO_STORAGE_PATH = '/data/storage/tomato-audio/';

    const NEW_HISTORY_FILE_PATH = `${PLUGIN_STORAGE_DIR}/tomato-history.json`;
    const NEW_SETTINGS_FILE_PATH = `${PLUGIN_STORAGE_DIR}/tomato-settings.json`;
    const NEW_FOCUS_TIME_SETTINGS_PATH = `${PLUGIN_STORAGE_DIR}/tomato-focus-settings.json`;
    const NEW_SYNC_FILE_PATH = `${PLUGIN_STORAGE_DIR}/tomato-sync.json`;
    const NEW_AUDIO_STORAGE_PATH = `${PLUGIN_STORAGE_DIR}/tomato-audio/`;

    let HISTORY_FILE_PATH = NEW_HISTORY_FILE_PATH;
    let SETTINGS_FILE_PATH = NEW_SETTINGS_FILE_PATH;
    let FOCUS_TIME_SETTINGS_PATH = NEW_FOCUS_TIME_SETTINGS_PATH;
    let SYNC_FILE_PATH = NEW_SYNC_FILE_PATH;

    let AUDIO_STORAGE_PATH = NEW_AUDIO_STORAGE_PATH;
    const DEFAULT_DEBUG_MODE = false;
    const DEFAULT_ENABLE_MOBILE_SUPPORT = true;
    const MOBILE_FLOAT_BAR_LAZY_SHOW = true;  // 移动端悬浮条懒加载开关，false悬浮条常驻，设为 true 则悬浮条仅在开始计时后显示（从任务块或数据库块计时时）
    
    // ========== 多端同步配置 ==========
    const DEFAULT_SYNC_ENABLED = true;
    const SYNC_POLL_INTERVAL = 10000;  // 轮询同步间隔（毫秒），10秒
    const SYNC_DEVICE_ID = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);  // 本设备唯一标识
    
    // ========== 🔧 新增：全局常量配置 ==========
    const CONFIG = {
        TIMER_INTERVAL: 500, // 计时器更新频率 (ms)
        SYNC_POLL_INTERVAL_BG: 60000, // 后台轮询频率 (ms)
        MAX_STOPWATCH_SECONDS: 8 * 3600, // 正计时最大时长 (8小时)
    };

    function __tomatoNormalizeDirPath(path) {
        const p = String(path || '').trim();
        if (!p) return '';
        return p.endsWith('/') ? p.slice(0, -1) : p;
    }

    async function __tomatoMkdir(path) {
        const normalized = __tomatoNormalizeDirPath(path);
        if (!normalized) return false;
        const candidates = [normalized, `${normalized}/`];
        for (const candidate of candidates) {
            try {
                const r = await postJSON('/api/file/mkdir', { path: candidate });
                if (r?.ok && (r?.data == null || r?.data?.code === 0)) return true;
                if (r?.data?.code === 0) return true;
                const msg = String(r?.data?.msg || '').toLowerCase();
                if (r?.ok && (msg.includes('exist') || msg.includes('exists'))) return true;
            } catch (e) {}
            try {
                const formData = new FormData();
                formData.append('path', candidate);
                const response = await fetch('/api/file/mkdir', { method: 'POST', body: formData });
                const result = await response.json().catch(() => null);
                if (response.ok && (result == null || result?.code === 0)) return true;
                if (result?.code === 0) return true;
                const msg = String(result?.msg || '').toLowerCase();
                if (response.ok && (msg.includes('exist') || msg.includes('exists'))) return true;
            } catch (e) {}
        }
        return false;
    }

    async function __tomatoEnsureDir(path) {
        const normalized = __tomatoNormalizeDirPath(path);
        if (!normalized.startsWith('/')) return false;
        const parts = normalized.split('/').filter(Boolean);
        if (parts.length < 2) return false;
        let ok = true;
        for (let i = 2; i <= parts.length; i++) {
            const seg = `/${parts.slice(0, i).join('/')}`;
            const created = await __tomatoMkdir(seg);
            ok = ok && (created || true);
        }
        return ok;
    }

    async function __tomatoReadDir(path) {
        try {
            const r = await postJSON('/api/file/readDir', { path });
            if (r?.data?.code !== 0) return [];
            const payload = r.data?.data;
            if (Array.isArray(payload)) return payload;
            if (Array.isArray(payload?.files)) return payload.files;
            if (Array.isArray(payload?.items)) return payload.items;
            if (Array.isArray(payload?.children)) return payload.children;
            return [];
        } catch (e) {
            return [];
        }
    }

    async function __tomatoRenamePath(path, newPath) {
        try {
            const r = await postJSON('/api/file/renameFile', { path, newPath });
            if (r?.data?.code === 0) return true;
        } catch (e) {}
        return false;
    }

    async function __tomatoGetFileText(path) {
        try {
            const response = await fetch('/api/file/getFile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            if (!response.ok) return { exists: false, text: '' };
            const text = await response.text();
            try {
                const obj = safeJsonParse(text);
                if (obj && typeof obj === 'object' && typeof obj.code === 'number' && typeof obj.msg === 'string' && ('data' in obj) && obj.code !== 0) {
                    return { exists: false, text: '' };
                }
            } catch (e) {}
            return { exists: true, text: text ?? '' };
        } catch (e) {
            return { exists: false, text: '' };
        }
    }

    async function __tomatoSelectStoragePaths() {
        const tryParseJson = (text) => {
            try { return JSON.parse(String(text ?? '')); } catch (e) { return null; }
        };

        const hasMeaningfulSettings = (text) => {
            const obj = tryParseJson(text);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
            const keys = Object.keys(obj);
            if (keys.length === 0) return false;
            const likelyTomatoSettings = ('main' in obj) || ('appearance' in obj) || ('sync' in obj) || ('audioSettings' in obj);
            return likelyTomatoSettings;
        };

        const hasMeaningfulHistory = (text) => {
            const arr = tryParseJson(text);
            if (!Array.isArray(arr)) return false;
            return arr.length > 0;
        };

        const hasMeaningfulFocusSettings = (text) => {
            const obj = tryParseJson(text);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
            if (Array.isArray(obj.groups) && obj.groups.length > 0) return true;
            const keys = Object.keys(obj);
            if (keys.length === 0) return false;
            return ('enabled' in obj) || ('groups' in obj) || ('dailyFocusTargetMinutes' in obj);
        };

        const hasMeaningfulSync = (text) => {
            const obj = tryParseJson(text);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
            if (typeof obj.sequenceId === 'number') return true;
            return false;
        };

        const pick = async (legacyPath, newPath, validator) => {
            const legacy = await __tomatoGetFileText(legacyPath);
            if (legacy.exists && validator(legacy.text)) return legacyPath;
            return newPath;
        };

        SETTINGS_FILE_PATH = await pick(LEGACY_SETTINGS_FILE_PATH, NEW_SETTINGS_FILE_PATH, hasMeaningfulSettings);
        HISTORY_FILE_PATH = await pick(LEGACY_HISTORY_FILE_PATH, NEW_HISTORY_FILE_PATH, hasMeaningfulHistory);
        FOCUS_TIME_SETTINGS_PATH = await pick(LEGACY_FOCUS_TIME_SETTINGS_PATH, NEW_FOCUS_TIME_SETTINGS_PATH, hasMeaningfulFocusSettings);
        SYNC_FILE_PATH = await pick(LEGACY_SYNC_FILE_PATH, NEW_SYNC_FILE_PATH, hasMeaningfulSync);

        try {
            const legacyAudioEntries = await __tomatoReadDir(__tomatoNormalizeDirPath(LEGACY_AUDIO_STORAGE_PATH));
            AUDIO_STORAGE_PATH = (legacyAudioEntries && legacyAudioEntries.length > 0) ? LEGACY_AUDIO_STORAGE_PATH : NEW_AUDIO_STORAGE_PATH;
        } catch (e) {
            AUDIO_STORAGE_PATH = NEW_AUDIO_STORAGE_PATH;
        }
    }

    async function __tomatoPutFileText(path, text, contentType = 'application/json') {
        const formData = new FormData();
        formData.append('path', path);
        formData.append('isDir', 'false');
        formData.append('file', new Blob([text ?? ''], { type: contentType }));
        const response = await fetch('/api/file/putFile', { method: 'POST', body: formData });
        const result = await response.json().catch(() => null);
        return result?.code === 0;
    }

    async function __tomatoRemoveFile(path, isDir = null) {
        try {
            const formData = new FormData();
            formData.append('path', path);
            if (isDir === true) formData.append('isDir', 'true');
            if (isDir === false) formData.append('isDir', 'false');
            const response = await fetch('/api/file/removeFile', { method: 'POST', body: formData });
            const result = await response.json().catch(() => null);
            if (result?.code === 0) return true;
            const fallback = await postJSON('/api/file/removeFile', { path });
            return fallback?.data?.code === 0;
        } catch (e) {
            return false;
        }
    }

    async function ensureTomatoStorageMigration() {
        await __tomatoEnsureDir(PLUGIN_STORAGE_PARENT_DIR);
        await __tomatoEnsureDir(PLUGIN_STORAGE_DIR);
        await __tomatoSelectStoragePaths();

        try { await __tomatoEnsureDir(AUDIO_STORAGE_PATH); } catch (e) {}
    }

    async function cleanupTomatoFilesOnUninstall() {
        const deleteTargets = [
            FOCUS_TIME_SETTINGS_PATH,
            SYNC_FILE_PATH,
            LEGACY_FOCUS_TIME_SETTINGS_PATH,
            LEGACY_SYNC_FILE_PATH,
        ];

        for (const path of deleteTargets) {
            const exists = await __tomatoGetFileText(path);
            if (!exists.exists) continue;
            await __tomatoRemoveFile(path);
        }
    }
    
    // ========== 番茄钟同步状态数据结构 ==========
    // 使用绝对时间模型，支持跨设备同步
    let syncState = {
        mode: 'countdown',  // 'countdown' | 'stopwatch' | 'break'
        duration: 30,  // 总时长（秒）
        status: 'IDLE',  // 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
        startTime: null,  // UTC时间戳，计时开始时间
        stopwatchStartTimeMs: null,  // 正计时开始时间戳（毫秒）
        pausedElapsedSeconds: null,  // 暂停时的正计时已运行秒数
        pausedIntervals: [],  // [{start: ts, end: ts}, ...]
        currentPauseStart: null,  // 当前暂停开始时间
        sequenceId: 0,  // 序列号，单调递增用于冲突解决
        lastModifiedDevice: '',  // 最后修改设备ID
        lastModifiedTime: 0,  // 最后修改时间
        taskBlockId: null,  // 关联的任务块ID
        taskBlockName: null,  // 关联的任务块名称
        databaseBlockId: null,  // 关联的数据库块ID
    };
    
    // ========== 同步管理器 ==========
    // 负责多端同步的状态管理和冲突解决
    const SyncManager = {
        localState: null,
        remoteState: null,
        pollTimer: null,
        onStateChange: null,
        lastPollTime: 0,
        _lastSyncTime: 0, // 🔧 v9.5: 记录上次触发思源同步的时间
        
        async init(initialState, onChangeCallback) {
            this.localState = JSON.parse(JSON.stringify(initialState));
            this.onStateChange = onChangeCallback;
            
            const cloudState = await this.loadFromCloud();
            let stateRestored = false;
            
            if (cloudState) {
                const isValidCloudState = cloudState.startTime && cloudState.status !== 'IDLE';
                
                if (isValidCloudState) {
                    if (this.localState.status === 'IDLE' || !this.localState.startTime) {
                        this.localState = cloudState;
                        stateRestored = true;
                        Logger.info('🔄 SyncManager: 从云端恢复状态', {
                            status: cloudState.status,
                            mode: cloudState.mode,
                            sequenceId: cloudState.sequenceId
                        });
                    } else if (this.compareStates(cloudState, this.localState) > 0) {
                        this.localState = cloudState;
                        stateRestored = true;
                        Logger.info('🔄 SyncManager: 从云端恢复状态（序列号更高）');
                    }
                }
            }
            
            if (this.onStateChange) {
                this.onStateChange(this.localState);
            }
            
            this.startPolling();
            
            return { state: this.localState, restored: stateRestored };
        },
        
        async loadFromCloud() {
            try {
                Logger.info('🔄 SyncManager: 尝试从云端加载状态，路径:', SYNC_FILE_PATH);
                let response = await fetch('/api/file/getFile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: SYNC_FILE_PATH }),
                });
                Logger.info('🔄 SyncManager: 云端响应状态:', response.status, response.ok);
                
                if (response.ok) {
                    const text = await response.text();
                    Logger.info('🔄 SyncManager: 云端返回内容长度:', text?.length || 0);
                    if (text && text.trim()) {
                        try {
                            const state = JSON.parse(text);
                            if (state && typeof state.sequenceId === 'number') {
                                Logger.info('🔄 SyncManager: 从云端加载状态成功，sequenceId:', state.sequenceId, ', status:', state.status, ', mode:', state.mode);
                                return state;
                            } else {
                                Logger.warn('🔄 SyncManager: 云端状态格式不正确，缺少 sequenceId');
                            }
                        } catch (parseError) {
                            Logger.warn('🔄 SyncManager: 解析云端状态失败', parseError.message);
                        }
                    } else {
                        Logger.info('🔄 SyncManager: 云端文件为空或不存在');
                    }
                } else {
                    Logger.warn('🔄 SyncManager: 云端响应失败，状态码:', response.status);
                }
            } catch (e) {
                Logger.warn('🔄 SyncManager: 加载云端状态失败', e.message);
            }
            return null;
        },
        
        async saveToCloud(state = null) {
            const targetState = state || this.localState;
            if (!targetState) {
                Logger.warn('🔄 SyncManager: 保存失败，状态为空');
                return false;
            }
            
            try {
                Logger.info('🔄 SyncManager: 保存状态到云端，sequenceId:', targetState.sequenceId, ', status:', targetState.status);
                try { await __tomatoEnsureDir(PLUGIN_STORAGE_DIR); } catch (e) {}
                const formData = new FormData();
                formData.append('path', SYNC_FILE_PATH);
                formData.append('isDir', 'false');
                formData.append('file', new Blob([JSON.stringify(targetState, null, 2)], { type: 'application/json' }));
                
                const response = await fetch('/api/file/putFile', { method: 'POST', body: formData });
                const result = await response.json();
                
                if (result.code === 0) {
                    Logger.info('🔄 SyncManager: 状态已保存到云端');
                    
                    // 🔧 v9.5: 保存成功后尝试触发思源笔记的数据同步
                    // 这样可以确保状态文件尽快同步到其他设备
                    this.triggerSiyuanSync();
                    
                    return true;
                } else {
                    Logger.warn('🔄 SyncManager: 保存失败，错误码:', result.code, ', 消息:', result.msg);
                }
            } catch (e) {
                Logger.warn('🔄 SyncManager: 保存云端状态失败', e.message);
            }
            return false;
        },

        // 🔧 v9.5: 尝试触发思源笔记的云端同步
        async triggerSiyuanSync() {
            try {
                // 检查配置是否开启（默认开启）
                if (userSettings.sync && userSettings.sync.autoTriggerSiyuanSync === false) {
                    // Logger.debug('🔄 SyncManager: 自动触发思源同步已关闭，跳过');
                    return;
                }

                // 节流：10秒内最多触发一次，避免频繁请求
                const now = Date.now();
                const MIN_SYNC_INTERVAL = 10000;
                
                if (this._lastSyncTime && now - this._lastSyncTime < MIN_SYNC_INTERVAL) {
                    // Logger.debug('🔄 SyncManager: 同步请求过于频繁，跳过触发思源同步');
                    return;
                }
                this._lastSyncTime = now;

                Logger.info('🔄 SyncManager: 尝试触发思源笔记云端同步...');
                
                // 尝试调用思源同步 API
                // /api/sync/performSync 是常见的同步触发接口
                const response = await fetch('/api/sync/performSync', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                
                if (response.ok) {
                    Logger.info('✅ SyncManager: 已触发思源笔记同步');
                } else {
                    // 如果API不存在，可能是旧版本或路径不同，不报错
                    Logger.debug('⚠️ SyncManager: 触发同步 API 返回非 200 状态:', response.status);
                }
            } catch (e) {
                // 忽略网络错误，不影响主功能
                Logger.debug('⚠️ SyncManager: 触发思源同步请求失败', e);
            }
        },
        
        compareStates(stateA, stateB) {
            if (!stateA || !stateB) return 0;
            
            // 🔧 v9.0 修复：优先比较 sequenceId，但如果相等则比较 lastModifiedTime
            const seqDiff = (stateA.sequenceId || 0) - (stateB.sequenceId || 0);
            if (seqDiff !== 0) return seqDiff;
            
            // sequenceId 相等时，比较 lastModifiedTime
            return (stateA.lastModifiedTime || 0) - (stateB.lastModifiedTime || 0);
        },
        
        async updateLocal(newState, forcePush = true) {
            const hasActualChange = this.checkStateChanged(this.localState, newState);
            
            const oldSequenceId = this.localState.sequenceId;
            this.localState = { ...this.localState, ...newState };
            
            this.localState.lastModifiedDevice = SYNC_DEVICE_ID;
            this.localState.lastModifiedTime = Date.now();
            
            if (hasActualChange && this.localState.sequenceId === oldSequenceId) {
                this.localState.sequenceId++;
            }
            
            Logger.debug('🔄 SyncManager: 本地状态更新，sequenceId:', this.localState.sequenceId);
            
            if (forcePush) {
                await this.saveToCloud();
            }
            
            if (this.onStateChange) {
                this.onStateChange(this.localState);
            }
            
            return this.localState;
        },
        
        checkStateChanged(currentState, newState) {
            if (!currentState || !newState) return true;
            
            const keyFields = ['status', 'startTime', 'mode', 'duration', 'taskBlockId', 'taskBlockName', 'databaseBlockId'];
            
            for (const field of keyFields) {
                if (currentState[field] !== newState[field]) {
                    return true;
                }
            }
            
            const currentPausedStr = JSON.stringify(currentState.pausedIntervals || []);
            const newPausedStr = JSON.stringify(newState.pausedIntervals || []);
            if (currentPausedStr !== newPausedStr) {
                return true;
            }
            
            if (currentState.currentPauseStart !== newState.currentPauseStart) {
                return true;
            }
            
            return false;
        },
        
        async applyRemote(remoteState) {
            if (!remoteState) return this.localState;

            // 🔧 新增：处理远端处于 IDLE 状态的情况
            // 如果远端是 IDLE 且本地正在运行，说明远端重置了，需要同步停止
            if (remoteState.status === 'IDLE' && this.localState.status === 'RUNNING') {
                Logger.info('🔄 SyncManager: 远端已重置（IDLE），同步停止本地计时器');
                
                if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.pollTimer = null;
                }
                
                this.localState = {
                    ...this.localState,
                    status: 'IDLE',
                    startTime: null,
                    stopwatchStartTimeMs: null,
                    pausedElapsedSeconds: null,
                    pausedIntervals: [],
                    currentPauseStart: null,
                    sequenceId: remoteState.sequenceId,
                    lastModifiedDevice: remoteState.lastModifiedDevice,
                    lastModifiedTime: remoteState.lastModifiedTime
                };
                
                if (this.onStateChange) {
                    this.onStateChange(this.localState);
                }
                
                return this.localState;
            }

            if (remoteState.status === 'RUNNING' && remoteState.startTime > 0) {
                // 🔧 修复：正计时模式使用 elapsed 判断，最长 8 小时
                const isStopwatchMode = remoteState.mode === 'stopwatch' || remoteState.mode === 'stopwatch-break';
                const remaining = StateCalculator.calculateRemaining(remoteState);
                const elapsed = StateCalculator.calculateElapsed(remoteState);
                const MAX_STOPWATCH_SECONDS = 8 * 3600;
                
                const isExpired = isStopwatchMode ? (elapsed >= MAX_STOPWATCH_SECONDS) : (remaining <= 0);
                if (isExpired) {
                    remoteState.status = 'COMPLETED';
                    Logger.info('🔄 SyncManager: 检测到远端计时已过期，标记为完成');
                }
            }

            const comparison = this.compareStates(remoteState, this.localState);
            
            // 🔧 v9.0 修复：如果远端 lastModifiedTime 更新，即使 sequenceId 更低也应该接受
            const remoteIsNewer = (remoteState.lastModifiedTime || 0) > (this.localState.lastModifiedTime || 0);
            const shouldAcceptRemote = comparison > 0 || (comparison < 0 && remoteIsNewer && remoteState.lastModifiedDevice !== SYNC_DEVICE_ID);
            
            if (shouldAcceptRemote) {
                if (this.localState.status === 'RUNNING' && remoteState.status === 'RUNNING') {
                    // 🔧 修复：如果两边都在运行，且是同一设备发起的，只更新状态不触发回调
                    if (remoteState.lastModifiedDevice === SYNC_DEVICE_ID) {
                        this.localState = remoteState;
                        return this.localState;
                    }
                    // 🔧 v9.0 修复：两边都在运行但不是同一设备时，应该触发回调更新UI
                    this.localState = remoteState;
                    if (this.onStateChange) {
                        this.onStateChange(this.localState);
                    }
                    return this.localState;
                }
                
                this.localState = remoteState;
                
                if (this.onStateChange) {
                    this.onStateChange(this.localState);
                }
                
                return this.localState;
            } else if (comparison < 0 && !remoteIsNewer) {
                // 只有当本地确实更新时才上传
                await this.saveToCloud();
            } else {
                // 🔧 修复：sequenceId 相同时，如果是本地设备发起的更新，跳过
                if (remoteState.lastModifiedDevice === SYNC_DEVICE_ID) {
                    this.localState = remoteState;
                    return this.localState;
                }
                
                if (remoteState.lastModifiedTime > this.localState.lastModifiedTime) {
                    this.localState = remoteState;
                    
                    if (this.onStateChange) {
                        this.onStateChange(this.localState);
                    }
                }
            }
            
            return this.localState;
        },
        
        startPolling() {
            if (!isSyncEnabled()) return;
            this.stopPolling();

            this.poll(true);
            this.pollTimer = setInterval(() => this.poll(), SYNC_POLL_INTERVAL);
            try {
                if (this._visibilityHandler) {
                    document.removeEventListener('visibilitychange', this._visibilityHandler, true);
                }
                this._visibilityHandler = () => {
                    try {
                        if (!document.hidden && isSyncEnabled()) {
                            this.poll(true);
                        }
                    } catch (e) {}
                };
                document.addEventListener('visibilitychange', this._visibilityHandler, true);
            } catch (e) {}
            Logger.debug('🔄 SyncManager: 轮询已启动');
        },
        
        stopPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
                Logger.debug('🔄 SyncManager: 轮询已停止');
            }
        },
        
        async poll(force = false) {
            if (!isSyncEnabled()) return;
            
            // 🔧 性能优化：页面不可见时降低轮询频率
            const isHidden = document.hidden;
            const pollInterval = isHidden ? SYNC_POLL_INTERVAL * 6 : SYNC_POLL_INTERVAL; // 不可见时 60秒一次
            
            const now = Date.now();
            if (!force && now - this.lastPollTime < pollInterval) {
                return;
            }
            this.lastPollTime = now;
            
            try {
                const remoteState = await this.loadFromCloud();
                if (remoteState) {
                    await this.applyRemote(remoteState);
                }
            } catch (e) {
                Logger.debug('🔄 SyncManager: 轮询检查完成');
            }
        },
        
        getState() {
            return this.localState;
        },
        
        getSequenceId() {
            return this.localState?.sequenceId || 0;
        },
        
        isRunning() {
            return this.localState?.status === 'RUNNING';
        },
        
        isPaused() {
            return this.localState?.status === 'PAUSED';
        },
        
        destroy() {
            this.stopPolling();
            this.localState = null;
            this.onStateChange = null;
            try {
                if (this._visibilityHandler) {
                    document.removeEventListener('visibilitychange', this._visibilityHandler, true);
                    this._visibilityHandler = null;
                }
            } catch (e) {}
            Logger.info('🔄 SyncManager: 资源已清理');
        }
    };
    
    // ========== 状态计算器 ==========
    // 基于绝对时间计算剩余时间，不依赖本地递减
    const StateCalculator = {
        calculateRemaining(state) {
            if (!state || state.status === 'IDLE' || state.status === 'COMPLETED') {
                return state?.duration || 0;
            }
            
            if (state.status === 'PAUSED') {
                const totalPausedBefore = this.calculateTotalPausedTime(state.pausedIntervals || []);
                const pausedSoFar = (state.currentPauseStart - state.startTime) - totalPausedBefore;
                return Math.max(0, state.duration - Math.floor(pausedSoFar / 1000));
            }
            
            const now = Date.now();
            const totalPausedTime = this.calculateTotalPausedTime(state.pausedIntervals || []);
            const elapsed = (now - state.startTime) - totalPausedTime;
            const remaining = Math.floor(state.duration - (elapsed / 1000));
            
            return Math.max(0, remaining);
        },
        
        calculateTotalPausedTime(pausedIntervals) {
            if (!Array.isArray(pausedIntervals)) return 0;
            
            return pausedIntervals.reduce((total, interval) => {
                if (interval && typeof interval.start === 'number' && typeof interval.end === 'number') {
                    return total + (interval.end - interval.start);
                }
                return total;
            }, 0);
        },
        
        calculateElapsed(state) {
            if (!state) return 0;

            if (state.mode === 'stopwatch') {
                const now = Date.now();
                const totalPausedTime = this.calculateTotalPausedTime(state.pausedIntervals || []);
                
                if (state.status === 'PAUSED') {
                    if (state.pausedElapsedSeconds !== null && state.pausedElapsedSeconds !== undefined) {
                        return Math.min(state.pausedElapsedSeconds, 8 * 3600);
                    }
                    if (state.startTime && state.startTime > 0) {
                        const elapsedMs = (state.currentPauseStart - state.startTime) - totalPausedTime;
                        const elapsed = Math.floor(elapsedMs / 1000);
                        return Math.min(Math.max(0, elapsed), 8 * 3600);
                    }
                    return 0;
                }

                if (state.startTime && state.startTime > 0) {
                    const elapsedMs = (now - state.startTime) - totalPausedTime;
                    const elapsed = Math.floor(elapsedMs / 1000);
                    return Math.min(elapsed, 8 * 3600);
                }

                if (state.pausedElapsedSeconds !== null && state.pausedElapsedSeconds !== undefined) {
                    return Math.min(state.pausedElapsedSeconds, 8 * 3600);
                }

                return 0;
            }

            const remaining = this.calculateRemaining(state);
            return Math.max(0, state.duration - remaining);
        },
        
        isExpired(state) {
            if (!state || state.status !== 'RUNNING') return false;
            return this.calculateRemaining(state) <= 0;
        },
        
        calculateCurrentPauseDuration(state) {
            if (!state || state.status !== 'PAUSED' || !state.currentPauseStart) {
                return 0;
            }
            return Date.now() - state.currentPauseStart;
        },
        
        formatTime(seconds, showHours = false) {
            seconds = Math.max(0, Math.floor(seconds || 0));
            
            if (showHours || seconds >= 3600) {
                const hours = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            }
            
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    };
    
    // ========== 从同步状态更新本地变量 ==========
    function updateFromSyncState() {
        if (!syncState) return;
        
        // 更新模式
        if (syncState.mode) {
            if (syncState.mode === 'break' || syncState.mode === 'stopwatch-break') {
                timerMode = syncState.mode;
            } else if (syncState.mode === 'stopwatch') {
                timerMode = 'stopwatch';
            } else {
                timerMode = 'countdown';
            }
        }
        
        // 更新时长
        if (syncState.duration) {
            currentDuration = Math.round(syncState.duration / 60);
            // 🔧 修复：计算实际剩余时间，而不是直接使用总时长
            if (syncState.status === 'RUNNING' && syncState.startTime) {
                // 使用 StateCalculator 计算实际剩余时间
                remainingSeconds = StateCalculator.calculateRemaining(syncState);
            } else if (syncState.status === 'PAUSED') {
                // 暂停状态使用保存的剩余时间
                remainingSeconds = StateCalculator.calculateRemaining(syncState);
            } else {
                // IDLE 状态使用总时长
                remainingSeconds = syncState.duration;
            }
        }
        
        // 更新开始时间
        if (syncState.startTime) {
            startTime = syncState.startTime;
        }

        if (timerMode === 'stopwatch') {
            const syncedStart = syncState.stopwatchStartTimeMs || syncState.startTime || 0;
            if (syncedStart) {
                stopwatchStartTimeMs = syncedStart;
                startTime = syncedStart;
            }

            elapsedSeconds = StateCalculator.calculateElapsed(syncState);
            if (syncState.status === 'PAUSED' && syncState.pausedElapsedSeconds !== null && syncState.pausedElapsedSeconds !== undefined) {
                elapsedSeconds = Math.min(syncState.pausedElapsedSeconds, 8 * 3600);
            }

            if (syncState.currentPauseStart) {
                currentPauseStart = syncState.currentPauseStart;
            }
        }
        
        // 更新任务关联
        if (syncState.taskBlockId !== undefined) {
            currentTaskBlockId = syncState.taskBlockId;
        }
        if (syncState.taskBlockName !== undefined) {
            currentTaskBlockName = syncState.taskBlockName;
        }
        if (syncState.databaseBlockId !== undefined) {
            currentDatabaseBlockId = syncState.databaseBlockId;
        }
        
        // 更新暂停记录
        if (syncState.pausedIntervals) {
            stopwatchPausedIntervals = syncState.pausedIntervals;
        }
        
        // 更新当前暂停开始时间
        if (syncState.currentPauseStart) {
            currentPauseStart = syncState.currentPauseStart;
        }
        
        Logger.debug('updateFromSyncState: 已从同步状态更新本地变量', {
            timerMode,
            currentDuration,
            startTime
        });
    }
    
    // ========== 正计时模式专用状态 ==========
    let stopwatchStartTimeMs = 0;
    let stopwatchPausedIntervals = [];
    let currentPauseStart = null;
    let stopwatchDisplayOffset = 0;  // 🔧 休息前的时间，用于显示偏移
    
    const TIME_PERIODS = {
        'night': '凌晨',
        'morning': '上午',
        'afternoon': '下午',
        'evening': '晚上'
    };

    const TIME_PERIOD_ORDER = ['night', 'morning', 'afternoon', 'evening'];
    
    // ========== 音频配置 ==========
    // 提示音文件路径配置（存储在 /data/storage/petal/siyuan-plugin-docktomato/tomato-audio/ 目录下）
    
    // ========== 音频配置对象（从文件加载）
    let audioSettings = null;
    
    // 音频对象
    let workEndAudio = null;
    let breakEndAudio = null;
    
    // ========== 统一日志输出系统 ==========
    // 支持日志级别控制，提供结构化日志输出
    const Logger = {
        // 日志级别：debug=0, info=1, warn=2, error=3, off=99
        level: 99,
        levels: { debug: 0, info: 1, warn: 2, error: 3, off: 99 },
        prefix: '🍅',

        setDebugEnabled(enabled) {
            this.level = enabled ? 0 : 99;
        },

        /**
         * 设置日志级别
         * @param {string|number} level - 级别名称或数值
         */
        setLevel(level) {
            if (typeof level === 'string') {
                this.level = this.levels[level] ?? 1;
            } else {
                this.level = level;
            }
        },

        /**
         * 获取当前时间戳
         * @returns {string} 格式化的时间戳
         */
        getTimestamp() {
            const now = new Date();
            return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
        },

        /**
         * 调试日志（级别0）
         */
        debug(...args) {
            if (this.level <= 0) {
                console.debug(this.prefix, `[${this.getTimestamp()}]`, ...args);
            }
        },

        /**
         * 信息日志（级别1）
         */
        info(...args) {
            if (this.level <= 1) {
                console.info(this.prefix, `[${this.getTimestamp()}]`, ...args);
            }
        },

        /**
         * 警告日志（级别2）
         */
        warn(...args) {
            if (this.level <= 2) {
                console.warn(this.prefix, `[${this.getTimestamp()}]`, ...args);
            }
        },

        /**
         * 错误日志（级别3）
         */
        error(...args) {
            if (this.level <= 3) {
                console.error(this.prefix, `[${this.getTimestamp()}]`, ...args);
            }
        },

        /**
         * 分组日志开始
         */
        group(label) {
            if (this.level <= 0) {
                console.group(this.prefix, label);
            }
        },

        /**
         * 分组日志结束
         */
        groupEnd() {
            if (this.level <= 0) {
                console.groupEnd();
            }
        },

        /**
         * 性能计时开始
         * @param {string} label - 计时标签
         */
        time(label) {
            if (this.level <= 0) {
                console.time(`${this.prefix} ${label}`);
            }
        },

        /**
         * 性能计时结束
         * @param {string} label - 计时标签
         */
        timeEnd(label) {
            if (this.level <= 0) {
                console.timeEnd(`${this.prefix} ${label}`);
            }
        }
    };

    // ========== 统一事件监听器管理器 ==========
    // 跟踪并管理所有事件监听器，确保正确清理避免内存泄漏
    const EventManager = {
        // 存储所有注册的监听器 { id: { element, event, handler, options, context } }
        listeners: new Map(),
        // 监听器ID计数器
        counter: 0,

        /**
         * 添加事件监听器
         * @param {Element|Window|Document} element - 事件目标元素
         * @param {string} event - 事件类型
         * @param {Function} handler - 事件处理函数
         * @param {Object} options - 选项（可选）
         * @param {string} context - 上下文标识（用于调试）
         * @returns {string} 监听器ID
         */
        add(element, event, handler, options = {}, context = '') {
            if (!element || !event || typeof handler !== 'function') {
                Logger.warn('EventManager.add: 无效的参数', { element, event, context });
                return null;
            }

            const id = `evt_${++this.counter}_${Date.now()}`;
            const listenerInfo = {
                id,
                element,
                event,
                handler,
                options: typeof options === 'object' ? options : { capture: !!options },
                context,
                timestamp: Date.now()
            };

            this.listeners.set(id, listenerInfo);
            element.addEventListener(event, handler, listenerInfo.options);

            Logger.debug(`事件监听器已注册 [${id}]: ${event}`, context);
            return id;
        },

        /**
         * 移除事件监听器
         * @param {string} id - 监听器ID
         * @returns {boolean} 是否成功移除
         */
        remove(id) {
            const listenerInfo = this.listeners.get(id);
            if (!listenerInfo) {
                Logger.warn(`EventManager.remove: 监听器不存在 [${id}]`);
                return false;
            }

            const { element, event, handler, options } = listenerInfo;
            element.removeEventListener(event, handler, options);
            this.listeners.delete(id);

            Logger.debug(`事件监听器已移除 [${id}]: ${event}`);
            return true;
        },

        /**
         * 根据上下文移除所有监听器
         * @param {string} context - 上下文标识
         * @returns {number} 移除的监听器数量
         */
        removeByContext(context) {
            let count = 0;
            for (const [id, info] of this.listeners) {
                if (info.context === context) {
                    this.remove(id);
                    count++;
                }
            }
            if (count > 0) {
                Logger.info(`已移除 ${count} 个 [${context}] 相关的事件监听器`);
            }
            return count;
        },

        /**
         * 移除特定元素的所有监听器
         * @param {Element|Window|Document} element - 目标元素
         * @returns {number} 移除的监听器数量
         */
        removeByElement(element) {
            let count = 0;
            for (const [id, info] of this.listeners) {
                if (info.element === element) {
                    this.remove(id);
                    count++;
                }
            }
            return count;
        },

        /**
         * 移除特定事件类型的所有监听器
         * @param {string} event - 事件类型
         * @returns {number} 移除的监听器数量
         */
        removeByEvent(event) {
            let count = 0;
            for (const [id, info] of this.listeners) {
                if (info.event === event) {
                    this.remove(id);
                    count++;
                }
            }
            return count;
        },

        /**
         * 移除所有监听器
         * @returns {number} 移除的监听器数量
         */
        removeAll() {
            const count = this.listeners.size;
            for (const id of this.listeners.keys()) {
                this.remove(id);
            }
            Logger.info(`已移除所有 ${count} 个事件监听器`);
            return count;
        },

        /**
         * 获取监听器数量
         * @returns {number} 监听器数量
         */
        getCount() {
            return this.listeners.size;
        },

        /**
         * 获取所有监听器信息（用于调试）
         * @returns {Array} 监听器信息数组
         */
        getAll() {
            return Array.from(this.listeners.values()).map(info => ({
                id: info.id,
                event: info.event,
                context: info.context,
                timestamp: new Date(info.timestamp).toLocaleString()
            }));
        },

        /**
         * 检查元素是否有特定事件的监听器
         * @param {Element|Window|Document} element - 目标元素
         * @param {string} event - 事件类型
         * @returns {boolean} 是否有监听器
         */
        hasListener(element, event) {
            for (const info of this.listeners.values()) {
                if (info.element === element && info.event === event) {
                    return true;
                }
            }
            return false;
        },

        /**
         * 添加一次性事件监听器（自动移除）
         * @param {Element|Window|Document} element - 事件目标元素
         * @param {string} event - 事件类型
         * @param {Function} handler - 事件处理函数
         * @param {Object} options - 选项（可选）
         * @param {string} context - 上下文标识（可选）
         * @returns {string} 监听器ID
         */
        one(element, event, handler, options = {}, context = '') {
            const wrapper = (e) => {
                handler(e);
                this.remove(id);
            };
            const id = this.add(element, event, wrapper, options, context);
            return id;
        },

        /**
         * 添加文档点击监听器（带自动清理）
         * @param {Function} handler - 事件处理函数
         * @param {string} context - 上下文标识
         * @returns {string} 监听器ID
         */
        addDocumentClick(handler, context = '') {
            return this.add(document, 'click', handler, true, context);
        },

        /**
         * 添加文档键盘监听器（带自动清理）
         * @param {Function} handler - 事件处理函数
         * @param {string} context - 上下文标识
         * @returns {string} 监听器ID
         */
        addDocumentKeydown(handler, context = '') {
            return this.add(document, 'keydown', handler, false, context);
        },

        /**
         * 添加窗口大小变化监听器（带自动清理）
         * @param {Function} handler - 事件处理函数
         * @param {string} context - 上下文标识
         * @returns {string} 监听器ID
         */
        addWindowResize(handler, context = '') {
            return this.add(window, 'resize', handler, false, context);
        },

        /**
         * 添加窗口卸载监听器（带自动清理）
         * @param {Function} handler - 事件处理函数
         * @param {string} context - 上下文标识
         * @returns {string} 监听器ID
         */
        addWindowBeforeUnload(handler, context = '') {
            return this.add(window, 'beforeunload', handler, false, context);
        }
    };

    // ========== 统一错误处理系统 ==========
    // 提供分类错误处理、用户友好的错误提示和错误日志
    const ErrorHandler = {
        // 错误类型分类
        types: {
            NETWORK: 'network',
            PARAMETER: 'parameter',
            PERMISSION: 'permission',
            API: 'api',
            PARSE: 'parse',
            TIMEOUT: 'timeout',
            UNKNOWN: 'unknown'
        },

        // 用户提示消息模板
        messages: {
            network: '网络连接异常，请检查网络设置',
            parameter: '参数错误，请稍后重试',
            permission: '权限不足，无法执行此操作',
            api: '服务暂时不可用，请稍后重试',
            parse: '数据处理异常，请稍后重试',
            timeout: '请求超时，请稍后重试',
            unknown: '发生未知错误，请稍后重试'
        },

        /**
         * 根据错误特征分类错误类型
         * @param {Error|Object} error - 错误对象
         * @returns {string} 错误类型
         */
        classify(error) {
            const message = error?.message || String(error);

            if (message.includes('fetch') || message.includes('network') || message.includes('Failed to fetch')) {
                return this.types.NETWORK;
            }
            if (message.includes('timeout') || message.includes('timed out')) {
                return this.types.TIMEOUT;
            }
            if (message.includes('permission') || message.includes('denied') || message.includes('access')) {
                return this.types.PERMISSION;
            }
            if (message.includes('API') || message.includes('code') || message.includes('response')) {
                return this.types.API;
            }
            if (message.includes('JSON') || message.includes('parse') || message.includes('SyntaxError')) {
                return this.types.PARSE;
            }
            if (message.includes('Invalid') || message.includes('undefined') || message.includes('null')) {
                return this.types.PARAMETER;
            }

            return this.types.UNKNOWN;
        },

        /**
         * 获取错误类型的用户友好提示
         * @param {string} type - 错误类型
         * @returns {string} 提示消息
         */
        getMessage(type) {
            return this.messages[type] || this.messages[this.types.UNKNOWN];
        },

        /**
         * 处理错误并记录日志
         * @param {Error|Object} error - 错误对象
         * @param {string} context - 错误上下文
         * @param {Object} metadata - 附加元数据
         * @returns {Object} 处理结果
         */
        handle(error, context = '', metadata = {}) {
            const type = this.classify(error);
            const timestamp = new Date().toISOString();
            const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 构建错误信息对象
            const errorInfo = {
                id: errorId,
                type,
                message: error?.message || String(error),
                stack: error?.stack,
                context,
                metadata,
                timestamp
            };

            // 根据级别输出日志
            if (type === this.types.NETWORK || type === this.types.TIMEOUT) {
                Logger.warn(`[${errorId}] ${context}:`, errorInfo.message);
            } else if (type === this.types.API) {
                Logger.warn(`[${errorId}] ${context}:`, errorInfo.message, metadata);
            } else {
                Logger.error(`[${errorId}] ${context}:`, errorInfo);
            }

            return {
                handled: true,
                errorId,
                type,
                userMessage: this.getMessage(type)
            };
        },

        /**
         * 异步处理错误（用于API调用）
         * @param {Error|Object} error - 错误对象
         * @param {string} context - 错误上下文
         * @param {Object} metadata - 附加元数据
         * @returns {Promise<Object>} 处理结果
         */
        async handleAsync(error, context = '', metadata = {}) {
            return Promise.resolve(this.handle(error, context, metadata));
        },

        /**
         * 显示用户友好的错误提示
         * @param {string} message - 错误消息
         * @param {string} title - 标题（可选）
         */
        showUserNotification(message, title = '提示') {
            if (typeof showToastDialog === 'function') {
                showToastDialog(title, message, 'error');
            } else {
                alert(`${title}: ${message}`);
            }
        },

        /**
         * 安全执行函数，捕获并处理错误
         * @param {Function} fn - 要执行的函数
         * @param {string} context - 错误上下文
         * @param {Object} options - 选项
         * @returns {*} 函数执行结果或undefined
         */
        safeExecute(fn, context = '', options = {}) {
            const { defaultReturn = undefined, showError = false } = options;

            try {
                const result = fn();
                // 处理Promise
                if (result && typeof result.then === 'function') {
                    return result.catch(error => {
                        const handled = this.handle(error, context);
                        if (showError) {
                            this.showUserNotification(handled.userMessage);
                        }
                        return defaultReturn;
                    });
                }
                return result;
            } catch (error) {
                const handled = this.handle(error, context);
                if (showError) {
                    this.showUserNotification(handled.userMessage);
                }
                return defaultReturn;
            }
        },

        /**
         * 创建包装后的异步函数，自动处理错误
         * @param {Function} fn - 原始异步函数
         * @param {string} context - 错误上下文
         * @param {Object} options - 选项
         * @returns {Function} 包装后的函数
         */
        wrapAsync(fn, context = '', options = {}) {
            const { defaultReturn = null, showError = false } = options;

            return async (...args) => {
                try {
                    return await fn(...args);
                } catch (error) {
                    const handled = this.handle(error, context, { args });
                    if (showError) {
                        this.showUserNotification(handled.userMessage);
                    }
                    return defaultReturn;
                }
            };
        }
    };
    
    // ========== 日期格式化工具 ==========
    function formatDateKey(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function toDateSafe(input) {
        if (input == null) return new Date(NaN);
        if (input instanceof Date) return input;
        if (typeof input === 'number') return new Date(input);
        const raw = String(input);
        if (raw.includes(' ') && !raw.includes('T')) {
            return new Date(raw.replace(' ', 'T'));
        }
        return new Date(raw);
    }

    function normalizeLegacyDate(dateStr) {
        if (!dateStr) return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            return dateStr.slice(0, 10);
        }
        if (dateStr.includes('T') || dateStr.includes(' ')) {
            return formatDateKey(toDateSafe(dateStr));
        }
        if (dateStr.includes('/') || (dateStr.includes('-') && dateStr.split('-')[1].length === 1)) {
            return formatDateKey(new Date(dateStr.split('/').join('-')));
        }
        return dateStr;
    }

    // ========== 专注目标时间管理 ==========
    // 将分钟转换为易读格式
    function formatFocusTargetTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        if (hours > 0 && mins > 0) {
            return `${hours}小时${mins}分钟`;
        } else if (hours > 0) {
            return `${hours}小时`;
        } else {
            return `${mins}分钟`;
        }
    }

    // 将易读格式转换为分钟（支持小数小时）
    function parseFocusTargetTime(timeStr) {
        // 支持小数：4.5小时、4.5
        const decimalHoursMatch = timeStr.match(/([\d.]+)\s*小时/);
        const decimalMatch = /^([\d.]+)$/.test(timeStr.trim());
        
        // 匹配小时（支持整数和小数）
        const hoursMatch = timeStr.match(/(\d+(?:\.\d+)?)\s*小时/);
        // 匹配分钟
        const minsMatch = timeStr.match(/(\d+)\s*分钟/);
        
        let hours = 0;
        let mins = 0;
        
        if (hoursMatch) {
            hours = parseFloat(hoursMatch[1]) || 0;
        }
        if (minsMatch) {
            mins = parseInt(minsMatch[1]) || 0;
        }
        
        // 如果只输入了数字（支持小数），默认按小时计算
        if (decimalMatch && !hoursMatch && !minsMatch) {
            const num = parseFloat(timeStr.trim()) || 0;
            if (num > 0) {
                return Math.round(num * 60);
            }
        }
        
        return Math.round(hours * 60 + mins);
    }
    
    let userSettings = {
        main: {
            tomatoDurations: DEFAULT_TOMATO_DURATIONS,
            breakDurations: DEFAULT_BREAK_DURATIONS,
            debugMode: DEFAULT_DEBUG_MODE,
            enableMobileSupport: DEFAULT_ENABLE_MOBILE_SUPPORT
        },
        showBreakRecords: true,
        groupByTimePeriod: true,
        hideShortRecords: true,
        mergeSameTaskRecords: true,  // 默认开启合并相同任务时间功能
        deleteWithoutConfirm: false,  // 删除记录无需确认开关
        // 每日专注目标时间（分钟）
        dailyFocusTargetMinutes: 180,  // 默认目标3小时
        // 多端同步配置
        sync: {
            enabled: DEFAULT_SYNC_ENABLED,
            autoTriggerSiyuanSync: true  // 状态切换时自动触发思源同步
        },
        // 音频配置
        audioSettings: {
            workEndSound: '',      // 工作结束提示音文件名（放在 /data/storage/petal/siyuan-plugin-docktomato/tomato-audio/ 下）
            breakEndSound: '',     // 休息结束提示音文件名
            volume: 0.8,           // 提示音音量 (0-1)
            enabled: true          // 是否启用提示音
        },
        // 任务块番茄时间自定义属性配置
        taskBlockTomatoTime: {
            enabled: true,         // 是否启用任务块番茄时间累加功能
            enableHourAttr: true,  // 是否启用小时格式属性
            hourAttrName: 'custom-tomato-time',  // 小时格式属性名称
            enableMinuteAttr: false,  // 是否启用分钟格式属性
            minuteAttrName: 'custom-tomato-minutes'  // 分钟格式属性名称
        },
        // 外观设置
        appearance: {
            theme: 'classic',      // 主题风格: 'classic'(经典霓虹粉紫) | 'future'(未来科技蓝绿) | 'default'(默认简约) | 'custom'(自定义颜色)
            enableNeonEffect: true,    // 是否启用霓虹发光效果
            enableBreathing: true,     // 是否启用呼吸动画
            breathingSpeed: 'normal',  // 呼吸速度: 'slow'(慢) | 'normal'(正常) | 'fast'(快)
            breathingMinOpacity: 0.5,  // 呼吸最低透明度 (0-1)
            breathingMaxOpacity: 1,    // 呼吸最高透明度 (0-1)
            enableSmoothAnimation: true,   // 是否启用平滑动画
            neonIntensity: 0.8,        // 霓虹发光强度 (0-1)
            autoSwitchTheme: false,     // 是否根据时间自动切换主题
            customColor: '#ff6b9d',     // 自定义主颜色
            showIndicator: true,        // 是否显示进度指示器
            enableStopwatchBar: true    // 是否启用正计时进度条
        },
        timeline: {
            enabled: false,
            enableBreathing: true,
            startTime: '08:00',
            endTime: '24:00',
            scaleMinutes: 60,
            color: '#AECBFA',
            customColors: null, // { start, end, glow }
            collapsedHeightPx: 7,
            expandedHeightPx: 27,
            hotAreaHeightPx: 15,
            collapsedOpacity: 0.7,
            expandedOpacity: 1
        }
    };

    const normalizeMinuteList = (value, fallback) => {
        const out = [];
        const pushNum = (n) => {
            const x = Number(n);
            if (!Number.isFinite(x)) return;
            const m = Math.round(x);
            if (m <= 0) return;
            if (m > 24 * 60) return;
            out.push(m);
        };
        if (Array.isArray(value)) {
            value.forEach(pushNum);
        } else if (typeof value === 'string') {
            value.split(/[,，\s]+/).forEach((s) => pushNum(s));
        }
        const uniq = Array.from(new Set(out));
        if (uniq.length) return uniq;
        return Array.isArray(fallback) ? fallback.slice() : [];
    };

    const ensureUserSettings = () => {
        if (!userSettings || typeof userSettings !== 'object') userSettings = {};
        if (!userSettings.main || typeof userSettings.main !== 'object') userSettings.main = {};
        userSettings.main.tomatoDurations = normalizeMinuteList(userSettings.main.tomatoDurations, DEFAULT_TOMATO_DURATIONS);
        userSettings.main.breakDurations = normalizeMinuteList(userSettings.main.breakDurations, DEFAULT_BREAK_DURATIONS);
        userSettings.main.debugMode = userSettings.main.debugMode === true;
        userSettings.main.enableMobileSupport = userSettings.main.enableMobileSupport !== false;

        if (!userSettings.sync || typeof userSettings.sync !== 'object') userSettings.sync = {};
        userSettings.sync.enabled = userSettings.sync.enabled !== false;
        if (typeof userSettings.sync.autoTriggerSiyuanSync !== 'boolean') userSettings.sync.autoTriggerSiyuanSync = true;
    };

    const getTomatoDurations = () => {
        try { return userSettings?.main?.tomatoDurations || DEFAULT_TOMATO_DURATIONS; } catch (e) { return DEFAULT_TOMATO_DURATIONS; }
    };
    const getBreakDurations = () => {
        try { return userSettings?.main?.breakDurations || DEFAULT_BREAK_DURATIONS; } catch (e) { return DEFAULT_BREAK_DURATIONS; }
    };
    const isDebugMode = () => {
        try { return userSettings?.main?.debugMode === true; } catch (e) { return DEFAULT_DEBUG_MODE; }
    };
    const isMobileSupportEnabled = () => {
        try { return userSettings?.main?.enableMobileSupport !== false; } catch (e) { return DEFAULT_ENABLE_MOBILE_SUPPORT; }
    };
    const isSyncEnabled = () => {
        try { return userSettings?.sync?.enabled !== false; } catch (e) { return DEFAULT_SYNC_ENABLED; }
    };
    
    const getDefaultFocusSettings = () => ({
        groups: [
            {
                id: 'default',
                name: '工作日专注时间',
                enabled: true,
                daysOfWeek: [1, 2, 3, 4, 5],
                timeRanges: [
                    { start: '08:30', end: '12:00' },
                    { start: '13:30', end: '17:30' }
                ]
            }
        ]
    });
    
    let focusTimeSettings = getDefaultFocusSettings();

    // ========== 霓虹主题配置 ==========
    const NEON_THEMES = {
        'classic': {
            name: '经典霓虹粉紫',
            colors: ['#ff6b9d', '#c44569', '#f8efba', '#f19066'],
            gradientStart: '#ff6b9d',
            gradientEnd: '#c44569',
            glowColor: '#ff6b9d',
            bgColor: '#1a1a2e',
            description: '浪漫温柔的霓虹粉紫渐变'
        },
        'future': {
            name: '未来科技蓝绿',
            colors: ['#00d2d3', '#54a0ff', '#5f27cd', '#01a3a4'],
            gradientStart: '#00d2d3',
            gradientEnd: '#54a0ff',
            glowColor: '#00d2d3',
            bgColor: '#0a0a1a',
            description: '科技感十足的蓝绿冷色调'
        },
        'default': {
            name: '默认简约',
            colors: ['#1E88E5', '#43A047', '#FB8C00', '#E53935'],
            gradientStart: '#1E88E5',
            gradientEnd: '#43A047',
            glowColor: '#1E88E5',
            bgColor: 'transparent',
            description: '简洁清新的默认风格'
        }
    };

    // ========== 时间段自动主题配置 ==========
    const THEME_TIME_RULES = [
        { start: 6, end: 12, theme: 'classic', name: '清晨' },
        { start: 12, end: 18, theme: 'future', name: '午后' },
        { start: 18, end: 22, theme: 'classic', name: '傍晚' },
        { start: 22, end: 24, theme: 'future', name: '深夜' },
        { start: 0, end: 6, theme: 'future', name: '凌晨' }
    ];

    // ========== 获取当前时间对应的自动主题 ==========
    function getAutoThemeByTime() {
        if (!userSettings.appearance?.autoSwitchTheme) {
            return null;
        }

        const hour = new Date().getHours();
        for (const rule of THEME_TIME_RULES) {
            if (hour >= rule.start && hour < rule.end) {
                return rule.theme;
            }
        }
        return 'future'; // 默认使用深夜主题
    }

    // ========== 获取当前应用的主题 ==========
    function getCurrentTheme() {
        const autoTheme = getAutoThemeByTime();
        if (autoTheme) {
            return autoTheme;
        }
        return userSettings.appearance?.theme || 'default';
    }

    // ========== 获取主题配置 ==========
    function getThemeConfig(themeKey) {
        const key = themeKey || getCurrentTheme();
        
        // 如果是自定义颜色主题，动态生成配置
        if (key === 'custom') {
            // 优先使用 customColors 对象（设置页面保存的完整配色）
            const customColors = userSettings.appearance?.customColors;
            if (customColors && customColors.start && customColors.end && customColors.glow) {
                return {
                    name: '自定义颜色',
                    colors: [customColors.start, customColors.end],
                    gradientStart: customColors.start,
                    gradientEnd: customColors.end,
                    glowColor: customColors.glow,
                    bgColor: '#1a1a2e',
                    description: '使用您选择的自定义颜色'
                };
            }
            // 回退到单一 customColor
            const customColor = userSettings.appearance?.customColor || '#ff6b9d';
            return {
                name: '自定义颜色',
                colors: [customColor, adjustColor(customColor, -30), adjustColor(customColor, 60), adjustColor(customColor, -60)],
                gradientStart: customColor,
                gradientEnd: adjustColor(customColor, -30),
                glowColor: customColor,
                bgColor: '#1a1a2e',
                description: '使用您选择的自定义颜色'
            };
        }
        
        return NEON_THEMES[key] || NEON_THEMES['default'];
    }

    // ========== 颜色调整工具函数 ==========
    function adjustColor(hex, amount) {
        hex = hex.replace('#', '');
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);
        r = Math.min(255, Math.max(0, r + amount));
        g = Math.min(255, Math.max(0, g + amount));
        b = Math.min(255, Math.max(0, b + amount));
        const toHex = (c) => {
            const hex = c.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return '#' + toHex(r) + toHex(g) + toHex(b);
    }

    function getTimelineIndicatorColor(themeConfig = null, timelineCustomConfig = null) {
        const fallback = '#FF1744';
        try {
            const c = String(userSettings?.timeline?.indicatorColor || '').trim();
            if (/^#?[0-9A-Fa-f]{6}$/.test(c)) return c.startsWith('#') ? c : `#${c}`;
        } catch (e) {}
        const glow = themeConfig?.glowColor || timelineCustomConfig?.glowColor || null;
        if (typeof glow === 'string' && glow.trim()) return glow.trim();
        return fallback;
    }

    // ========== 状态变量 ==========
    let timerMode = 'countdown';
    let currentDuration = 30;
    let remainingSeconds = 30 * 60;
    let elapsedSeconds = 0;
    let timerId = null;
    let isRunning = false;
    let isTimerPaused = false;  // 暂停状态：true 表示计时器已暂停但进度条应保持可见
    let lastTickTime = 0;
    let preBreakState = null;
    let lastTomatoConfig = { duration: 30, mode: 'countdown' };
    let pausedRemainingSeconds = null;
    let reminderIntervalId = null;
    let currentStartTimestamp = null;
    let currentStartTimeMs = 0;
    let isFreshTomatoStart = false;
    let startTime = 0;
    
    // 🔧 性能优化：存储 MutationObserver 引用，用于页面卸载时清理
    const mutationObservers = [];
    // 新增：任务块相关状态
    let currentTaskBlockId = null;
    let currentTaskBlockName = null;
    let taskBlockHighlightInterval = null; // 用于保持高亮的定时器
    let taskAssociationCleared = false; // 用户是否清除了任务关联
    
    // 新增：数据库块相关状态
    let currentDatabaseBlockId = null;
    
    let historyState = {
        currentPage: 'summary',
        dateList: [],
        filteredRecords: [],
        allRecords: []
    };
    
    let statsState = {
        currentFilter: 'all',
        currentGroupId: null,
        focusTimeStats: {}
    };
    
    let timeDisplay = null;
    let controlButton = null;
    let container = null;
    let progressBar = null;
    let progressIndicator = null;
    let lastProgressMode = null;  // 用于检测模式变化，强制重新创建进度条

    // ========== 设置管理 ==========
    async function loadUserSettings() {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: SETTINGS_FILE_PATH }),
            });

            if (response.ok) {
                const text = await response.text();
                if (text && text.trim()) {
                    const settings = JSON.parse(text);
                    userSettings = { ...userSettings, ...settings };
                }
            }
        } catch (e) {
            try {
                const raw = localStorage.getItem('tomato-user-settings');
                if (raw && raw.trim()) {
                    const settings = JSON.parse(raw);
                    userSettings = { ...userSettings, ...settings };
                }
            } catch (localError) {}
        }
        try { ensureUserSettings(); } catch (e) {}
        try { Logger.setDebugEnabled(isDebugMode()); } catch (e) {}
        return userSettings;
    }

    async function saveUserSettings() {
        try {
            try { await __tomatoEnsureDir(PLUGIN_STORAGE_DIR); } catch (e) {}
            const ok = await __tomatoPutFileText(SETTINGS_FILE_PATH, JSON.stringify(userSettings, null, 2));
            if (!ok) throw new Error('思源API保存失败');
        } catch (e) {
            Logger.error('保存设置失败:', e);
            try { localStorage.setItem('tomato-user-settings', JSON.stringify(userSettings)); } catch (localError) {}
        }
    }

    // ========== 专注时间设置管理 ==========
    async function loadFocusTimeSettings() {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: FOCUS_TIME_SETTINGS_PATH }),
            });

            if (response.ok) {
                const text = await response.text();
                if (text && text.trim()) {
                    const settings = JSON.parse(text);
                    if (settings && Array.isArray(settings.groups)) {
                        focusTimeSettings = settings;
                    } else {
                        Logger.warn('专注时间设置格式错误，使用默认值');
                        focusTimeSettings = getDefaultFocusSettings();
                    }
                }
            }
        } catch (e) {
            Logger.info('使用默认专注时间设置');
            focusTimeSettings = getDefaultFocusSettings();
        }
        return focusTimeSettings;
    }

    async function saveFocusTimeSettings() {
        try {
            try { await __tomatoEnsureDir(PLUGIN_STORAGE_DIR); } catch (e) {}
            const formData = new FormData();
            formData.append("path", FOCUS_TIME_SETTINGS_PATH);
            formData.append("isDir", false);
            formData.append("file", new Blob([JSON.stringify(focusTimeSettings, null, 2)], { type: 'application/json' }));
            
            const response = await fetch("/api/file/putFile", { method: "POST", body: formData });
            const result = await response.json();
            
            if (result && result.code === 0) {
                Logger.info('专注时间设置保存成功');
                return true;
            } else {
                throw new Error('思源API保存失败');
            }
        } catch (e) {
            Logger.warn('保存专注时间设置失败:', e);
            try {
                localStorage.setItem('focus-time-settings', JSON.stringify(focusTimeSettings));
                Logger.info('已回退到localStorage保存');
                return true;
            } catch (localError) {
                Logger.error('保存到localStorage也失败:', localError);
                return false;
            }
        }
    }

    // ========== 历史记录管理 ==========
    async function loadHistoryRecords() {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: HISTORY_FILE_PATH }),
            });

            if (response.ok) {
                const text = await response.text();
                if (text && text.trim()) {
                    let records = JSON.parse(text);
                    
                    records = records.map(record => {
                        if (record.date) {
                            record.date = normalizeLegacyDate(record.date);
                        } else if (record.start) {
                            record.date = formatDateKey(record.start);
                        }
                        return record;
                    });
                    
					const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
					const filtered = records.filter(r => {
						try { return toDateSafe(r.start).getTime() >= oneYearAgo; } catch (e) { return false; }
					});
                    
                    if (filtered.length !== records.length) {
                        await saveHistoryRecords(filtered);
                        records = filtered;
                    }
                    return records;
                }
            }
        } catch (e) {
            Logger.warn('读取历史记录失败:', e.message);
        }
        try {
            const raw = localStorage.getItem('siyuan-tomato-history');
            if (!raw || !raw.trim()) return [];
            let records = JSON.parse(raw);
            records = (records || []).map(record => {
                if (record?.date) {
                    record.date = normalizeLegacyDate(record.date);
                } else if (record?.start) {
                    record.date = formatDateKey(record.start);
                }
                return record;
            });
            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
            return (records || []).filter(r => {
                try { return toDateSafe(r.start).getTime() >= oneYearAgo; } catch (e) { return false; }
            });
        } catch (e) {
            return [];
        }
    }

    async function saveHistoryRecords(records) {
        if (!records || !Array.isArray(records)) {
            Logger.error('保存失败：记录数据无效');
            return false;
        }
        
        const dataToSave = JSON.stringify(records, null, 2);
        
        try {
            try { await __tomatoEnsureDir(PLUGIN_STORAGE_DIR); } catch (e) {}
            const formData = new FormData();
            formData.append("path", HISTORY_FILE_PATH);
            formData.append("isDir", false);
            formData.append("file", new Blob([dataToSave], { type: 'application/json' }));
            
            const response = await fetch("/api/file/putFile", { method: "POST", body: formData });
            const result = await response.json();
            
            if (result && result.code === 0) {
                return true;
            } else {
                throw new Error('思源API保存失败');
            }
        } catch (fileError) {
            try {
                localStorage.setItem('siyuan-tomato-history', dataToSave);
                return true;
            } catch (localError) {
                Logger.error('保存到localStorage也失败:', localError);
                return false;
            }
        }
    }

    // 删除单条记录
    async function deleteRecord(record) {
        // 如果开启了删除无需确认，直接删除；否则弹出确认对话框
        if (!userSettings.deleteWithoutConfirm) {
            if (!confirm(`确定要删除这条记录吗？\n${new Date(record.start).toLocaleString('zh-CN')} - ${formatFocusTime(record.durationMin)}`)) {
                return false;
            }
        }
        
        try {
            const records = await loadHistoryRecords();
            const index = records.findIndex(r => 
                r.start === record.start && 
                r.end === record.end &&
                r.durationMin === record.durationMin &&
                r.mode === record.mode
            );
            
            if (index !== -1) {
                records.splice(index, 1);
                const success = await saveHistoryRecords(records);
                if (success) {
                    return true;
                }
            }
        } catch (e) {
            Logger.error('删除记录时出错:', e);
        }
        
        return false;
    }

    function recordStartTime() {
        currentStartTimestamp = new Date().toISOString();
        currentStartTimeMs = Date.now();
    }

    function getInitialRemainingAtStart() {
        if (preBreakState && preBreakState.mode === 'countdown') return preBreakState.remainingSeconds;
        if (pausedRemainingSeconds !== null) return pausedRemainingSeconds;
        if (isRunning && startTime > 0) {
            const now = Date.now();
            const totalMs = currentDuration * 60 * 1000;
            const elapsedMs = now - startTime;
            return Math.max(0, Math.floor((totalMs - elapsedMs) / 1000));
        }
        return remainingSeconds;
    }

    function getTimePeriod(hour) {
        if (hour >= 0 && hour < 6) return 'night';
        if (hour >= 6 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 18) return 'afternoon';
        return 'evening';
    }

    function getTimePeriodName(period) {
        return TIME_PERIODS[period] || period;
    }

    function getTimePeriodOrder() {
        return TIME_PERIOD_ORDER;
    }

    // ========== 专注时间范围功能 ==========
	function isInFocusTimeRange(timestamp, groupId = null) {
		const date = new Date(timestamp);
		const jsDayOfWeek = date.getDay();
		// ✅ 修复：将 JavaScript 的星期表示法转换为插件表示法
		// JavaScript: 0=周日, 1=周一, ..., 6=周六
		// 插件内部: 1=周一, 2=周二, ..., 7=周日
		const dayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
		
		const hour = date.getHours();
		const minute = date.getMinutes();
		const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
		
		const groups = Array.isArray(focusTimeSettings?.groups) ? focusTimeSettings.groups.filter(g => g?.enabled) : [];
		
		return groups.some(group => {
			if (groupId && group.id !== groupId) return false;
			if (!Array.isArray(group.daysOfWeek) || !group.daysOfWeek.includes(dayOfWeek)) return false;
			
			return Array.isArray(group.timeRanges) && group.timeRanges.some(range => {
				// ✅ 处理跨天时间范围（如23:00-02:00）
				if (range.start > range.end) {
					return currentTime >= range.start || currentTime <= range.end;
				}
				return currentTime >= range.start && currentTime <= range.end;
			});
		});
	}

    // 计算一条记录在指定专注时间组中的实际专注时长（分钟）
    function calculateActualFocusDuration(record, groupId = null) {
        const startTime = new Date(record.start).getTime();
        const endTime = new Date(record.end).getTime();
        const durationMs = endTime - startTime;
        
        if (durationMs <= 0) return 0;
        
        // 获取目标专注时间组
        const groups = Array.isArray(focusTimeSettings?.groups) 
            ? focusTimeSettings.groups.filter(g => g?.enabled) 
            : [];
        
        if (groups.length === 0) {
            // 没有设置专注时间组，返回完整时长
            return Math.round(durationMs / 60000);
        }
        
        // 如果指定了 groupId，只使用该组
        const targetGroups = groupId 
            ? groups.filter(g => g.id === groupId) 
            : groups;
        
        if (targetGroups.length === 0) {
            return Math.round(durationMs / 60000);
        }
        
        let totalFocusMinutes = 0;
        const recordStart = new Date(startTime);
        const recordEnd = new Date(endTime);
        
        // 逐分钟检查是否在专注时间范围内
        const current = new Date(recordStart);
        while (current < recordEnd) {
            const timestamp = current.getTime();
            const date = new Date(timestamp);
            const jsDayOfWeek = date.getDay();
            const dayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
            
            const hour = date.getHours();
            const minute = date.getMinutes();
            const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            
            // 检查当前分钟是否在任何目标组的专注时间范围内
            const isInRange = targetGroups.some(group => {
                if (!Array.isArray(group.daysOfWeek) || !group.daysOfWeek.includes(dayOfWeek)) {
                    return false;
                }
                
                return Array.isArray(group.timeRanges) && group.timeRanges.some(range => {
                    if (range.start > range.end) {
                        // 跨天时间范围
                        return currentTime >= range.start || currentTime <= range.end;
                    }
                    return currentTime >= range.start && currentTime <= range.end;
                });
            });
            
            if (isInRange) {
                totalFocusMinutes++;
            }
            
            // 前进一分钟
            current.setMinutes(current.getMinutes() + 1);
        }
        
        return totalFocusMinutes;
    }
    
    // ✅ v7.0 修复核心：专注时间筛选时自动修复日期格式
    function filterRecordsByFocusTime(records, groupId = null) {
        if (!records || !Array.isArray(records)) {
            Logger.error('filterRecordsByFocusTime: records无效');
            return [];
        }
        
        // 性能优化：仅在筛选时检查并修复日期格式
        let hasInvalidDate = false;
        const normalizedRecords = records.map(record => {
            // 检查是否需要修复（包含斜杠的格式）
            if (record.date && record.date.includes('/')) {
                hasInvalidDate = true;
                const parts = record.date.split('/');
                // 创建新对象并修复日期格式
                return {
                    ...record,
                    date: `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`
                };
            }
            return record;
        });
        
        // 如果有修复，异步保存到文件（不阻塞当前操作）
        if (hasInvalidDate) {
            Logger.info('🔧 检测到不规范日期格式，已临时修复');
            // 后台保存，不影响用户体验
            setTimeout(() => {
                saveHistoryRecords(normalizedRecords).then(success => {
                    if (success) {
                        Logger.info('✅ 日期格式已永久保存到文件');
                    }
                });
            }, 0);
        }
        
        // 使用修复后的数据进行筛选
        const recordsToFilter = hasInvalidDate ? normalizedRecords : records;
        
        // 获取启用的专注时间组
        const enabledGroups = Array.isArray(focusTimeSettings?.groups) 
            ? focusTimeSettings.groups.filter(g => g?.enabled) 
            : [];
        
        if (enabledGroups.length === 0) {
            // 没有设置专注时间组，返回全部记录（无实际专注时长）
            return recordsToFilter.map(record => ({
                ...record,
                actualFocusMinutes: Math.round((new Date(record.end) - new Date(record.start)) / 60000)
            }));
        }
        
        if (groupId) {
            // 筛选特定组
            const groupExists = enabledGroups.some(g => g.id === groupId);
            if (!groupExists) {
                Logger.warn(`GroupId ${groupId} 在启用的组中不存在`);
                return recordsToFilter.map(record => ({
                    ...record,
                    actualFocusMinutes: Math.round((new Date(record.end) - new Date(record.start)) / 60000)
                }));
            }
        }
        
        // 计算每条记录的实际专注时长，并筛选出有专注时长的记录
        return recordsToFilter.map(record => {
            const actualFocusMinutes = calculateActualFocusDuration(record, groupId);
            return {
                ...record,
                actualFocusMinutes
            };
        }).filter(record => record.actualFocusMinutes > 0);
    }

    function calculateFocusTimeStats(records, groupId = null) {
        const focusRecords = filterRecordsByFocusTime(records, groupId);
        
        const stats = {
            totalRecords: focusRecords.length,
            tomatoCount: focusRecords.filter(r => r.mode === 'countdown' && r.durationMin >= 1).length,
            tomatoActual: 0,
            tomatoPlanned: 0,
            stopwatchCount: focusRecords.filter(r => r.mode === 'stopwatch').length,
            stopwatchActual: 0,
            breakCount: focusRecords.filter(r => r.mode === 'break' || r.mode === 'stopwatch-break').length,
            breakActual: 0,
            focusTime: 0
        };
        
        focusRecords.forEach(record => {
            if (record.mode === 'countdown' && record.durationMin >= 1) {
                stats.tomatoActual += record.durationMin;
                stats.tomatoPlanned += (record.plannedDuration || record.durationMin);
            } else if (record.mode === 'stopwatch') {
                stats.stopwatchActual += record.durationMin;
            } else if (record.mode === 'break' || record.mode === 'stopwatch-break') {
                stats.breakActual += record.durationMin;
            }
        });
        
        stats.focusTime = stats.tomatoActual + stats.stopwatchActual;
        
        return stats;
    }

    // ========== 专注时间范围设置渲染函数 ==========
    function renderFocusTimeSettings(container) {
        container.innerHTML = '';

        // 标题说明
        const intro = document.createElement('div');
        intro.style.cssText = `
            margin-bottom: 16px; padding: 12px;
            background: var(--b3-theme-surface-light);
            border-radius: 6px; font-size: 12px; line-height: 1.6;
        `;
        intro.innerHTML = `
            <strong>💡 使用说明</strong><br>
            • 启用专注时间范围后，统计页面将只统计指定时间段内的记录<br>
            • 可设置多个时间组（如工作日/周末）<br>
            • 每个组支持多个时间段<br>
            • 建议先禁用"专注时间筛选"功能确认原始数据完整
        `;
        container.appendChild(intro);

        // 全局开关
        const globalSwitch = document.createElement('div');
        globalSwitch.style.cssText = `
            display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
            padding: 10px; background: var(--b3-theme-background);
            border-radius: 6px; border: 1px solid var(--b3-theme-surface-light);
        `;
        const switchLabel = document.createElement('label');
        switchLabel.style.cssText = `font-size: 13px; cursor: pointer; flex: 1;`;
        switchLabel.innerHTML = '<strong>🎯 启用专注时间筛选</strong><br><span style="opacity:0.7; font-size:11px;">开启后将只统计符合时间范围的记录';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        const hasEnabledGroup = focusTimeSettings.groups?.some(g => g.enabled);
        checkbox.checked = hasEnabledGroup;
        checkbox.onchange = () => {
            const newEnabled = checkbox.checked;
            focusTimeSettings.groups?.forEach(g => g.enabled = newEnabled);
            saveFocusTimeSettings();
            renderFocusTimeSettings(container);
        };
        globalSwitch.appendChild(checkbox);
        globalSwitch.appendChild(switchLabel);
        container.appendChild(globalSwitch);

        // 分组列表
        const groups = focusTimeSettings.groups || [];

        groups.forEach((group, index) => {
            const groupElement = renderGroupSettings(group, index, container);
            container.appendChild(groupElement);
        });

        // 添加分组按钮
        const addGroupBtn = document.createElement('button');
        addGroupBtn.innerHTML = '+ 添加时间段分组';
        addGroupBtn.style.cssText = `
            width: 100%; padding: 10px; margin-top: 12px;
            background: var(--b3-theme-surface); color: var(--b3-theme-primary);
            border: 1px dashed var(--b3-theme-surface-light); border-radius: 6px;
            cursor: pointer; font-size: 13px; transition: all 0.2s;
        `;
        addGroupBtn.onmouseenter = () => {
            addGroupBtn.style.background = 'var(--b3-theme-surface-light)';
        };
        addGroupBtn.onmouseleave = () => {
            addGroupBtn.style.background = 'var(--b3-theme-surface)';
        };
        addGroupBtn.onclick = () => {
            const newGroup = {
                id: 'group_' + Date.now(),
                name: '新时间段',
                enabled: true,
                daysOfWeek: [1, 2, 3, 4, 5],
                timeRanges: [{ start: '09:00', end: '12:00' }]
            };
            focusTimeSettings.groups.push(newGroup);
            saveFocusTimeSettings();
            renderFocusTimeSettings(container);
        };
        container.appendChild(addGroupBtn);
    }

    function renderGroupSettings(group, index, container) {
        const groupElement = document.createElement('div');
        groupElement.style.cssText = `
            margin-bottom: 16px; padding: 14px;
            background: var(--b3-theme-surface); border-radius: 8px;
            border: 1px solid var(--b3-theme-surface-light);
        `;

        // 分组标题行
        const header = document.createElement('div');
        header.style.cssText = `display: flex; align-items: center; gap: 10px; margin-bottom: 12px;`;

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = group.name;
        nameInput.style.cssText = `
            flex: 1; padding: 6px 10px; font-size: 13px;
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 4px; color: var(--b3-theme-on-background);
        `;
        nameInput.onchange = () => {
            group.name = nameInput.value;
            saveFocusTimeSettings();
        };
        header.appendChild(nameInput);

        // 启用开关
        const enableLabel = document.createElement('label');
        enableLabel.style.cssText = `font-size: 12px; cursor: pointer; white-space: nowrap;`;
        enableLabel.innerHTML = '启用';
        const enableCheckbox = document.createElement('input');
        enableCheckbox.type = 'checkbox';
        enableCheckbox.checked = group.enabled;
        enableCheckbox.onchange = () => {
            group.enabled = enableCheckbox.checked;
            saveFocusTimeSettings();
        };
        enableLabel.prepend(enableCheckbox);
        header.appendChild(enableLabel);

        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️';
        delBtn.title = '删除此分组';
        delBtn.style.cssText = `
            padding: 4px 8px; background: transparent;
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 4px; cursor: pointer; font-size: 12px;
        `;
        delBtn.onclick = () => {
            if (focusTimeSettings.groups.length <= 1) {
                alert('至少保留一个分组');
                return;
            }
            if (!confirm('确定删除此分组？')) return;
            focusTimeSettings.groups.splice(index, 1);
            saveFocusTimeSettings();
            renderFocusTimeSettings(container);
        };
        header.appendChild(delBtn);
        groupElement.appendChild(header);

        // 星期选择
        const daysRow = document.createElement('div');
        daysRow.style.cssText = `
            margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
        `;
        const daysLabel = document.createElement('span');
        daysLabel.textContent = '星期:';
        daysLabel.style.cssText = `font-size: 12px; min-width: 45px;`;
        daysRow.appendChild(daysLabel);

        const weekDays = ['一', '二', '三', '四', '五', '六', '日'];
        const weekDaysFull = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const daysOfWeek = group.daysOfWeek || [];

        weekDaysFull.forEach((day, i) => {
            const dayLabel = document.createElement('label');
            dayLabel.style.cssText = `font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 3px;`;
            const dayCheckbox = document.createElement('input');
            dayCheckbox.type = 'checkbox';
            dayCheckbox.checked = daysOfWeek.includes(i + 1);
            dayCheckbox.onchange = () => {
                const dayNum = i + 1;
                if (dayCheckbox.checked) {
                    if (!group.daysOfWeek.includes(dayNum)) group.daysOfWeek.push(dayNum);
                } else {
                    group.daysOfWeek = group.daysOfWeek.filter(d => d !== dayNum);
                }
                group.daysOfWeek.sort((a, b) => a - b);
                saveFocusTimeSettings();
            };
            dayLabel.appendChild(dayCheckbox);
            dayLabel.appendChild(document.createTextNode(day));
            daysRow.appendChild(dayLabel);
        });

        // 全选/取消按钮
        const quickSelect = document.createElement('span');
        quickSelect.style.cssText = `margin-left: auto; font-size: 11px;`;
        
        const selectLink = document.createElement('a');
        selectLink.href = 'javascript:void(0)';
        selectLink.textContent = '全选';
        selectLink.style.cssText = `color: var(--b3-theme-primary); text-decoration: none; cursor: pointer;`;
        selectLink.onclick = () => {
            const checked = selectLink.textContent === '全选';
            // 找到当前分组的所有星期复选框（只在这一个分组内）
            const dayCheckboxes = daysRow.querySelectorAll('input[type=checkbox]');
            dayCheckboxes.forEach(cb => cb.checked = checked);
            
            // 更新星期数据
            const allDays = [1, 2, 3, 4, 5, 6, 7];
            if (checked) {
                group.daysOfWeek = [...allDays];
            } else {
                group.daysOfWeek = [];
            }
            saveFocusTimeSettings();
            
            // 切换文本
            selectLink.textContent = checked ? '取消' : '全选';
        };
        quickSelect.appendChild(selectLink);
        daysRow.appendChild(quickSelect);
        groupElement.appendChild(daysRow);

        // 时间范围列表
        const rangeList = document.createElement('div');
        rangeList.style.cssText = `margin-top: 10px;`;

        (group.timeRanges || []).forEach((range, rIndex) => {
            const rangeRow = document.createElement('div');
            rangeRow.style.cssText = `
                display: flex; align-items: center; gap: 8px; margin: 6px 0;
                padding: 8px; background: var(--b3-theme-background);
                border-radius: 4px; font-size: 12px;
            `;

            const startInput = document.createElement('input');
            startInput.type = 'time';
            startInput.value = range.start;
            startInput.style.cssText = `padding: 4px; font-size: 12px;`;
            startInput.onchange = () => {
                range.start = startInput.value;
                saveFocusTimeSettings();
            };

            const separator = document.createElement('span');
            separator.textContent = '至';

            const endInput = document.createElement('input');
            endInput.type = 'time';
            endInput.value = range.end;
            endInput.style.cssText = `padding: 4px; font-size: 12px;`;
            endInput.onchange = () => {
                range.end = endInput.value;
                saveFocusTimeSettings();
            };

            // 删除时间范围
            const delRangeBtn = document.createElement('button');
            delRangeBtn.innerHTML = '×';
            delRangeBtn.title = '删除此时间段';
            delRangeBtn.style.cssText = `
                width: 22px; height: 22px; padding: 0; line-height: 1;
                background: var(--b3-theme-error); color: white;
                border: none; border-radius: 4px; cursor: pointer;
            `;
            delRangeBtn.onclick = () => {
                group.timeRanges.splice(rIndex, 1);
                saveFocusTimeSettings();
                // 🔧 修复：移除旧的 groupElement 并重新渲染
                groupElement.remove();
                renderGroupSettings(group, index, container);
            };

            rangeRow.appendChild(startInput);
            rangeRow.appendChild(separator);
            rangeRow.appendChild(endInput);
            rangeRow.appendChild(delRangeBtn);
            rangeList.appendChild(rangeRow);
        });

        // 添加时间段按钮
        const addRangeBtn = document.createElement('button');
        addRangeBtn.textContent = '+ 添加时间段';
        addRangeBtn.style.cssText = `
            margin-top: 6px; padding: 6px 12px; font-size: 12px;
            background: var(--b3-theme-surface-light);
            border: none; border-radius: 4px; cursor: pointer;
        `;
        addRangeBtn.onclick = () => {
            if (!group.timeRanges) group.timeRanges = [];
            group.timeRanges.push({ start: '09:00', end: '12:00' });
            saveFocusTimeSettings();
            renderGroupSettings(group, index, container);
        };

        groupElement.appendChild(rangeList);
        groupElement.appendChild(addRangeBtn);

        return groupElement;
    }

    async function showFocusTimeSettingsDialog() {
        Logger.info('显示专注时间设置对话框');
        await loadFocusTimeSettings();

        removeById('tomy-focus-time-settings-dialog', 'tomy-focus-time-settings-backdrop');

        const backdrop = document.createElement('div');
        backdrop.id = 'tomy-focus-time-settings-backdrop';
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.3); z-index: 2147483645; pointer-events: none;
        `;

        const dialog = document.createElement('div');
        dialog.id = 'tomy-focus-time-settings-dialog';
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: var(--b3-theme-background); border: 1px solid var(--b3-theme-surface-light);
            border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483646;
            padding: 0; width: 95vw; max-width: 800px; max-height: 85vh;
            display: flex; flex-direction: column; pointer-events: auto;
            color: var(--b3-theme-on-background);
        `;

        const topBar = document.createElement('div');
        topBar.style.cssText = `
            padding: 12px 20px 8px 20px;
            border-bottom: 1px solid var(--b3-theme-surface-light);
            background: var(--b3-theme-background);
            position: sticky;
            top: 0;
            z-index: 10;
        `;

        const titleBar = document.createElement('div');
        titleBar.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;`;

        const title = document.createElement('div');
        title.textContent = '⚙️ 时间范围设置';
        title.style.cssText = `
            font-weight: bold; font-size: 16px; color: var(--b3-theme-primary);
            text-align: center; flex: 1; margin: 0 10px;
        `;
        titleBar.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = `
            padding: 6px 12px; background: var(--b3-theme-surface-light); color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-surface); border-radius: 4px; cursor: pointer;
            font-size: 12px; min-width: 60px; font-weight: normal; height: 32px;
        `;
        closeBtn.onclick = () => {
            dialog.remove();
            backdrop.remove();
        };
        titleBar.appendChild(closeBtn);

        topBar.appendChild(titleBar);

        const contentArea = document.createElement('div');
        contentArea.id = 'tomy-focus-time-content';
        contentArea.style.cssText = `
            padding: 16px; overflow-y: auto; flex: 1; max-height: calc(85vh - 116px);
            font-size: 13px; position: relative;
        `;

        dialog.appendChild(topBar);
        dialog.appendChild(contentArea);
        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);

        try {
            renderFocusTimeSettings(contentArea);
        } catch (error) {
            Logger.error('专注时间设置渲染失败:', error);
            contentArea.innerHTML = `
                <div style="padding: 20px; color: var(--b3-theme-error); text-align: center;">
                    <p><strong>渲染失败</strong></p>
                    <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
                    <button onclick="location.reload()" style="margin-top: 15px; padding: 8px 16px; background: var(--b3-theme-primary); color: white; border: none; border-radius: 4px; cursor: pointer;">
                        刷新页面
                    </button>
                </div>
            `;
        }
    }

    function removeById(...ids) {
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }
    }

    function ensureTomatoCommonStyles() {
        if (document.getElementById('tomato-common-style')) return;
        const style = document.createElement('style');
        style.id = 'tomato-common-style';
        style.textContent = `
            @keyframes tomatoSlideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }

            .tomato-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: flex-end;
                justify-content: center;
            }

            .tomato-bottomsheet {
                width: 100%;
                background: var(--b3-theme-background);
                border-radius: 16px 16px 0 0;
                box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.2);
                animation: tomatoSlideUp 0.3s ease-out;
            }

            .tomato-bottomsheet-title {
                text-align: center;
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 16px;
                color: var(--b3-theme-on-background);
            }

            .tomato-grid-10 {
                display: grid;
                grid-template-columns: repeat(10, 1fr);
                gap: 8px;
                margin-bottom: 12px;
            }

            .tomato-actions {
                display: flex;
                gap: 10px;
            }

            .tomato-btn {
                flex: 1;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
            }

            .tomato-btn--cancel {
                border: 1px solid var(--b3-theme-surface-light);
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
            }

            .tomato-btn--primary {
                border: none;
                background: var(--b3-theme-primary);
                color: #fff;
            }
        `;
        document.head.appendChild(style);
    }

    function safeJsonParse(text) {
        try {
            if (text == null) return null;
            const raw = String(text);
            if (!raw.trim()) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    async function postJSON(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data ?? {})
        });
        const text = await response.text();
        return { response, ok: response.ok, status: response.status, data: safeJsonParse(text) };
    }

    function openTomatoColorPickerDialog(titleText, initialColor, onApply, options = {}) {
        removeById('tomato-color-picker-dialog', 'tomato-color-picker-backdrop');
        ensureTomatoCommonStyles();

        const backdrop = document.createElement('div');
        backdrop.id = 'tomato-color-picker-backdrop';
        backdrop.className = 'tomato-backdrop';
        backdrop.style.zIndex = '2147483651';

        const dialog = document.createElement('div');
        dialog.id = 'tomato-color-picker-dialog';
        dialog.className = 'tomato-bottomsheet';
        dialog.style.maxWidth = '520px';
        dialog.style.padding = '16px';
        dialog.style.zIndex = '2147483652';

        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.cssText = `font-weight: bold; font-size: 15px; margin-bottom: 12px;`;
        dialog.appendChild(title);

        const swatches = [
            '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
            '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
            '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
            '#795548', '#9E9E9E', '#607D8B', '#000000', '#FFFFFF'
        ];

        const normalizeHex = (val) => {
            const raw = String(val || '').trim();
            if (!raw) return null;
            const v = raw.startsWith('#') ? raw.slice(1) : raw;
            if (!/^[0-9A-Fa-f]{6}$/.test(v)) return null;
            return `#${v.toUpperCase()}`;
        };

        const defaultColor = normalizeHex(options?.defaultColor) || '#F44336';
        let current = normalizeHex(initialColor) || defaultColor;

        const preview = document.createElement('div');
        preview.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;`;
        const previewBox = document.createElement('div');
        previewBox.style.cssText = `width: 44px; height: 28px; border-radius: 6px; border: 1px solid var(--b3-theme-surface-light); background: ${current};`;
        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.value = current;
        hexInput.placeholder = '#RRGGBB';
        hexInput.style.cssText = `flex: 1; padding: 8px 10px; border: 1px solid var(--b3-theme-surface-light); border-radius: 6px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);`;
        hexInput.oninput = () => {
            const norm = normalizeHex(hexInput.value);
            if (norm) {
                current = norm;
                previewBox.style.background = current;
                hexInput.style.borderColor = 'var(--b3-theme-surface-light)';
            } else {
                hexInput.style.borderColor = 'var(--b3-theme-error)';
            }
        };
        preview.appendChild(previewBox);
        preview.appendChild(hexInput);
        dialog.appendChild(preview);

        const grid = document.createElement('div');
        grid.className = 'tomato-grid-10';
        swatches.forEach((c) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = `
                width: 100%; aspect-ratio: 1 / 1;
                border-radius: 6px;
                border: 1px solid var(--b3-theme-surface-light);
                background: ${c};
                cursor: pointer;
                padding: 0;
            `;
            btn.onclick = () => {
                current = c.toUpperCase();
                hexInput.value = current;
                hexInput.style.borderColor = 'var(--b3-theme-surface-light)';
                previewBox.style.background = current;
            };
            grid.appendChild(btn);
        });
        dialog.appendChild(grid);

        const actions = document.createElement('div');
        actions.className = 'tomato-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = 'tomato-btn tomato-btn--cancel';
        const okBtn = document.createElement('button');
        okBtn.textContent = '应用';
        okBtn.className = 'tomato-btn tomato-btn--primary';
        const close = () => {
            dialog.remove();
            backdrop.remove();
        };
        cancelBtn.onclick = close;
        okBtn.onclick = () => {
            const norm = normalizeHex(current);
            if (!norm) return;
            onApply(norm);
            close();
        };
        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        dialog.appendChild(actions);

        backdrop.onclick = (e) => {
            if (e.target === backdrop) close();
        };

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
    }

    function createMobileColorPickerButton(labelText, initialColor, onChange, options = {}) {
        const showHexText = options.showHexText !== false;
        const defaultColor = String(options.defaultColor || '#F44336').trim() || '#F44336';
        let current = String(initialColor || '').trim() || defaultColor;
        if (showHexText) current = current.toUpperCase();

        const btn = document.createElement('button');
        btn.type = 'button';
        const swatch = document.createElement('span');
        const text = showHexText ? document.createElement('span') : null;

        if (showHexText) {
            btn.style.cssText = `
                display: flex; align-items: center; gap: 8px;
                padding: 6px 10px;
                border: 1px solid var(--b3-theme-surface-light);
                border-radius: 8px;
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
                cursor: pointer;
                min-width: 120px;
                justify-content: space-between;
            `;
            swatch.style.cssText = `width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--b3-theme-surface-light); background: ${current};`;
            text.textContent = current;
            text.style.cssText = `font-size: 12px; opacity: 0.9;`;
            btn.appendChild(swatch);
            btn.appendChild(text);
        } else {
            btn.style.cssText = `width: 40px; height: 30px; cursor: pointer; border: none; padding: 0; background: transparent;`;
            swatch.style.cssText = `display: inline-block; width: 40px; height: 30px; border-radius: 6px; border: 1px solid var(--b3-theme-surface); background: ${current};`;
            btn.appendChild(swatch);
        }

        btn.onclick = () => {
            openTomatoColorPickerDialog(labelText, current, (next) => {
                current = String(next || '').trim() || current;
                if (showHexText) current = current.toUpperCase();
                swatch.style.background = current;
                if (text) text.textContent = current;
                if (typeof onChange === 'function') onChange(current);
            }, { defaultColor });
        };

        return {
            element: btn,
            getColor: () => current,
            setColor: (c) => {
                current = String(c || '').trim() || current;
                if (showHexText) current = current.toUpperCase();
                swatch.style.background = current;
                if (text) text.textContent = current;
            }
        };
    }

    function showTimelineSettingsDialog() {
        removeById('tomato-timeline-settings-dialog', 'tomato-timeline-settings-backdrop');
        const isMobile = isMobileDevice();

        const ensureTimelineDefaults = () => {
            if (!userSettings.timeline) userSettings.timeline = {};
            if (typeof userSettings.timeline.enabled !== 'boolean') userSettings.timeline.enabled = false;
            if (typeof userSettings.timeline.enableBreathing !== 'boolean') userSettings.timeline.enableBreathing = true;
            if (!userSettings.timeline.startTime) userSettings.timeline.startTime = '08:00';
            if (!userSettings.timeline.endTime) userSettings.timeline.endTime = '24:00';
            if (!userSettings.timeline.scaleMinutes) userSettings.timeline.scaleMinutes = 60;
            if (isMobile && Number(userSettings.timeline.scaleMinutes) !== 60) userSettings.timeline.scaleMinutes = 60;
            if (!userSettings.timeline.hiddenTimeRange || typeof userSettings.timeline.hiddenTimeRange !== 'object') {
                userSettings.timeline.hiddenTimeRange = { enabled: false, start: '00:00', end: '06:00' };
            } else {
                if (typeof userSettings.timeline.hiddenTimeRange.enabled !== 'boolean') userSettings.timeline.hiddenTimeRange.enabled = false;
                if (!userSettings.timeline.hiddenTimeRange.start) userSettings.timeline.hiddenTimeRange.start = '00:00';
                if (!userSettings.timeline.hiddenTimeRange.end) userSettings.timeline.hiddenTimeRange.end = '06:00';
            }
            if (!userSettings.timeline.color) userSettings.timeline.color = '#AECBFA';
            if (userSettings.timeline.customColors == null) userSettings.timeline.customColors = null;
            if (userSettings.timeline.customColors && (typeof userSettings.timeline.customColors !== 'object')) userSettings.timeline.customColors = null;
            if (!userSettings.timeline.highlightColors || typeof userSettings.timeline.highlightColors !== 'object') {
                userSettings.timeline.highlightColors = {
                    tomato: '#F44336',
                    stopwatch: '#00C853',
                    break: '#9E9E9E'
                };
            }
            if (!userSettings.timeline.highlightColors.tomato) userSettings.timeline.highlightColors.tomato = '#F44336';
            if (!userSettings.timeline.highlightColors.stopwatch) userSettings.timeline.highlightColors.stopwatch = '#00C853';
            if (!userSettings.timeline.highlightColors.break) userSettings.timeline.highlightColors.break = '#9E9E9E';
            if (typeof userSettings.timeline.collapsedHeightPx !== 'number') userSettings.timeline.collapsedHeightPx = 7;
            if (typeof userSettings.timeline.expandedHeightPx !== 'number') userSettings.timeline.expandedHeightPx = 27;
            if (typeof userSettings.timeline.hotAreaHeightPx !== 'number') userSettings.timeline.hotAreaHeightPx = 15;
            if (typeof userSettings.timeline.collapsedOpacity !== 'number') userSettings.timeline.collapsedOpacity = 0.7;
            if (typeof userSettings.timeline.expandedOpacity !== 'number') userSettings.timeline.expandedOpacity = 1;
        };

        const parseTimeToMinutes = (timeStr) => {
            const raw = String(timeStr || '').trim();
            if (!raw) return null;
            if (raw === '24:00') return 1440;
            const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
            if (!m) return null;
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            return hh * 60 + mm;
        };

        ensureTimelineDefaults();

        const backdrop = document.createElement('div');
        backdrop.id = 'tomato-timeline-settings-backdrop';
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.4); z-index: 2147483649;
        `;

        const dialog = document.createElement('div');
        dialog.id = 'tomato-timeline-settings-dialog';
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: var(--b3-theme-background); border: 1px solid var(--b3-theme-surface-light);
            border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483650;
            padding: 0; width: 360px; max-width: calc(100vw - 24px);
            display: flex; flex-direction: column; pointer-events: auto;
            color: var(--b3-theme-on-background);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px; border-bottom: 1px solid var(--b3-theme-surface-light);
            display: flex; justify-content: space-between; align-items: center;
        `;

        const title = document.createElement('div');
        title.textContent = '📅 时间轴设置';
        title.style.cssText = `font-weight: bold; font-size: 16px;`;
        header.appendChild(title);

        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `cursor: pointer; font-size: 20px; line-height: 1; padding: 4px;`;
        closeBtn.onclick = () => {
            dialog.remove();
            backdrop.remove();
        };
        header.appendChild(closeBtn);
        dialog.appendChild(header);

        const content = document.createElement('div');
        content.style.cssText = `padding: 16px; display: flex; flex-direction: column; gap: 12px;`;

        const row = (labelText, inputEl) => {
            const r = document.createElement('div');
            r.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
            const label = document.createElement('div');
            label.textContent = labelText;
            label.style.cssText = `font-size: 13px; opacity: 0.9;`;
            r.appendChild(label);
            r.appendChild(inputEl);
            return r;
        };

        const rowStack = (labelText, inputEl) => {
            const r = document.createElement('div');
            r.style.cssText = `display: flex; flex-direction: column; align-items: stretch; gap: 8px;`;
            const label = document.createElement('div');
            label.textContent = labelText;
            label.style.cssText = `font-size: 13px; opacity: 0.9;`;
            r.appendChild(label);
            r.appendChild(inputEl);
            return r;
        };

        const enabledInput = document.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.checked = !!userSettings.timeline.enabled;
        enabledInput.style.cssText = `cursor: pointer; transform: scale(1.15);`;
        enabledInput.onchange = async () => {
            ensureTimelineDefaults();
            userSettings.timeline.enabled = enabledInput.checked;
            await saveUserSettings();
            updateProgressBar();
        };
        content.appendChild(row('启用时间轴功能', enabledInput));

        const breathingInput = document.createElement('input');
        breathingInput.type = 'checkbox';
        breathingInput.checked = userSettings.timeline.enableBreathing !== false;
        breathingInput.style.cssText = `cursor: pointer; transform: scale(1.15);`;
        breathingInput.onchange = async () => {
            ensureTimelineDefaults();
            userSettings.timeline.enableBreathing = breathingInput.checked;
            await saveUserSettings();
            updateProgressBar();
        };
        content.appendChild(row('时间轴呼吸效果', breathingInput));

        const startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.value = userSettings.timeline.startTime;
        startInput.placeholder = '08:00';
        startInput.style.cssText = `width: 120px; padding: 6px 8px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);`;

        const endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.value = userSettings.timeline.endTime;
        endInput.placeholder = '24:00';
        endInput.style.cssText = startInput.style.cssText;

        const rangeWrap = document.createElement('div');
        rangeWrap.style.cssText = `display: flex; align-items: center; gap: 8px;`;
        const dash = document.createElement('span');
        dash.textContent = '-';
        dash.style.cssText = `opacity: 0.7;`;
        rangeWrap.appendChild(startInput);
        rangeWrap.appendChild(dash);
        rangeWrap.appendChild(endInput);
        content.appendChild(rowStack('显示起止时间', rangeWrap));

        const hideEnabledInput = document.createElement('input');
        hideEnabledInput.type = 'checkbox';
        hideEnabledInput.checked = !!userSettings.timeline.hiddenTimeRange?.enabled;
        hideEnabledInput.style.cssText = `cursor: pointer; transform: scale(1.15);`;

        const hideStartInput = document.createElement('input');
        hideStartInput.type = 'text';
        hideStartInput.value = userSettings.timeline.hiddenTimeRange?.start || '00:00';
        hideStartInput.placeholder = '00:00';
        hideStartInput.style.cssText = startInput.style.cssText;

        const hideEndInput = document.createElement('input');
        hideEndInput.type = 'text';
        hideEndInput.value = userSettings.timeline.hiddenTimeRange?.end || '06:00';
        hideEndInput.placeholder = '06:00';
        hideEndInput.style.cssText = startInput.style.cssText;

        const syncHideDisabled = () => {
            const disabled = !hideEnabledInput.checked;
            hideStartInput.disabled = disabled;
            hideEndInput.disabled = disabled;
            hideStartInput.style.opacity = disabled ? '0.6' : '1';
            hideEndInput.style.opacity = disabled ? '0.6' : '1';
        };
        hideEnabledInput.onchange = syncHideDisabled;
        syncHideDisabled();

        const hideWrap = document.createElement('div');
        hideWrap.style.cssText = `display: flex; align-items: center; gap: 8px;`;
        const hideDash = document.createElement('span');
        hideDash.textContent = '-';
        hideDash.style.cssText = `opacity: 0.7;`;
        const hideHint = document.createElement('div');
        hideHint.textContent = '全日(0-24)生效';
        hideWrap.appendChild(hideEnabledInput);
        hideWrap.appendChild(hideStartInput);
        hideWrap.appendChild(hideDash);
        hideWrap.appendChild(hideEndInput);
        const hideStack = document.createElement('div');
        hideStack.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
        hideHint.style.cssText = `opacity: 0.65; font-size: 12px;`;
        hideStack.appendChild(hideWrap);
        hideStack.appendChild(hideHint);
        content.appendChild(rowStack('隐藏时间段', hideStack));

        const scaleSelect = document.createElement('select');
        scaleSelect.style.cssText = `width: 120px; padding: 6px 8px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);`;
        (isMobile ? [60] : [30, 60]).forEach((m) => {
            const opt = document.createElement('option');
            opt.value = String(m);
            opt.textContent = `${m} 分钟`;
            if (Number(userSettings.timeline.scaleMinutes) === m) opt.selected = true;
            scaleSelect.appendChild(opt);
        });
        if (isMobile) {
            scaleSelect.disabled = true;
            scaleSelect.style.opacity = '0.7';
            scaleSelect.style.cursor = 'not-allowed';
        }
        content.appendChild(row('刻度间隔', scaleSelect));

        const opacityWrap = document.createElement('div');
        opacityWrap.style.cssText = `display: flex; gap: 8px; align-items: center;`;
        const collapsedOpacity = document.createElement('input');
        collapsedOpacity.type = 'number';
        collapsedOpacity.min = '0.1';
        collapsedOpacity.max = '1';
        collapsedOpacity.step = '0.1';
        collapsedOpacity.value = String(userSettings.timeline.collapsedOpacity);
        collapsedOpacity.style.cssText = `width: 56px; padding: 6px 8px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);`;
        const expandedOpacity = document.createElement('input');
        expandedOpacity.type = 'number';
        expandedOpacity.min = '0.1';
        expandedOpacity.max = '1';
        expandedOpacity.step = '0.1';
        expandedOpacity.value = String(userSettings.timeline.expandedOpacity);
        expandedOpacity.style.cssText = collapsedOpacity.style.cssText;
        const opLabel1 = document.createElement('span');
        opLabel1.textContent = '收起';
        opLabel1.style.cssText = `opacity: 0.7; font-size: 12px;`;
        const opLabel2 = document.createElement('span');
        opLabel2.textContent = '展开';
        opLabel2.style.cssText = `opacity: 0.7; font-size: 12px;`;
        opacityWrap.appendChild(opLabel1);
        opacityWrap.appendChild(collapsedOpacity);
        opacityWrap.appendChild(opLabel2);
        opacityWrap.appendChild(expandedOpacity);
        content.appendChild(row('透明度', opacityWrap));

        const heightWrap = document.createElement('div');
        heightWrap.style.cssText = `display: flex; gap: 8px; align-items: center;`;
        const collapsedHeight = document.createElement('input');
        collapsedHeight.type = 'number';
        collapsedHeight.min = '3';
        collapsedHeight.max = '20';
        collapsedHeight.step = '1';
        collapsedHeight.value = String(userSettings.timeline.collapsedHeightPx);
        collapsedHeight.style.cssText = `width: 56px; padding: 6px 8px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);`;
        const expandedHeight = document.createElement('input');
        expandedHeight.type = 'number';
        expandedHeight.min = '20';
        expandedHeight.max = '80';
        expandedHeight.step = '1';
        expandedHeight.value = String(userSettings.timeline.expandedHeightPx);
        expandedHeight.style.cssText = collapsedHeight.style.cssText;
        const htLabel1 = document.createElement('span');
        htLabel1.textContent = '收起px';
        htLabel1.style.cssText = `opacity: 0.7; font-size: 12px;`;
        const htLabel2 = document.createElement('span');
        htLabel2.textContent = '展开px';
        htLabel2.style.cssText = `opacity: 0.7; font-size: 12px;`;
        heightWrap.appendChild(htLabel1);
        heightWrap.appendChild(collapsedHeight);
        heightWrap.appendChild(htLabel2);
        heightWrap.appendChild(expandedHeight);
        content.appendChild(row('高度', heightWrap));

        const highlightWrap = document.createElement('div');
        highlightWrap.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;

        const createColorRow = (labelText, colorValue) => {
            const r = document.createElement('div');
            r.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
            const label = document.createElement('div');
            label.textContent = labelText;
            label.style.cssText = `font-size: 12px; opacity: 0.85;`;
            if (!isMobile) {
                const input = document.createElement('input');
                input.type = 'color';
                input.value = colorValue;
                input.style.cssText = `width: 44px; height: 28px; padding: 0; border: none; background: transparent; cursor: pointer;`;
                r.appendChild(label);
                r.appendChild(input);
                return { rowEl: r, inputEl: input, getValue: () => input.value };
            }

            r.appendChild(label);
            const picker = createMobileColorPickerButton(labelText, colorValue, () => applyHighlightColorChange(), { defaultColor: '#F44336', showHexText: true });
            r.appendChild(picker.element);
            return { rowEl: r, inputEl: null, getValue: picker.getColor };
        };

        const tomatoHighlight = createColorRow('🍅 番茄记录', userSettings.timeline.highlightColors.tomato);
        const stopwatchHighlight = createColorRow('⏱️ 正计时记录', userSettings.timeline.highlightColors.stopwatch);
        const breakHighlight = createColorRow('☕ 休息记录', userSettings.timeline.highlightColors.break);
        highlightWrap.appendChild(tomatoHighlight.rowEl);
        highlightWrap.appendChild(stopwatchHighlight.rowEl);
        highlightWrap.appendChild(breakHighlight.rowEl);
        content.appendChild(rowStack('记录高亮颜色', highlightWrap));

        const applyHighlightColorChange = async () => {
            ensureTimelineDefaults();
            userSettings.timeline.highlightColors = {
                tomato: tomatoHighlight.getValue(),
                stopwatch: stopwatchHighlight.getValue(),
                break: breakHighlight.getValue()
            };
            await saveUserSettings();
            if (userSettings.timeline.enabled) updateTimelineBar();
        };
        if (tomatoHighlight.inputEl) tomatoHighlight.inputEl.onchange = applyHighlightColorChange;
        if (stopwatchHighlight.inputEl) stopwatchHighlight.inputEl.onchange = applyHighlightColorChange;
        if (breakHighlight.inputEl) breakHighlight.inputEl.onchange = applyHighlightColorChange;

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存配置';
        saveBtn.style.cssText = `
            width: 100%; padding: 10px 8px; background: var(--b3-theme-primary); color: #fff;
            border: none; border-radius: 4px; cursor: pointer; margin-top: 4px;
        `;
        saveBtn.onclick = async () => {
            ensureTimelineDefaults();
            const startMin = parseTimeToMinutes(startInput.value);
            const endMin = parseTimeToMinutes(endInput.value);
            if (startMin == null || endMin == null) {
                alert('请输入正确的时间格式：HH:MM（例如 08:00，结束可用 24:00）');
                return;
            }
            if (startMin >= endMin) {
                alert('起始时间必须小于结束时间');
                return;
            }

            userSettings.timeline.startTime = String(startInput.value || '').trim();
            userSettings.timeline.endTime = String(endInput.value || '').trim();
            const hideEnabled = !!hideEnabledInput.checked;
            if (hideEnabled) {
                const hs = parseTimeToMinutes(hideStartInput.value);
                const he = parseTimeToMinutes(hideEndInput.value);
                if (hs == null || he == null) {
                    alert('隐藏时间段请输入正确的时间格式：HH:MM（例如 00:00，结束可用 24:00）');
                    return;
                }
                if (hs >= he) {
                    alert('隐藏时间段：起始时间必须小于结束时间');
                    return;
                }
                if (he - hs >= 1440) {
                    alert('隐藏时间段不能覆盖全天');
                    return;
                }
            }
            userSettings.timeline.hiddenTimeRange = {
                enabled: hideEnabled,
                start: String(hideStartInput.value || '').trim() || '00:00',
                end: String(hideEndInput.value || '').trim() || '06:00'
            };
            const nextScale = parseInt(scaleSelect.value, 10) || 60;
            userSettings.timeline.scaleMinutes = nextScale === 15 ? 30 : nextScale;
            userSettings.timeline.enableBreathing = breathingInput.checked;
            userSettings.timeline.collapsedOpacity = Math.max(0.1, Math.min(1, parseFloat(collapsedOpacity.value) || 0.7));
            userSettings.timeline.expandedOpacity = Math.max(0.1, Math.min(1, parseFloat(expandedOpacity.value) || 1));
            userSettings.timeline.collapsedHeightPx = Math.max(3, Math.min(20, parseInt(collapsedHeight.value, 10) || 7));
            userSettings.timeline.expandedHeightPx = Math.max(10, Math.min(80, parseInt(expandedHeight.value, 10) || 27));
            userSettings.timeline.highlightColors = {
                tomato: tomatoHighlight.getValue(),
                stopwatch: stopwatchHighlight.getValue(),
                break: breakHighlight.getValue()
            };

            await saveUserSettings();
            updateProgressBar();

            dialog.remove();
            backdrop.remove();
        };
        content.appendChild(saveBtn);

        dialog.appendChild(content);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
    }

    function showSystemNotification(title, body) {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
        if (Notification.permission === 'granted') new Notification(title, { body });
    }

    async function resetToLastTomato() {
        if (isRunning || (timerMode === 'countdown' && remainingSeconds < currentDuration * 60)) {
            // 🔧 修复：正计时模式下需要传递 isStopwatch = true
            await recordEndTime(false, timerMode === 'stopwatch' || timerMode === 'stopwatch-break');
        }
        await stopTimer();
        pausedRemainingSeconds = null;
        isRunning = false;
        timerMode = 'countdown';
        currentDuration = lastTomatoConfig.duration;
        remainingSeconds = lastTomatoConfig.duration * 60;
        elapsedSeconds = 0;
        stopwatchDisplayOffset = 0;  // 🔧 重置时清除显示偏移
        currentStartTimestamp = null;
        currentStartTimeMs = 0;
        preBreakState = null;
        lastTickTime = 0;
        // 注意：不再自动清除任务块关联，用户可以通过📋️图标的删除按钮手动清除
        if (controlButton) controlButton.innerHTML = '▶️';
        updateDisplay();
        
        // 🔧 v9.0 修复：同步 countdown 模式到云端，确保状态一致
        if (isSyncEnabled() && SyncManager.updateLocal) {
            syncState.mode = 'countdown';
            syncState.duration = lastTomatoConfig.duration * 60;
            await SyncManager.updateLocal(syncState, true);
            Logger.info('🔄 resetToLastTomato: 状态已同步到云端');
        }
    }

    function showToastDialog(title, message, type = 'info', taskBlockId = null, taskBlockName = null) {
        if (type === 'tomato-end' || type === 'break-end') showSystemNotification(title, message);

        const existing = document.getElementById('tomy-tomato-toast');
        if (existing) existing.remove();

        // 保存任务块信息供弹窗按钮使用
        const savedTaskBlockId = taskBlockId;
        const savedTaskBlockName = taskBlockName;

        const backdrop = document.createElement('div');
        backdrop.id = 'tomy-tomato-backdrop';
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.3); z-index: 2147483647; pointer-events: none;
        `;

        const dialog = document.createElement('div');
        dialog.id = 'tomy-tomato-toast';
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: var(--b3-theme-background); border: 1px solid var(--b3-theme-surface-light);
            border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483648;
            padding: 20px; min-width: 280px; max-width: 90vw; text-align: center;
            pointer-events: auto; font-size: 14px; color: var(--b3-theme-on-background);
        `;

        const titleEl = document.createElement('div');
        titleEl.textContent = title;
        titleEl.style.cssText = `font-weight: bold; font-size: 16px; margin-bottom: 8px; color: var(--b3-theme-primary);`;

        const messageEl = document.createElement('div');
        messageEl.textContent = message;
        messageEl.style.cssText = `margin-bottom: 16px; white-space: pre-line;`;

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 12px;
        `;

        const closeDialog = () => {
            dialog.remove();
            backdrop.remove();
            document.removeEventListener('keydown', handleEsc);
            if (reminderIntervalId) {
                clearInterval(reminderIntervalId);
                reminderIntervalId = null;
            }
        };

        if (type === 'tomato-end') {
            // 休息按钮行（只保留休息计时）
            const breakRow = document.createElement('div');
            breakRow.style.cssText = `
                display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 10px;
            `;
            getBreakDurations().forEach(min => {
                const btn = document.createElement('button');
                btn.textContent = `☕ ${min}分钟`;
                btn.style.cssText = `padding: 8px 12px; background: #9E9E9E; color: white; border: 1px solid rgba(0,0,0,0.2);
                    border-radius: 8px; cursor: pointer; font-size: 13px; flex: 1; min-width: 60px;`;
                btn.onclick = async () => {
                    if (isRunning) await recordEndTime();
                    closeDialog();
                    startBreakMode(min);
                };
                breakRow.appendChild(btn);
            });
            // 正计时休息按钮放在休息行末尾
            const stopwatchRestBtn = document.createElement('button');
            stopwatchRestBtn.textContent = '计';
            stopwatchRestBtn.style.cssText = `padding: 8px 12px; background: #4CAF50; color: white; border: 1px solid rgba(0,0,0,0.2);
                border-radius: 8px; cursor: pointer; font-size: 13px; min-width: 40px;`;
            stopwatchRestBtn.onclick = async () => {
                if (isRunning) await recordEndTime();
                closeDialog();
                startStopwatchBreakMode();
            };
            breakRow.appendChild(stopwatchRestBtn);
            buttonContainer.appendChild(breakRow);
        } else if (type === 'break-end') {
            // 保存当前任务块信息
            const savedTaskBlockId = currentTaskBlockId;
            const savedTaskBlockName = currentTaskBlockName;
            
            const previousMode = preBreakState ? preBreakState.mode : 'countdown';
            
            if (previousMode === 'countdown') {
                getTomatoDurations().forEach(min => {
                    const btn = document.createElement('button');
                    btn.textContent = `🍅 ${min}分钟`;
                    btn.style.cssText = `padding: 8px 12px; background: var(--b3-theme-primary); color: white;
                        border: 1px solid rgba(0,0,0,0.2); border-radius: 8px; cursor: pointer; font-size: 13px; flex: 1; min-width: 60px;`;
                    btn.onclick = async () => {
                        if (isRunning) await recordEndTime();
                        closeDialog();
                        // 使用保存的任务块信息
                        if (savedTaskBlockId) {
                            switchToCountdownAndStartWithTask(min, savedTaskBlockId, savedTaskBlockName);
                        } else {
                            switchToCountdownAndStart(min);
                        }
                    };
                    buttonContainer.appendChild(btn);
                });
                
                // 添加正计时按钮
                const stopwatchBtn = document.createElement('button');
                stopwatchBtn.textContent = `⏱️ 正计时`;
                stopwatchBtn.style.cssText = `padding: 8px 12px; background: #4CAF50; color: white; border: 1px solid rgba(0,0,0,0.2);
                    border-radius: 8px; cursor: pointer; font-size: 13px; min-width: 60px;`;
                stopwatchBtn.onclick = async () => {
                    if (isRunning) await recordEndTime();
                    closeDialog();
                    // 使用保存的任务块信息
                    if (savedTaskBlockId) {
                        await switchToStopwatchAndStartWithTask(savedTaskBlockId, savedTaskBlockName);
                    } else {
                        await switchToStopwatchAndStart();
                    }
                };
                buttonContainer.appendChild(stopwatchBtn);
            } else if (previousMode === 'stopwatch') {
                getTomatoDurations().forEach(min => {
                    const btn = document.createElement('button');
                    btn.textContent = `🍅 ${min}分钟`;
                    btn.style.cssText = `padding: 8px 12px; background: var(--b3-theme-primary); color: white;
                        border: 1px solid rgba(0,0,0,0.2); border-radius: 8px; cursor: pointer; font-size: 13px; flex: 1; min-width: 60px;`;
                    btn.onclick = async () => {
                        if (isRunning) await recordEndTime();
                        closeDialog();
                        if (savedTaskBlockId) {
                            switchToCountdownAndStartWithTask(min, savedTaskBlockId, savedTaskBlockName);
                        } else {
                            switchToCountdownAndStart(min);
                        }
                    };
                    buttonContainer.appendChild(btn);
                });

                const continueBtn = document.createElement('button');
                continueBtn.textContent = `⏱️ 继续正计时`;
                continueBtn.style.cssText = `padding: 8px 12px; background: #4CAF50; color: white; border: 1px solid rgba(0,0,0,0.2);
                    border-radius: 8px; cursor: pointer; font-size: 13px; flex: 1; min-width: 80px;`;
                continueBtn.onclick = async () => {
                    if (isRunning) await recordEndTime();
                    closeDialog();
                    if (preBreakState && preBreakState.mode === 'stopwatch') {
                        timerMode = 'stopwatch';
                        // 🔧 修复：保存休息前的时间作为显示偏移，实际计时从0开始
                        stopwatchDisplayOffset = preBreakState.elapsedSeconds || 0;
                        elapsedSeconds = 0;
                        // 🔧 修复：清除开始时间，让 startTimer 设置新的开始时间
                        stopwatchStartTimestamp = null;
                        stopwatchStartTimeMs = 0;
                        isRunning = false;
                        pausedRemainingSeconds = null;
                        lastTickTime = 0;
                        
                        // 恢复任务块关联和高亮
                        if (savedTaskBlockId) {
                            currentTaskBlockId = savedTaskBlockId;
                            currentTaskBlockName = savedTaskBlockName;
                            highlightTaskBlock(savedTaskBlockId);
                            // 启动保持高亮的定时器
                            startHighlightKeepAlive();
                        }
                        
                        updateDisplay();
                        startTimer();
                    }
                };
                buttonContainer.appendChild(continueBtn);
            }
        }

        if (type === 'tomato-end' || type === 'break-end') {
            dialog.appendChild(buttonContainer);
            reminderIntervalId = setInterval(() => showSystemNotification(title, message), 60 * 1000);
        }

        const okBtn = document.createElement('button');
        okBtn.textContent = type === 'info' ? '确定' : '我知道了';
        okBtn.style.cssText = `
            padding: 8px 16px; background: var(--b3-theme-surface-light); color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-on-surface-light); border-radius: 8px; cursor: pointer; font-size: 14px;
        `;

        okBtn.onclick = async () => {
            if (type === 'break-end') {
                if (preBreakState) {
                    if (isRunning) {
                        await recordEndTime();
                    }
                    
                    if (preBreakState.mode === 'countdown') {
                        timerMode = 'countdown';
                        currentDuration = preBreakState.currentDuration;
                        remainingSeconds = preBreakState.remainingSeconds;
                        isRunning = false;
                        pausedRemainingSeconds = null;
                        lastTickTime = 0;
                        if (controlButton) controlButton.innerHTML = '▶️';
                        updateDisplay();
                        
                        // 🔧 v9.5：恢复番茄钟的 sessionId，供后续保存休息记录使用
                        if (pendingBreakSessionId) {
                            currentSessionId = pendingBreakSessionId;
                            Logger.info('🔍 okBtn.onclick: 从 pendingBreakSessionId 恢复 currentSessionId =', currentSessionId);
                        }
                    } else if (preBreakState.mode === 'stopwatch') {
                        timerMode = 'stopwatch';
                        // 🔧 修复：保存休息前的时间作为显示偏移，实际计时从0开始
                        stopwatchDisplayOffset = preBreakState.elapsedSeconds || 0;
                        elapsedSeconds = 0;
                        // 🔧 修复：清除开始时间，让 startTimer 设置新的开始时间
                        stopwatchStartTimestamp = null;
                        stopwatchStartTimeMs = 0;
                        isRunning = false;
                        pausedRemainingSeconds = null;
                        lastTickTime = 0;
                        // 🔧 修复：恢复后显示待开始按钮
                        if (controlButton) controlButton.innerHTML = '▶️';
                        updateDisplay();
                    }
                    
                    // 🔧 v9.0 修复：休息完成后恢复状态时同步到云端，防止轮询覆盖
                    if (isSyncEnabled() && SyncManager.updateLocal) {
                        syncState.mode = timerMode;
                        syncState.status = 'IDLE';
                        syncState.startTime = null;
                        syncState.pausedIntervals = [];
                        syncState.currentPauseStart = null;
                        syncState.pausedElapsedSeconds = null;
                        preBreakState = null;
                        await SyncManager.updateLocal(syncState, true);
                        Logger.info('🔄 休息完成后状态已同步到云端');
                    }
                } else {
                    await resetToLastTomato();
                }
            } else if (type === 'tomato-end') {
                await resetToLastTomato();
            }
            closeDialog();
        };

        dialog.appendChild(okBtn);

        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                if (type === 'break-end') {
                    if (preBreakState) {
                        if (isRunning) recordEndTime();
                        
                        if (preBreakState.mode === 'countdown') {
                            timerMode = 'countdown';
                            currentDuration = preBreakState.currentDuration;
                            remainingSeconds = preBreakState.remainingSeconds;
                            isRunning = false;
                            pausedRemainingSeconds = null;
                            lastTickTime = 0;
                            if (controlButton) controlButton.innerHTML = '▶️';
                            updateDisplay();
                        } else if (preBreakState.mode === 'stopwatch') {
                            timerMode = 'stopwatch';
                            // 🔧 修复：保存休息前的时间作为显示偏移，实际计时从0开始
                            stopwatchDisplayOffset = preBreakState.elapsedSeconds || 0;
                            elapsedSeconds = 0;
                            // 🔧 修复：清除开始时间，让 startTimer 设置新的开始时间
                            stopwatchStartTimestamp = null;
                            stopwatchStartTimeMs = 0;
                            isRunning = false;
                            pausedRemainingSeconds = null;
                            lastTickTime = 0;
                            // 🔧 修复：恢复后显示待开始按钮
                            if (controlButton) controlButton.innerHTML = '▶️';
                            updateDisplay();
                        }
                        
                        // 🔧 v9.0 修复：休息完成后按ESC恢复状态时同步到云端，防止轮询覆盖
                        if (isSyncEnabled() && SyncManager.updateLocal) {
                            syncState.mode = timerMode;
                            syncState.status = 'IDLE';
                            syncState.startTime = null;
                            syncState.pausedIntervals = [];
                            syncState.currentPauseStart = null;
                            syncState.pausedElapsedSeconds = null;
                            preBreakState = null;
                            SyncManager.updateLocal(syncState, true).then(() => {
                                Logger.info('🔄 休息完成(ESC)后状态已同步到云端');
                            });
                        }
                    } else {
                        resetToLastTomato();
                    }
                } else if (type === 'tomato-end') {
                    resetToLastTomato();
                }
                closeDialog();
            }
        };

        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);
        EventManager.add(document, 'keydown', handleEsc, false, 'toast-dialog');
        okBtn.focus();
    }

    function createProgressBar() {
        if (progressBar?.parentNode === document.body) return;
        if (progressBar) progressBar.remove();

        // 检查是否启用霓虹模式
        const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
        const themeConfig = isNeonMode ? getThemeConfig() : null;

        progressBar = document.createElement('div');
        progressBar.className = isNeonMode ? 'tomato-progress-bar neon-mode' : 'tomato-progress-bar';

        if (isNeonMode) {
            const intensity = userSettings.appearance?.neonIntensity || 0.8;
            progressBar.style.cssText = `
                position: fixed; bottom: 0; left: 0; height: 4px; z-index: 2147483647;
                pointer-events: none; width: 0%;
                background: linear-gradient(90deg, ${themeConfig.gradientStart}, ${themeConfig.gradientEnd});
                --neon-start: ${themeConfig.gradientStart};
                --neon-end: ${themeConfig.gradientEnd};
                --neon-glow: ${themeConfig.glowColor};
                box-shadow: 0 0 ${15 * intensity}px ${themeConfig.glowColor},
                            0 0 ${30 * intensity}px ${themeConfig.glowColor},
                            0 0 ${50 * intensity}px ${themeConfig.glowColor};
            `;

            // 呼吸动画由 updateProgressBar 动态控制：计时运行时才呼吸
            // 初始时不添加 breathing 类，等 updateProgressBar 处理
        } else {
            progressBar.style.cssText = `
                position: fixed; bottom: 0; left: 0; height: 3px; z-index: 2147483647;
                pointer-events: none; transition: width 0.3s ease-out; width: 0%;
            `;
        }

        document.body.appendChild(progressBar);
    }

    function createProgressIndicator() {
        if (progressIndicator?.parentNode === document.body) return;
        if (progressIndicator) progressIndicator.remove();

        // 检查是否启用显示指示器
        if (userSettings.appearance?.showIndicator === false) {
            // 用户关闭了指示器，不创建
            progressIndicator = null;
            return;
        }

        // 检查是否启用霓虹模式
        const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
        const themeConfig = isNeonMode ? getThemeConfig() : null;

        progressIndicator = document.createElement('div');
        progressIndicator.className = 'tomato-progress-indicator' + (isNeonMode ? ' neon-mode' : '');

        if (isNeonMode) {
            // 霓虹模式：三角形指示器（尖角朝下，尖端对准进度条顶端）
            // border-top 产生尖角朝下的三角形，尖端在元素顶部
            progressIndicator.style.cssText = `
                position: fixed; bottom: 4px; width: 0; height: 0;
                color: ${themeConfig.glowColor};
                z-index: 2147483648; pointer-events: none;
                transition: left 0.3s ease-out; display: none;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 6px solid currentColor;
            `;
            
            // 呼吸动画由 updateProgressBar 动态控制：计时运行时才呼吸
        } else {
            // 默认模式：简洁三角形指示器（v9.0样式）
            progressIndicator.style.cssText = `
                position: fixed; bottom: 0; width: 0; height: 0;
                border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 4px solid;
                z-index: 2147483648; pointer-events: none; transform: translateY(-4px);
                transition: left 0.3s ease-out; display: none;
            `;
        }

        document.body.appendChild(progressIndicator);
    }

    let timelineBar = null;
    let timelineVisual = null;
    let timelineNowLine = null;
    let timelineAxis = null;
    let timelineSegments = null;
    let timelineHistoryLayer = null;
    let timelineActiveLayer = null;
    let timelineViewport = null;
    let timelinePages = null;
    let timelineDayPages = [];
    let timelineDateOverlay = null;
    let timelineDateOverlayHideTimer = null;
    let timelineViewIndex = 2;
    let applyTimelineExpandedState = null;
    let timelineTooltip = null;
    let isTimelineExpanded = false;
    let isTimelineUserDragging = false;
    let timelineFullDayLocked = false;
    let timelineProgrammaticScrollUntilMs = 0;
    let timelineIgnoreClickUntilMs = 0;
    let timelineAxisLabelScaleX = 1;
    let timelineExpandedByClick = false;
    let timelineSnapRestoreTimer = null;
    let timelineSnapTypeBackup = null;
    let timelineSnapLockedOff = false;
    let timelineWheelSnapUntilMs = 0;
    let timelineTickId = null;
    let lastTimelineAxisKey = null;
    let timelineDisplayMap = { enabled: false, hidden: null, totalMinutes: 1440 };

    function setTimelineSnapEnabled(enabled, force = false) {
        if (!timelineViewport) return;
        if (!force && timelineSnapLockedOff) enabled = false;
        if (timelineSnapTypeBackup == null) {
            timelineSnapTypeBackup = timelineViewport.style.scrollSnapType || 'x mandatory';
        }
        if (timelineSnapRestoreTimer) {
            clearTimeout(timelineSnapRestoreTimer);
            timelineSnapRestoreTimer = null;
        }
        timelineViewport.style.scrollSnapType = enabled ? (timelineSnapTypeBackup || 'x mandatory') : 'none';
    }

    function disableTimelineSnapTemporarily(ms = 260) {
        if (!timelineViewport) return;
        setTimelineSnapEnabled(false);
        if (timelineSnapLockedOff) return;
        timelineSnapRestoreTimer = setTimeout(() => {
            timelineSnapRestoreTimer = null;
            setTimelineSnapEnabled(true);
        }, Math.max(80, ms));
    }

    function parseClockToMinutes(timeStr) {
        const raw = String(timeStr || '').trim();
        if (!raw) return null;
        if (raw === '24:00') return 1440;
        const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!match) return null;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function ensureTimelineSettings() {
        if (!userSettings.timeline) userSettings.timeline = {};
        if (typeof userSettings.timeline.enabled !== 'boolean') userSettings.timeline.enabled = false;
        if (typeof userSettings.timeline.enableBreathing !== 'boolean') userSettings.timeline.enableBreathing = true;
        if (!userSettings.timeline.startTime) userSettings.timeline.startTime = '08:00';
        if (!userSettings.timeline.endTime) userSettings.timeline.endTime = '24:00';
        if (!userSettings.timeline.scaleMinutes) userSettings.timeline.scaleMinutes = 60;
        if (Number(userSettings.timeline.scaleMinutes) === 15) userSettings.timeline.scaleMinutes = 30;
        if (isMobileDevice() && Number(userSettings.timeline.scaleMinutes) !== 60) userSettings.timeline.scaleMinutes = 60;
        if (!userSettings.timeline.hiddenTimeRange || typeof userSettings.timeline.hiddenTimeRange !== 'object') {
            userSettings.timeline.hiddenTimeRange = { enabled: false, start: '00:00', end: '06:00' };
        } else {
            if (typeof userSettings.timeline.hiddenTimeRange.enabled !== 'boolean') userSettings.timeline.hiddenTimeRange.enabled = false;
            if (!userSettings.timeline.hiddenTimeRange.start) userSettings.timeline.hiddenTimeRange.start = '00:00';
            if (!userSettings.timeline.hiddenTimeRange.end) userSettings.timeline.hiddenTimeRange.end = '06:00';
        }
        if (!userSettings.timeline.color) userSettings.timeline.color = '#AECBFA';
        if (userSettings.timeline.customColors == null) userSettings.timeline.customColors = null;
        if (userSettings.timeline.customColors && (typeof userSettings.timeline.customColors !== 'object')) userSettings.timeline.customColors = null;
        if (!userSettings.timeline.highlightColors || typeof userSettings.timeline.highlightColors !== 'object') {
            userSettings.timeline.highlightColors = {
                tomato: '#F44336',
                stopwatch: '#00C853',
                break: '#9E9E9E'
            };
        }
        if (!userSettings.timeline.highlightColors.tomato) userSettings.timeline.highlightColors.tomato = '#F44336';
        if (!userSettings.timeline.highlightColors.stopwatch) userSettings.timeline.highlightColors.stopwatch = '#00C853';
        if (!userSettings.timeline.highlightColors.break) userSettings.timeline.highlightColors.break = '#9E9E9E';
        if (typeof userSettings.timeline.collapsedHeightPx !== 'number') userSettings.timeline.collapsedHeightPx = 7;
        if (typeof userSettings.timeline.expandedHeightPx !== 'number') userSettings.timeline.expandedHeightPx = 27;
        if (typeof userSettings.timeline.hotAreaHeightPx !== 'number') userSettings.timeline.hotAreaHeightPx = 15;
        if (typeof userSettings.timeline.collapsedOpacity !== 'number') userSettings.timeline.collapsedOpacity = 0.7;
        if (typeof userSettings.timeline.expandedOpacity !== 'number') userSettings.timeline.expandedOpacity = 1;
    }

    function getTimelineHighlightPalette() {
        ensureTimelineSettings();
        const highlight = userSettings.timeline?.highlightColors || {};
        const tomatoColor = highlight.tomato || '#F44336';
        const stopwatchColor = highlight.stopwatch || '#00C853';
        const breakColor = highlight.break || '#9E9E9E';
        return {
            tomatoColor,
            stopwatchColor,
            breakColor,
            key: `${tomatoColor}-${stopwatchColor}-${breakColor}`
        };
    }

    function getTimelineRangeState() {
        ensureTimelineSettings();
        const rangeStartMin = parseClockToMinutes(userSettings.timeline.startTime);
        const rangeEndMin = parseClockToMinutes(userSettings.timeline.endTime);
        const hasCustomRange = rangeStartMin != null && rangeEndMin != null && rangeStartMin < rangeEndMin;
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const shouldApplyCustomRange = hasCustomRange && (nowMinutes >= rangeStartMin && nowMinutes <= rangeEndMin);
        return { rangeStartMin, rangeEndMin, hasCustomRange, nowMinutes, shouldApplyCustomRange };
    }

    function getTimelineHiddenTimeRangeState() {
        ensureTimelineSettings();
        const cfg = userSettings.timeline.hiddenTimeRange || {};
        const enabled = !!cfg.enabled;
        const startMin = parseClockToMinutes(cfg.start);
        const endMin = parseClockToMinutes(cfg.end);
        const valid = enabled && startMin != null && endMin != null && startMin < endMin && endMin <= 1440 && startMin >= 0 && (endMin - startMin) < 1440;
        const duration = valid ? (endMin - startMin) : 0;
        return { enabled: valid, startMin: startMin ?? 0, endMin: endMin ?? 0, duration };
    }

    function mapTimelineMinuteToDisplay(minuteOfDay, displayMap = timelineDisplayMap) {
        const m = Number(minuteOfDay);
        if (!displayMap?.enabled || !displayMap.hidden) return m;
        const h = displayMap.hidden;
        if (m <= h.startMin) return m;
        if (m >= h.endMin) return m - h.duration;
        return null;
    }

    function splitTimelineRangeByHidden(startMin, endMin, displayMap = timelineDisplayMap) {
        const s = Number(startMin);
        const e = Number(endMin);
        if (!(e > s)) return [];
        if (!displayMap?.enabled || !displayMap.hidden) return [{ startMin: s, endMin: e }];
        const h = displayMap.hidden;
        if (e <= h.startMin || s >= h.endMin) return [{ startMin: s, endMin: e }];
        const parts = [];
        if (s < h.startMin) parts.push({ startMin: s, endMin: Math.min(e, h.startMin) });
        if (e > h.endMin) parts.push({ startMin: Math.max(s, h.endMin), endMin: e });
        return parts.filter(p => p.endMin > p.startMin);
    }

    function dayMinuteToIso(baseIso, minuteOfDay) {
        try {
            const ref = new Date(baseIso);
            if (isNaN(ref.getTime())) return null;
            const startOfDay = new Date(ref);
            startOfDay.setHours(0, 0, 0, 0);
            return new Date(startOfDay.getTime() + Number(minuteOfDay) * 60 * 1000).toISOString();
        } catch (e) {
            return null;
        }
    }

    function getTimelineCustomColorConfig() {
        ensureTimelineSettings();
        const baseColor = userSettings.timeline.color || '#AECBFA';
        const custom = userSettings.timeline.customColors;
        if (custom && custom.start && custom.end && custom.glow) {
            return {
                gradientStart: custom.start,
                gradientEnd: custom.end,
                glowColor: custom.glow
            };
        }
        return {
            gradientStart: baseColor,
            gradientEnd: adjustColor(baseColor, -20),
            glowColor: baseColor
        };
    }

    function createTimelineBar() {
        if (timelineBar && timelineBar.parentNode === document.body) return;
        if (timelineBar) timelineBar.remove();

        ensureTimelineSettings();

        const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
        const themeConfig = isNeonMode ? getThemeConfig() : null;
        const neonIntensity = userSettings.appearance?.neonIntensity || 0.8;

        const hotAreaHeightPx = Math.max(10, userSettings.timeline.hotAreaHeightPx || 15);
        const collapsedHeightPx = Math.max(3, userSettings.timeline.collapsedHeightPx || 7);
        const expandedHeightPx = Math.max(collapsedHeightPx, userSettings.timeline.expandedHeightPx || 27);
        const collapsedOpacity = Math.max(0.1, Math.min(1, userSettings.timeline.collapsedOpacity ?? 0.7));
        const expandedOpacity = Math.max(0.1, Math.min(1, userSettings.timeline.expandedOpacity ?? 1));
        const baseColor = userSettings.timeline.color || '#AECBFA';
        const hasTimelineCustomColors = !isNeonMode && !!userSettings.timeline.customColors;
        const timelineCustomConfig = hasTimelineCustomColors ? getTimelineCustomColorConfig() : null;
        const visualBg = (isNeonMode && themeConfig)
            ? `linear-gradient(90deg, ${themeConfig.gradientStart}, ${themeConfig.gradientEnd})`
            : (hasTimelineCustomColors && timelineCustomConfig)
                ? `linear-gradient(90deg, ${timelineCustomConfig.gradientStart}, ${timelineCustomConfig.gradientEnd})`
                : baseColor;

        timelineBar = document.createElement('div');
        timelineBar.id = 'tomato-timeline-bar';
        timelineBar.style.cssText = `
            position: fixed; bottom: 0; left: 0; width: 100%;
            height: ${hotAreaHeightPx}px;
            background: transparent;
            z-index: 2147483647; pointer-events: auto;
            transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        timelineVisual = document.createElement('div');
        timelineVisual.className = 'timeline-visual';
        timelineVisual.style.cssText = `
            position: absolute; bottom: 0; left: 0; width: 100%;
            height: ${collapsedHeightPx}px;
            background: ${visualBg};
            opacity: ${collapsedOpacity};
            border-top: 1px solid rgba(255,255,255,0.3);
            box-shadow: 0 -1px 3px rgba(0,0,0,0.12);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
        `;
        if (isNeonMode && themeConfig) {
            timelineVisual.classList.add('neon-mode');
            timelineVisual.style.setProperty('--neon-glow', themeConfig.glowColor);
            timelineVisual.style.setProperty('--neon-start', themeConfig.gradientStart);
            timelineVisual.style.setProperty('--neon-end', themeConfig.gradientEnd);
            timelineVisual.style.boxShadow = `0 0 ${12 * neonIntensity}px ${themeConfig.glowColor}, 0 0 ${24 * neonIntensity}px ${themeConfig.glowColor}`;
        } else if (hasTimelineCustomColors && timelineCustomConfig) {
            timelineVisual.style.setProperty('--neon-glow', timelineCustomConfig.glowColor);
            timelineVisual.style.setProperty('--neon-start', timelineCustomConfig.gradientStart);
            timelineVisual.style.setProperty('--neon-end', timelineCustomConfig.gradientEnd);
            timelineVisual.style.boxShadow = `0 0 ${10 * neonIntensity}px ${timelineCustomConfig.glowColor}, 0 0 ${18 * neonIntensity}px ${timelineCustomConfig.glowColor}`;
        }
        timelineBar.appendChild(timelineVisual);

        timelineViewport = document.createElement('div');
        timelineViewport.className = 'timeline-viewport';
        timelineViewport.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            overflow-x: hidden; overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            touch-action: pan-x;
        `;
        timelineVisual.appendChild(timelineViewport);

        timelinePages = document.createElement('div');
        timelinePages.className = 'timeline-pages';
        timelinePages.style.cssText = `
            display: flex;
            width: 300%;
            flex-wrap: nowrap;
            height: 100%;
        `;
        timelineViewport.appendChild(timelinePages);

        timelineDayPages = [];
        const dayOffsets = [-2, -1, 0];
        const nowLineColor = getTimelineIndicatorColor(themeConfig, timelineCustomConfig);

        for (let i = 0; i < dayOffsets.length; i += 1) {
            const dayOffset = dayOffsets[i];
            const page = document.createElement('div');
            page.className = 'timeline-day-page';
            page.style.cssText = `
                flex: 0 0 33.333333%;
                width: 33.333333%;
                height: 100%;
                position: relative;
                overflow: hidden;
                scroll-snap-align: start;
            `;

            const pageContent = document.createElement('div');
            pageContent.className = 'timeline-page-content';
            pageContent.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                transform-origin: 0 50%;
                transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform;
            `;
            page.appendChild(pageContent);

            const axis = document.createElement('div');
            axis.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; opacity: 0; transition: opacity 0.2s;
            `;
            pageContent.appendChild(axis);

            const segments = document.createElement('div');
            segments.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: auto;
            `;
            const historyLayer = document.createElement('div');
            historyLayer.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: auto; z-index: 1;
            `;
            segments.appendChild(historyLayer);

            const activeLayer = document.createElement('div');
            activeLayer.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; z-index: 2;
            `;
            segments.appendChild(activeLayer);
            pageContent.appendChild(segments);

            const hiddenMask = document.createElement('div');
            hiddenMask.style.cssText = `
                position: absolute; top: 0; left: 0; height: 100%;
                background: var(--b3-theme-background);
                z-index: 6;
                pointer-events: auto;
                display: none;
            `;
            pageContent.appendChild(hiddenMask);

            const nowLine = document.createElement('div');
            nowLine.style.cssText = `
                position: absolute; top: 0; bottom: 0; width: 2px;
                background: ${nowLineColor}; z-index: 10;
                box-shadow: 0 0 4px rgba(0,0,0,0.2);
                transition: left 1s linear;
                pointer-events: none;
                display: ${dayOffset === 0 ? 'block' : 'none'};
            `;
            if (isNeonMode && themeConfig) {
                nowLine.classList.add('neon-mode');
                nowLine.style.boxShadow = `0 0 ${12 * neonIntensity}px ${nowLineColor}, 0 0 ${22 * neonIntensity}px ${nowLineColor}`;
            } else if (hasTimelineCustomColors && timelineCustomConfig) {
                nowLine.style.boxShadow = `0 0 ${12 * neonIntensity}px ${nowLineColor}, 0 0 ${22 * neonIntensity}px ${nowLineColor}`;
            }
            nowLine.style.width = '2px';
            nowLine.style.outline = 'none';
            nowLine.style.filter = 'saturate(1.35) contrast(1.12) drop-shadow(0 0 2px rgba(0,0,0,0.35))';
            const arrow = document.createElement('div');
            arrow.style.cssText = `
                position: absolute; top: 0; left: -4px;
                width: 0; height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 7px solid ${nowLineColor};
                pointer-events: none;
                filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
            `;
            nowLine.appendChild(arrow);
            page.appendChild(nowLine);

            timelinePages.appendChild(page);
            timelineDayPages.push({
                index: i,
                dayOffset,
                pageEl: page,
                contentEl: pageContent,
                axisEl: axis,
                segmentsEl: segments,
                historyLayerEl: historyLayer,
                activeLayerEl: activeLayer,
                hiddenMaskEl: hiddenMask,
                nowLineEl: nowLine
            });

            if (dayOffset === 0) {
                timelineAxis = axis;
                timelineSegments = segments;
                timelineHistoryLayer = historyLayer;
                timelineActiveLayer = activeLayer;
                timelineNowLine = nowLine;
            }
        }

        if (!timelineDateOverlay) {
            timelineDateOverlay = document.createElement('div');
            timelineDateOverlay.id = 'tomato-timeline-date-overlay';
            timelineDateOverlay.style.cssText = `
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                bottom: 36px;
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
                border: 1px solid var(--b3-theme-surface-light);
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                z-index: 2147483647;
                display: none;
                pointer-events: none;
                white-space: nowrap;
            `;
        }
        if (!timelineDateOverlay.parentNode) timelineBar.appendChild(timelineDateOverlay);

        function scrollToTodaySafe(animate = false) {
            if (!timelineViewport) return;
            let tries = 0;
            const step = () => {
                if (!timelineViewport) return;
                const w = timelineViewport.clientWidth || 0;
                if (w < 20) {
                    tries += 1;
                    if (tries <= 12) requestAnimationFrame(step);
                    return;
                }
                timelineProgrammaticScrollUntilMs = Date.now() + 600;
                timelineViewIndex = 2;
                const left = w * 2;
                try {
                    timelineViewport.scrollTo({ left, top: 0, behavior: animate ? 'smooth' : 'auto' });
                } catch (e) {
                    timelineViewport.scrollLeft = left;
                }
            };
            step();
        }

        const applyExpandedState = (expanded, scrollToTodayOnExpand = true) => {
            ensureTimelineSettings();
            const hotArea = Math.max(10, userSettings.timeline.hotAreaHeightPx || 15);
            const collapsedH = Math.max(3, userSettings.timeline.collapsedHeightPx || 7);
            const expandedH = Math.max(collapsedH, userSettings.timeline.expandedHeightPx || 27);
            const collapsedOp = Math.max(0.1, Math.min(1, userSettings.timeline.collapsedOpacity ?? 0.7));
            const expandedOp = Math.max(0.1, Math.min(1, userSettings.timeline.expandedOpacity ?? 1));

            const wasExpanded = isTimelineExpanded;
            isTimelineExpanded = expanded;
            if (!expanded) {
                timelineFullDayLocked = false;
                timelineExpandedByClick = false;
                timelineSnapLockedOff = false;
                setTimelineSnapEnabled(true, true);
            }
            timelineBar.style.height = `${expanded ? expandedH : hotArea}px`;
            timelineVisual.style.height = `${expanded ? expandedH : collapsedH}px`;
            timelineVisual.style.opacity = String(expanded ? expandedOp : collapsedOp);
            timelineVisual.style.overflow = expanded ? 'visible' : 'hidden';
            if (timelineViewport) {
                timelineViewport.style.overflowX = expanded ? 'auto' : 'hidden';
                if (expanded && !wasExpanded && scrollToTodayOnExpand) {
                    scrollToTodaySafe(false);
                }
                if (!expanded) {
                    scrollToTodaySafe(false);
                    if (timelineDateOverlay) timelineDateOverlay.style.display = 'none';
                }
            }
            for (const p of timelineDayPages) {
                if (p?.axisEl) p.axisEl.style.opacity = expanded ? '1' : '0';
            }
            lastTimelineAxisKey = null;
            updateTimelineBar();
        };
        applyTimelineExpandedState = applyExpandedState;

        timelineBar.addEventListener('mouseenter', () => {
            if (isMobileDevice()) return;
            if (timelineExpandedByClick) return;
            if (!isTimelineExpanded) applyExpandedState(true, true);
        });
        timelineBar.addEventListener('mouseleave', () => {
            if (isMobileDevice()) return;
            if (timelineExpandedByClick) return;
            if (isTimelineUserDragging) return;
            if (isTimelineExpanded) applyExpandedState(false);
        });

        timelineBar.addEventListener('click', (e) => {
            if (isMobileDevice()) return;
            if (e.button !== 0) return;
            if (Date.now() < (timelineIgnoreClickUntilMs || 0)) return;
            if (isTimelineUserDragging) return;
            const target = e?.target || null;
            if (target && target.closest && target.closest('.timeline-segment')) return;
            if (!isTimelineExpanded) {
                timelineExpandedByClick = true;
                applyExpandedState(true, true);
                return;
            }
            if (!timelineExpandedByClick) {
                timelineExpandedByClick = true;
            }
        }, true);

        const pickTimelineSegmentFromPoint = (clientX, clientY, target) => {
            try {
                const t = target || null;
                if (t && t.closest) {
                    const direct = t.closest('.timeline-segment');
                    if (direct) return direct;
                }
                const el = document.elementFromPoint(clientX, clientY);
                if (el && el.closest) {
                    const seg = el.closest('.timeline-segment');
                    if (seg) return seg;
                }
            } catch (e) {}
            return null;
        };

        let lastTimelineHoverSeg = null;
        timelineBar.addEventListener('mousemove', (e) => {
            if (isMobileDevice()) return;
            const seg = pickTimelineSegmentFromPoint(e.clientX, e.clientY, e.target);
            if (!seg) {
                lastTimelineHoverSeg = null;
                return;
            }
            if (seg === lastTimelineHoverSeg) return;
            lastTimelineHoverSeg = seg;
            showTimelineTooltipForSegment(seg);
        }, { passive: true, capture: true });

        timelineBar.addEventListener('click', (e) => {
            const seg = pickTimelineSegmentFromPoint(e.clientX, e.clientY, e.target);
            if (!seg) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showTimelineTooltipForSegment(seg);
        }, true);

        let isRightClick = false;
        let longPressTimer = null;
        timelineBar.addEventListener('mousedown', (e) => {
            if (e.button !== 2) return;
            isRightClick = true;
            longPressTimer = setTimeout(() => {
                resetCurrentMode();
                isRightClick = false;
            }, 500);
        });

        timelineBar.addEventListener('mouseup', (e) => {
            if (!isRightClick) return;
            clearTimeout(longPressTimer);
            if (e.button === 2) {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY);
            }
            isRightClick = false;
        });

        timelineBar.addEventListener('contextmenu', (e) => {
            if (isRightClick) e.preventDefault();
        });

        let touchLongPressTimer = null;
        let touchMoved = false;
        let longPressed = false;
        let startX = 0;
        let startY = 0;

        timelineBar.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            touchMoved = false;
            longPressed = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
            touchLongPressTimer = setTimeout(() => {
                longPressed = true;
                showContextMenu(startX, startY);
            }, 500);
        }, { passive: true, capture: true });

        timelineBar.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const dx = Math.abs(e.touches[0].clientX - startX);
            const dyAbs = Math.abs(e.touches[0].clientY - startY);
            const dy = e.touches[0].clientY - startY;
            if (dx + dyAbs > 35) {
                touchMoved = true;
                if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
                touchLongPressTimer = null;
            }
            if (isMobileDevice() && isTimelineExpanded && dy > 48 && dyAbs > dx * 1.2) {
                touchMoved = true;
                if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
                touchLongPressTimer = null;
                applyExpandedState(false);
                try { e.preventDefault(); } catch (err) {}
            }
        }, { passive: false, capture: true });

        timelineBar.addEventListener('touchend', (e) => {
            if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
            touchLongPressTimer = null;
            if (longPressed) return;
            if (touchMoved) return;
            if (!isTimelineExpanded) {
                applyExpandedState(true, true);
                return;
            }
            const target = e?.target || null;
            if (target && target.closest && target.closest('.timeline-segment')) return;
            applyExpandedState(false);
        }, { passive: true, capture: true });

        document.body.appendChild(timelineBar);
        scrollToTodaySafe(false);

        if (timelineViewport && !timelineViewport.dataset.timelineBound) {
            timelineViewport.dataset.timelineBound = '1';

            const getIndexFromScroll = () => {
                const w = timelineViewport.clientWidth || 1;
                const idx = Math.round(timelineViewport.scrollLeft / w);
                return Math.max(0, Math.min(2, idx));
            };

            const showDateOverlayByIndex = (idx) => {
                if (!timelineDateOverlay) return;
                const d = new Date();
                d.setDate(d.getDate() + (idx - 2));
                timelineDateOverlay.textContent = formatDateKey(d);
                timelineDateOverlay.style.display = 'block';
                if (timelineDateOverlayHideTimer) clearTimeout(timelineDateOverlayHideTimer);
                timelineDateOverlayHideTimer = setTimeout(() => {
                    if (!isTimelineExpanded) {
                        timelineDateOverlay.style.display = 'none';
                        return;
                    }
                    timelineDateOverlay.style.display = 'none';
                }, 1200);
            };

            const snapToNearestDayPage = (animate = true, dragInfo = null, explicitIndex = null) => {
                if (!timelineViewport) return;
                const w = timelineViewport.clientWidth || 1;
                const raw = timelineViewport.scrollLeft / w;
                let idx = explicitIndex == null
                    ? Math.max(0, Math.min(2, Math.round(raw)))
                    : Math.max(0, Math.min(2, explicitIndex));
                if (dragInfo && dragInfo.moved && typeof dragInfo.dx === 'number' && typeof dragInfo.startIndex === 'number') {
                    const dx = dragInfo.dx;
                    if (Math.abs(dx) > 5) {
                        idx = Math.max(0, Math.min(2, dragInfo.startIndex + (dx > 0 ? -1 : 1)));
                    }
                }
                const left = w * idx;
                timelineProgrammaticScrollUntilMs = Date.now() + 450;
                timelineViewIndex = idx;
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                showDateOverlayByIndex(timelineViewIndex);
                try {
                    timelineViewport.scrollTo({ left, top: 0, behavior: animate ? 'smooth' : 'auto' });
                } catch (e) {
                    timelineViewport.scrollLeft = left;
                }
            };

            timelineViewport.addEventListener('scroll', () => {
                if (!isTimelineExpanded) return;
                timelineViewIndex = getIndexFromScroll();
                showDateOverlayByIndex(timelineViewIndex);
                if (Date.now() < (timelineProgrammaticScrollUntilMs || 0)) return;
                const w = timelineViewport?.clientWidth || 1;
                if (w < 20) return;
                const offset = timelineViewport ? Math.abs(timelineViewport.scrollLeft - w * 2) : 0;
                const shouldLock = isMobileDevice()
                    ? (timelineViewIndex !== 2)
                    : (timelineViewIndex !== 2 || offset > w * 0.12);
                if (shouldLock && !timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
            }, { passive: true });

            timelineViewport.addEventListener('wheel', (e) => {
                if (!isTimelineExpanded) return;
                if (isMobileDevice()) return;
                timelineSnapLockedOff = true;
                disableTimelineSnapTemporarily(260);
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                const dx = Math.abs(e.deltaX);
                const dy = Math.abs(e.deltaY);
                const delta = dx > dy ? e.deltaX : e.deltaY;
                const now = Date.now();
                if (now >= (timelineWheelSnapUntilMs || 0) && Math.abs(delta) > 1) {
                    const cur = getIndexFromScroll();
                    const target = Math.max(0, Math.min(2, cur + (delta < 0 ? -1 : 1)));
                    timelineWheelSnapUntilMs = now + 420;
                    snapToNearestDayPage(true, null, target);
                }
                e.preventDefault();
            }, { passive: false });

            timelineBar.addEventListener('wheel', (e) => {
                if (!isTimelineExpanded) return;
                if (isMobileDevice()) return;
                timelineSnapLockedOff = true;
                disableTimelineSnapTemporarily(260);
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                const dx = Math.abs(e.deltaX);
                const dy = Math.abs(e.deltaY);
                const delta = dx > dy ? e.deltaX : e.deltaY;
                const now = Date.now();
                if (now >= (timelineWheelSnapUntilMs || 0) && Math.abs(delta) > 1) {
                    const cur = getIndexFromScroll();
                    const target = Math.max(0, Math.min(2, cur + (delta < 0 ? -1 : 1)));
                    timelineWheelSnapUntilMs = now + 420;
                    snapToNearestDayPage(true, null, target);
                }
                e.preventDefault();
            }, { passive: false, capture: true });

            let isDragging = false;
            let pointerDragging = false;
            let pointerId = null;
            let dragStartX = 0;
            let dragStartScrollLeft = 0;
            let dragStartIndex = 2;
            let lastDragDx = 0;
            let dragMoved = false;

            const onMouseMove = (e) => {
                if (!isDragging) return;
                if ((e.buttons & 1) === 0) {
                    onMouseUp();
                    return;
                }
                const dx = e.clientX - dragStartX;
                lastDragDx = dx;
                if (Math.abs(dx) > 5) dragMoved = true;
                timelineSnapLockedOff = true;
                setTimelineSnapEnabled(false);
                timelineViewport.scrollLeft = dragStartScrollLeft - dx;
                timelineViewIndex = getIndexFromScroll();
                showDateOverlayByIndex(timelineViewIndex);
                const w = timelineViewport?.clientWidth || 1;
                const offset = timelineViewport ? Math.abs(timelineViewport.scrollLeft - w * 2) : 0;
                if ((timelineViewIndex !== 2 || offset > w * 0.12) && !timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                e.preventDefault();
            };

            const onMouseUp = () => {
                if (!isDragging) return;
                isDragging = false;
                isTimelineUserDragging = false;
                try { document.body.style.userSelect = ''; } catch (e) {}
                window.removeEventListener('mousemove', onMouseMove, true);
                window.removeEventListener('mouseup', onMouseUp, true);
                if (dragMoved) timelineIgnoreClickUntilMs = Date.now() + 350;
                setTimeout(() => { dragMoved = false; }, 0);
                if (!isMobileDevice()) snapToNearestDayPage(true, { moved: dragMoved, dx: lastDragDx, startIndex: dragStartIndex });
            };

            timelineViewport.addEventListener('mousedown', (e) => {
                if (pointerDragging) return;
                if (!isTimelineExpanded) return;
                if (isMobileDevice()) return;
                if (e.button !== 0) return;
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                isDragging = true;
                isTimelineUserDragging = true;
                try { document.body.style.userSelect = 'none'; } catch (e) {}
                dragMoved = false;
                dragStartX = e.clientX;
                dragStartIndex = getIndexFromScroll();
                lastDragDx = 0;
                dragStartScrollLeft = timelineViewport.scrollLeft;
                window.addEventListener('mousemove', onMouseMove, true);
                window.addEventListener('mouseup', onMouseUp, true);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);

            timelineBar.addEventListener('mousedown', (e) => {
                if (pointerDragging) return;
                if (isMobileDevice()) return;
                if (e.button !== 0) return;
                if (!isTimelineExpanded) return;
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                isDragging = true;
                isTimelineUserDragging = true;
                try { document.body.style.userSelect = 'none'; } catch (e) {}
                dragMoved = false;
                dragStartX = e.clientX;
                dragStartIndex = getIndexFromScroll();
                lastDragDx = 0;
                dragStartScrollLeft = timelineViewport ? timelineViewport.scrollLeft : 0;
                window.addEventListener('mousemove', onMouseMove, true);
                window.addEventListener('mouseup', onMouseUp, true);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);

            const endPointerDrag = () => {
                if (!pointerDragging) return;
                const releasingPointerId = pointerId;
                pointerDragging = false;
                pointerId = null;
                isTimelineUserDragging = false;
                try { document.body.style.userSelect = ''; } catch (e) {}
                try {
                    if (releasingPointerId != null && timelineBar?.releasePointerCapture) {
                        timelineBar.releasePointerCapture(releasingPointerId);
                    }
                } catch (e) {}
                window.removeEventListener('pointermove', onPointerMove, true);
                window.removeEventListener('pointerup', onPointerUp, true);
                window.removeEventListener('pointercancel', onPointerUp, true);
                if (dragMoved) timelineIgnoreClickUntilMs = Date.now() + 350;
                setTimeout(() => { dragMoved = false; }, 0);
                if (!isMobileDevice()) snapToNearestDayPage(true, { moved: dragMoved, dx: lastDragDx, startIndex: dragStartIndex });
            };

            const onPointerMove = (e) => {
                if (!pointerDragging) return;
                if (pointerId != null && e.pointerId !== pointerId) return;
                const dx = e.clientX - dragStartX;
                lastDragDx = dx;
                if (Math.abs(dx) > 5) dragMoved = true;
                timelineSnapLockedOff = true;
                setTimelineSnapEnabled(false);
                if (timelineViewport) timelineViewport.scrollLeft = dragStartScrollLeft - dx;
                timelineViewIndex = getIndexFromScroll();
                showDateOverlayByIndex(timelineViewIndex);
                const w = timelineViewport?.clientWidth || 1;
                const offset = timelineViewport ? Math.abs(timelineViewport.scrollLeft - w * 2) : 0;
                if ((timelineViewIndex !== 2 || offset > w * 0.12) && !timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                e.preventDefault();
            };

            const onPointerUp = () => {
                endPointerDrag();
            };

            timelineBar.addEventListener('pointerdown', (e) => {
                if (e.pointerType !== 'mouse') return;
                if (e.button !== 0) return;
                if (pointerDragging || isDragging) return;
                if (!isTimelineExpanded) return;
                if (isMobileDevice()) return;
                if (!timelineFullDayLocked) {
                    timelineFullDayLocked = true;
                    lastTimelineAxisKey = null;
                    updateTimelineBar();
                }
                pointerDragging = true;
                pointerId = e.pointerId;
                isTimelineUserDragging = true;
                try { document.body.style.userSelect = 'none'; } catch (e) {}
                try {
                    if (timelineBar?.setPointerCapture) timelineBar.setPointerCapture(e.pointerId);
                } catch (e) {}
                dragMoved = false;
                dragStartX = e.clientX;
                dragStartIndex = getIndexFromScroll();
                lastDragDx = 0;
                dragStartScrollLeft = timelineViewport ? timelineViewport.scrollLeft : 0;
                window.addEventListener('pointermove', onPointerMove, true);
                window.addEventListener('pointerup', onPointerUp, true);
                window.addEventListener('pointercancel', onPointerUp, true);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);

            EventManager.removeByContext('timeline-global-drag');
            EventManager.add(window, 'pointerdown', (e) => {
                try {
                    if (isMobileDevice()) return;
                    if (!timelineBar || !timelineBar.contains(e.target)) return;
                    if (e.button !== 0) return;
                    if (pointerDragging || isDragging) return;
                    if (e.pointerType && e.pointerType !== 'mouse') return;
                    if (!isTimelineExpanded) return;
                } catch (err) {}
            }, { capture: true }, 'timeline-global-drag');

            EventManager.removeByContext('timeline-global-wheel');
            EventManager.add(window, 'wheel', (e) => {
                try {
                    if (isMobileDevice()) return;
                    if (!timelineBar || !timelineBar.contains(e.target)) return;
                    if (!isTimelineExpanded) return;
                    timelineSnapLockedOff = true;
                    disableTimelineSnapTemporarily(260);
                    if (!timelineFullDayLocked) {
                        timelineFullDayLocked = true;
                        lastTimelineAxisKey = null;
                        updateTimelineBar();
                    }
                    const dx = Math.abs(e.deltaX);
                    const dy = Math.abs(e.deltaY);
                    const delta = dx > dy ? e.deltaX : e.deltaY;
                    const now = Date.now();
                    if (now >= (timelineWheelSnapUntilMs || 0) && Math.abs(delta) > 1) {
                        const cur = getIndexFromScroll();
                        const target = Math.max(0, Math.min(2, cur + (delta < 0 ? -1 : 1)));
                        timelineWheelSnapUntilMs = now + 420;
                        snapToNearestDayPage(true, null, target);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                } catch (err) {}
            }, { capture: true, passive: false }, 'timeline-global-wheel');

            EventManager.removeByContext('timeline-global-mouse-drag');
            EventManager.add(window, 'mousedown', (e) => {
                try {
                    if (isMobileDevice()) return;
                    if (!timelineBar || !timelineBar.contains(e.target)) return;
                    if (e.button !== 0) return;
                    if (pointerDragging || isDragging) return;
                    if (!isTimelineExpanded) return;
                    if (!timelineFullDayLocked) {
                        timelineFullDayLocked = true;
                        lastTimelineAxisKey = null;
                        updateTimelineBar();
                    }
                    isDragging = true;
                    isTimelineUserDragging = true;
                    try { document.body.style.userSelect = 'none'; } catch (e) {}
                    dragMoved = false;
                    dragStartX = e.clientX;
                    dragStartScrollLeft = timelineViewport ? timelineViewport.scrollLeft : 0;
                    window.addEventListener('mousemove', onMouseMove, true);
                    window.addEventListener('mouseup', onMouseUp, true);
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                } catch (err) {}
            }, { capture: true }, 'timeline-global-mouse-drag');

            EventManager.removeByContext('timeline-outside-collapse');
            EventManager.add(document, 'mousedown', (e) => {
                try {
                    if (isMobileDevice()) return;
                    if (!isTimelineExpanded) return;
                    if (isTimelineUserDragging) return;
                    if (Date.now() < (timelineIgnoreClickUntilMs || 0)) return;
                    if (!timelineBar) return;
                    if (timelineBar.contains(e.target)) return;
                    if (typeof applyTimelineExpandedState === 'function') applyTimelineExpandedState(false);
                } catch (err) {}
            }, { capture: true }, 'timeline-outside-collapse');

            timelineViewport.addEventListener('click', (e) => {
                if (dragMoved) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            }, true);
        }
    }

    function startTimelineLoop() {
        if (timelineTickId != null) return;
        timelineTickId = setInterval(() => {
            if (userSettings.timeline?.enabled) {
                updateTimelineBar();
            } else {
                hideTimelineBar();
            }
        }, 1000);
    }

    function stopTimelineLoop() {
        if (timelineTickId != null) {
            clearInterval(timelineTickId);
            timelineTickId = null;
        }
    }

    function drawTimelineAxis(axisEl = timelineAxis, rangeStartMin = null, rangeEndMin = null) {
        if (!axisEl) return;
        ensureTimelineSettings();

        axisEl.innerHTML = '';

        const startMin = (rangeStartMin != null) ? rangeStartMin : parseClockToMinutes(userSettings.timeline.startTime);
        const endMin = (rangeEndMin != null) ? rangeEndMin : parseClockToMinutes(userSettings.timeline.endTime);
        const scale = Math.max(1, parseInt(userSettings.timeline.scaleMinutes, 10) || 60);

        if (startMin == null || endMin == null || startMin >= endMin) return;

        const useHiddenCompression = !!(timelineDisplayMap?.enabled && timelineDisplayMap?.hidden && startMin === 0 && endMin === 1440);
        const totalMinutes = useHiddenCompression ? (timelineDisplayMap.totalMinutes || (endMin - startMin)) : (endMin - startMin);
        const isMobile = isMobileDevice();
        const formatAxisLabel = (minuteOfDay) => {
            const minutes = Math.max(0, Math.min(1440, Math.floor(minuteOfDay)));
            const hour = minutes === 1440 ? 24 : Math.floor(minutes / 60);
            const min = minutes % 60;
            if (isMobile) return String(hour === 24 ? 24 : hour);
            return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        };

        const ticks = new Map();
        const addTick = (minuteOfDay, heightPx, labelText = null) => {
            if (minuteOfDay < startMin || minuteOfDay > endMin) return;
            if (useHiddenCompression) {
                const h = timelineDisplayMap.hidden;
                if (h && minuteOfDay >= h.startMin && minuteOfDay < h.endMin) return;
            }
            const key = Math.floor(minuteOfDay);
            const existing = ticks.get(key);
            const next = {
                minute: minuteOfDay,
                heightPx,
                labelText
            };
            if (!existing) {
                ticks.set(key, next);
                return;
            }
            if (heightPx > existing.heightPx) existing.heightPx = heightPx;
            if (labelText && !existing.labelText) existing.labelText = labelText;
        };

        addTick(startMin, 10, formatAxisLabel(startMin));
        addTick(endMin, 10, formatAxisLabel(endMin));

        const firstAligned = Math.ceil(startMin / scale) * scale;
        for (let t = firstAligned; t < endMin; t += scale) {
            addTick(t, 10, formatAxisLabel(t));
        }

        if (scale === 60) {
            const firstHour = Math.ceil(startMin / 60) * 60;
            for (let h = firstHour; h < endMin; h += 60) {
                const half = h + 30;
                if (half > startMin && half < endMin) {
                    addTick(half, 5, null);
                }
            }
        }

        const sorted = Array.from(ticks.values()).sort((a, b) => a.minute - b.minute);
        for (const t of sorted) {
            const displayMinute = useHiddenCompression ? mapTimelineMinuteToDisplay(t.minute) : (t.minute - startMin);
            if (displayMinute == null) continue;
            const percent = (displayMinute / totalMinutes) * 100;
            const tick = document.createElement('div');
            tick.style.cssText = `
                position: absolute; left: ${percent}%; bottom: 0;
                width: 1px; height: ${t.heightPx}px; background: rgba(0,0,0,0.3);
            `;
            axisEl.appendChild(tick);

            if (t.labelText) {
                const label = document.createElement('div');
                label.textContent = t.labelText;
                    const isLeftEdge = percent <= 0.5;
                    const isRightEdge = percent >= 99.5;
                    const labelLeft = isLeftEdge ? 0 : (isRightEdge ? 100 : percent);
                    const baseTransform = isLeftEdge ? 'translateX(0)' : (isRightEdge ? 'translateX(-100%)' : 'translateX(-50%)');
                    const labelTransform = `${baseTransform} scaleX(${timelineAxisLabelScaleX || 1})`;
                label.style.cssText = `
                    position: absolute; left: ${labelLeft}%; bottom: ${t.heightPx + 2}px;
                    transform: ${labelTransform}; font-size: 10px;
                    color: rgba(0,0,0,0.6); white-space: nowrap;
                `;
                axisEl.appendChild(label);
            }
        }
    }

    function hideTimelineTooltip() {
        if (timelineTooltip) timelineTooltip.style.display = 'none';
    }

    let timelineTooltipHideTimer = null;

    function escapeHtml(input) {
        return String(input ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch] || ch));
    }

    function ensureTimelineTooltip() {
        if (timelineTooltip && timelineTooltip.parentNode) return;
        timelineTooltip = document.createElement('div');
        timelineTooltip.id = 'tomato-timeline-tooltip';
        timelineTooltip.style.cssText = `
            position: fixed;
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
            padding: 8px 12px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            font-size: 12px;
            z-index: 2147483650;
            pointer-events: auto;
            display: none;
            max-width: 260px;
            word-break: break-word;
        `;
        timelineTooltip.addEventListener('mouseenter', () => {
            if (timelineTooltipHideTimer) clearTimeout(timelineTooltipHideTimer);
            timelineTooltipHideTimer = null;
        }, { passive: true });
        timelineTooltip.addEventListener('mouseleave', () => {
            hideTimelineTooltip();
        }, { passive: true });
        document.body.appendChild(timelineTooltip);
    }

    function setupTimelineTooltipLinkListener() {
        if (!timelineTooltip) return;
        EventManager.removeByContext('timeline-tooltip-link');
        EventManager.add(timelineTooltip, 'click', (e) => {
            const link = e.target.closest('[data-block-id]');
            if (!link) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const ua = navigator.userAgent;
            const isExplicitMobile = /Android|iPhone|iPad|iPod/i.test(ua);
            const isHarmonyMobile = /HarmonyOS/i.test(ua) && isMobileDevice();
            if (isExplicitMobile || isHarmonyMobile) return;

            const blockId = link.getAttribute('data-block-id');
            if (blockId) navigateToBlock(blockId);
        }, {}, 'timeline-tooltip-link');
    }

    function showTimelineTooltipForSegment(segEl) {
        if (!segEl) return;
        ensureTimelineTooltip();

        const label = segEl.dataset.timelineLabel || '';
        const taskName = segEl.dataset.taskBlockName || '';
        const taskId = segEl.dataset.taskBlockId || '';

        let timeText = '';
        if (segEl.dataset.startIso && segEl.dataset.endIso) {
            try {
                const s = new Date(segEl.dataset.startIso);
                const e = new Date(segEl.dataset.endIso);
                const fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                timeText = `${fmt(s)} - ${fmt(e)}`;
            } catch (e) {}
        }

        let html = '';
        if (timeText) {
            html += `<div style="font-weight: 600; line-height: 1.3;">${escapeHtml(timeText)}</div>`;
        }
        if (label) {
            html += `<div style="opacity: 0.75; font-size: 11px; margin-top: 2px;">${escapeHtml(label)}</div>`;
        }
        if (taskName || taskId) {
            const displayText = taskName ? `📋️${taskName}` : `📋️${taskId}`;
            html += `<div style="margin-top: 6px; line-height: 1.3;">
                <span class="tomato-task-link" data-block-id="${escapeHtml(taskId)}" style="cursor:pointer; color: var(--b3-theme-primary); text-decoration: underline;">
                    ${escapeHtml(displayText)}
                </span>
            </div>`;
        }

        timelineTooltip.innerHTML = html || '<div>时间段</div>';
        setupTimelineTooltipLinkListener();

        const padding = 10;
        timelineTooltip.style.display = 'block';
        timelineTooltip.style.visibility = 'hidden';
        timelineTooltip.style.transform = 'none';
        timelineTooltip.style.left = `${padding}px`;
        timelineTooltip.style.top = `${padding}px`;

        const ttRect = timelineTooltip.getBoundingClientRect();
        const segRect = segEl.getBoundingClientRect();

        const centerX = segRect.left + segRect.width / 2;
        let left = centerX - ttRect.width / 2;
        left = Math.max(padding, Math.min(window.innerWidth - padding - ttRect.width, left));

        let top = segRect.top - 8 - ttRect.height;
        if (top < padding) top = segRect.bottom + 8;
        top = Math.max(padding, Math.min(window.innerHeight - padding - ttRect.height, top));

        timelineTooltip.style.left = `${Math.round(left)}px`;
        timelineTooltip.style.top = `${Math.round(top)}px`;
        timelineTooltip.style.visibility = 'visible';
    }

    function hideTimelineBar() {
        hideTimelineTooltip();
        if (timelineBar) timelineBar.style.display = 'none';
    }

    function updateTimelineBar() {
        ensureTimelineSettings();

        if (!timelineBar || !timelineBar.parentNode) {
            createTimelineBar();
        }
        if (timelineBar) timelineBar.style.display = 'block';

        if (timelineBar && timelineVisual) {
            const hotArea = Math.max(10, userSettings.timeline.hotAreaHeightPx || 15);
            const collapsedH = Math.max(3, userSettings.timeline.collapsedHeightPx || 7);
            const expandedH = Math.max(collapsedH, userSettings.timeline.expandedHeightPx || 27);
            const collapsedOp = Math.max(0.1, Math.min(1, userSettings.timeline.collapsedOpacity ?? 0.7));
            const expandedOp = Math.max(0.1, Math.min(1, userSettings.timeline.expandedOpacity ?? 1));

            timelineBar.style.height = `${isTimelineExpanded ? expandedH : hotArea}px`;
            timelineVisual.style.height = `${isTimelineExpanded ? expandedH : collapsedH}px`;
            timelineVisual.style.opacity = String(isTimelineExpanded ? expandedOp : collapsedOp);
            timelineVisual.style.overflow = isTimelineExpanded ? 'visible' : 'hidden';
            if (timelineViewport) timelineViewport.style.overflowX = isTimelineExpanded ? 'auto' : 'hidden';
            for (const p of timelineDayPages) {
                if (p?.axisEl) p.axisEl.style.opacity = isTimelineExpanded ? '1' : '0';
            }
            if (timelineDateOverlay) {
                timelineDateOverlay.style.bottom = `${(isTimelineExpanded ? expandedH : collapsedH) + 8}px`;
                if (!isTimelineExpanded) timelineDateOverlay.style.display = 'none';
            }
        }

        const showFullDay = isTimelineExpanded && (timelineFullDayLocked || isTimelineUserDragging);
        const { rangeStartMin, rangeEndMin, nowMinutes, shouldApplyCustomRange } = getTimelineRangeState();
        const hiddenRange = getTimelineHiddenTimeRangeState();
        const isFullDayMode = !shouldApplyCustomRange || showFullDay;
        const compressHiddenRange = isFullDayMode && hiddenRange.enabled;
        timelineDisplayMap = compressHiddenRange
            ? { enabled: true, hidden: hiddenRange, totalMinutes: Math.max(1, 1440 - hiddenRange.duration) }
            : { enabled: false, hidden: null, totalMinutes: 1440 };

        let zoomTransform = 'none';
        if (shouldApplyCustomRange && !showFullDay) {
            const duration = rangeEndMin - rangeStartMin;
            const scale = 1440 / duration;
            const startPercent = (rangeStartMin / 1440) * 100;
            zoomTransform = `scaleX(${scale}) translateX(-${startPercent}%)`;
            timelineAxisLabelScaleX = duration / 1440;
        } else {
            timelineAxisLabelScaleX = 1;
        }
        for (const p of timelineDayPages) {
            if (p?.contentEl) p.contentEl.style.transform = zoomTransform;
        }

        if (timelineDayPages && timelineDayPages.length) {
            for (const p of timelineDayPages) {
                if (p?.hiddenMaskEl) p.hiddenMaskEl.style.display = 'none';
            }
        }

        const axisKey = `${userSettings.timeline.scaleMinutes}`;
        if (axisKey !== lastTimelineAxisKey) {
            lastTimelineAxisKey = axisKey;
            for (const p of timelineDayPages) {
                if (p?.axisEl) drawTimelineAxis(p.axisEl, 0, 1440);
            }
        }

        if (timelineVisual) {
            const baseColor = userSettings.timeline.color || '#AECBFA';
            const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
            const themeConfig = isNeonMode ? getThemeConfig() : null;
            const neonIntensity = userSettings.appearance?.neonIntensity || 0.8;
            const hasTimelineCustomColors = !isNeonMode && !!userSettings.timeline.customColors;
            const timelineCustomConfig = hasTimelineCustomColors ? getTimelineCustomColorConfig() : null;

            if (isNeonMode && themeConfig) {
                timelineVisual.style.background = `linear-gradient(90deg, ${themeConfig.gradientStart}, ${themeConfig.gradientEnd})`;
                timelineVisual.classList.add('neon-mode');
                timelineVisual.style.setProperty('--neon-glow', themeConfig.glowColor);
                timelineVisual.style.setProperty('--neon-start', themeConfig.gradientStart);
                timelineVisual.style.setProperty('--neon-end', themeConfig.gradientEnd);
                timelineVisual.style.boxShadow = `0 0 ${12 * neonIntensity}px ${themeConfig.glowColor}, 0 0 ${24 * neonIntensity}px ${themeConfig.glowColor}`;
                if (timelineNowLine) {
                    timelineNowLine.classList.add('neon-mode');
                    const indicatorColor = getTimelineIndicatorColor(themeConfig, null);
                    timelineNowLine.style.background = indicatorColor;
                    timelineNowLine.style.boxShadow = `0 0 ${12 * neonIntensity}px ${indicatorColor}, 0 0 ${22 * neonIntensity}px ${indicatorColor}`;
                    timelineNowLine.style.width = '2px';
                    timelineNowLine.style.outline = 'none';
                    timelineNowLine.style.filter = 'saturate(1.35) contrast(1.12) drop-shadow(0 0 2px rgba(0,0,0,0.35))';
                    const arrow = timelineNowLine.firstChild;
                    if (arrow && arrow.style) {
                        arrow.style.borderTopColor = indicatorColor;
                        arrow.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))';
                        arrow.style.display = userSettings.appearance?.showIndicator === false ? 'none' : 'block';
                    }
                }
            } else if (hasTimelineCustomColors && timelineCustomConfig) {
                timelineVisual.style.background = `linear-gradient(90deg, ${timelineCustomConfig.gradientStart}, ${timelineCustomConfig.gradientEnd})`;
                timelineVisual.classList.add('neon-mode');
                timelineVisual.style.setProperty('--neon-glow', timelineCustomConfig.glowColor);
                timelineVisual.style.setProperty('--neon-start', timelineCustomConfig.gradientStart);
                timelineVisual.style.setProperty('--neon-end', timelineCustomConfig.gradientEnd);
                timelineVisual.style.boxShadow = `0 0 ${12 * neonIntensity}px ${timelineCustomConfig.glowColor}, 0 0 ${24 * neonIntensity}px ${timelineCustomConfig.glowColor}`;
                if (timelineNowLine) {
                    timelineNowLine.classList.remove('neon-mode');
                    const indicatorColor = getTimelineIndicatorColor(null, timelineCustomConfig);
                    timelineNowLine.style.background = indicatorColor;
                    timelineNowLine.style.boxShadow = `0 0 ${12 * neonIntensity}px ${indicatorColor}, 0 0 ${22 * neonIntensity}px ${indicatorColor}`;
                    timelineNowLine.style.width = '2px';
                    timelineNowLine.style.outline = 'none';
                    timelineNowLine.style.filter = 'saturate(1.35) contrast(1.12) drop-shadow(0 0 2px rgba(0,0,0,0.35))';
                    const arrow = timelineNowLine.firstChild;
                    if (arrow && arrow.style) {
                        arrow.style.borderTopColor = indicatorColor;
                        arrow.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))';
                        arrow.style.display = userSettings.appearance?.showIndicator === false ? 'none' : 'block';
                    }
                }
            } else {
                timelineVisual.style.background = baseColor;
                timelineVisual.classList.remove('neon-mode');
                timelineVisual.style.boxShadow = '0 -1px 3px rgba(0,0,0,0.12)';
                if (timelineNowLine) {
                    timelineNowLine.classList.remove('neon-mode');
                    const indicatorColor = getTimelineIndicatorColor(null, null);
                    timelineNowLine.style.background = indicatorColor;
                    timelineNowLine.style.boxShadow = '0 0 4px rgba(0,0,0,0.2)';
                    timelineNowLine.style.width = '2px';
                    timelineNowLine.style.outline = 'none';
                    timelineNowLine.style.filter = 'saturate(1.35) contrast(1.12) drop-shadow(0 0 2px rgba(0,0,0,0.35))';
                    const arrow = timelineNowLine.firstChild;
                    if (arrow && arrow.style) {
                        arrow.style.borderTopColor = indicatorColor;
                        arrow.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))';
                        arrow.style.display = userSettings.appearance?.showIndicator === false ? 'none' : 'block';
                    }
                }
            }

            const shouldBreathe = (userSettings.timeline.enableBreathing !== false)
                && (userSettings.appearance?.enableBreathing !== false)
                && (timerMode === 'countdown' || timerMode === 'stopwatch')
                && isRunning
                && !isTimerPaused;
            if (shouldBreathe) timelineVisual.classList.add('breathing');
            else timelineVisual.classList.remove('breathing');
        }

        let nowPercent = 0;
        if (shouldApplyCustomRange && !showFullDay) {
            const duration = rangeEndMin - rangeStartMin;
            nowPercent = ((nowMinutes - rangeStartMin) / duration) * 100;
        } else {
            if (timelineDisplayMap.enabled) {
                const h = timelineDisplayMap.hidden;
                const isNowHidden = !!(h && nowMinutes >= h.startMin && nowMinutes < h.endMin);
                if (isNowHidden) {
                    nowPercent = 0;
                    if (timelineNowLine) timelineNowLine.style.display = 'none';
                } else {
                    const mappedNow = mapTimelineMinuteToDisplay(nowMinutes);
                    if (mappedNow == null) {
                        nowPercent = 0;
                        if (timelineNowLine) timelineNowLine.style.display = 'none';
                    } else {
                        if (timelineNowLine) timelineNowLine.style.display = 'block';
                        nowPercent = (mappedNow / timelineDisplayMap.totalMinutes) * 100;
                    }
                }
            } else {
                if (timelineNowLine) timelineNowLine.style.display = 'block';
                nowPercent = (nowMinutes / 1440) * 100;
            }
        }
        nowPercent = Math.max(0, Math.min(100, nowPercent));
        if (timelineNowLine) timelineNowLine.style.left = `${nowPercent}%`;

        const startMin = 0;
        const totalMinutes = timelineDisplayMap.enabled ? timelineDisplayMap.totalMinutes : 1440;
        const { key: highlightKey } = getTimelineHighlightPalette();

        for (const p of timelineDayPages) {
            const dateKey = (() => {
                const d = new Date();
                d.setDate(d.getDate() + (p.dayOffset || 0));
                return formatDateKey(d);
            })();

            refreshTimelineHistoryCacheForDateIfNeeded(dateKey);
            const cache = getTimelineHistoryCache(dateKey);
            const hiddenKey = timelineDisplayMap.enabled ? `hidden-${hiddenRange.startMin}-${hiddenRange.endMin}` : 'hidden-off';
            const coordKey = `full-day-${totalMinutes}-${highlightKey}-${hiddenKey}`;
            if (!cache.refreshing && (cache.renderedVersion !== cache.version || cache.renderedCoordKey !== coordKey)) {
                renderTimelineHistorySegmentsForDate(dateKey, p.historyLayerEl, startMin, totalMinutes);
                cache.renderedVersion = cache.version;
                cache.renderedCoordKey = coordKey;
            }

            if (p.dayOffset === 0) {
                renderTimelineActiveSegments(startMin, totalMinutes, p.activeLayerEl);
            } else {
                if (p.activeLayerEl) p.activeLayerEl.innerHTML = '';
                if (p.activeLayerEl) p.activeLayerEl.style.pointerEvents = 'none';
            }
        }
    }

    const timelineHistoryCacheByDateKey = new Map();

    function getTimelineHistoryCache(dateKey) {
        const key = String(dateKey || '');
        if (!timelineHistoryCacheByDateKey.has(key)) {
            timelineHistoryCacheByDateKey.set(key, {
                dateKey: key,
                records: [],
                refreshing: false,
                dirty: true,
                version: 0,
                renderedVersion: -1
            });
        }
        return timelineHistoryCacheByDateKey.get(key);
    }

    function markTimelineHistoryDirty() {
        for (const cache of timelineHistoryCacheByDateKey.values()) {
            cache.dirty = true;
        }
    }

    function refreshTimelineHistoryCacheForDateIfNeeded(dateKey) {
        const cache = getTimelineHistoryCache(dateKey);
        const needsRefresh = cache.dirty;
        if (!needsRefresh || cache.refreshing) return;

        cache.refreshing = true;
        cache.dirty = false;

        (async () => {
            const all = await loadHistoryRecords();
            cache.records = (all || []).filter(r => {
                if (!r) return false;
                const recordDate = r.date || formatDateKey(r.start);
                return recordDate === cache.dateKey;
            });
            cache.version += 1;
        })().catch(() => {
            cache.dirty = true;
        }).finally(() => {
            cache.refreshing = false;
            try {
                if (timelineBar && timelineBar.parentNode) updateTimelineBar();
            } catch (e) {}
        });
    }

    function renderTimelineHistorySegmentsForDate(dateKey, layerEl, offsetMin, totalMin) {
        if (!layerEl) return;
        layerEl.innerHTML = '';
        const cache = getTimelineHistoryCache(dateKey);
        const { tomatoColor, stopwatchColor, breakColor } = getTimelineHighlightPalette();

        for (const record of cache.records || []) {
            const startIso = record.start;
            const endIso = record.end;
            if (!startIso || !endIso) continue;
            const startM = getDayMinutesFromTimestamp(startIso);
            const endM = getDayMinutesFromTimestamp(endIso);

            let color = '#9E9E9E';
            let opacity = 0.8;
            let label = '记录';

            if (record.mode === 'countdown') {
                color = tomatoColor;
                label = '🍅 番茄钟';
            } else if (record.mode === 'stopwatch') {
                color = stopwatchColor;
                label = '⏱️ 正计时';
            } else if (record.mode === 'break' || record.mode === 'stopwatch-break') {
                color = breakColor;
                label = '☕ 休息';
                opacity = 0.75;
            }

            drawTimelineSegment(startM, endM, color, opacity, offsetMin, totalMin, label, {
                taskBlockId: record.taskBlockId,
                taskBlockName: record.taskBlockName,
                databaseBlockId: record.databaseBlockId,
                startIso,
                endIso,
                mode: record.mode
            }, layerEl);
        }
    }

    function getDayMinutesFromTimestamp(ts) {
        const d = toDateSafe(ts);
        return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    }

    function drawTimelineSegment(startMin, endMin, color, opacity, offsetMin, totalMin, label, meta = null, parentEl = null) {
        const parent = parentEl || timelineActiveLayer || timelineSegments;
        if (!parent) return;
        if (endMin <= startMin) return;

        const appendSegment = (displayStartMin, displayEndMin, segMeta) => {
            const startPercentRaw = ((displayStartMin - offsetMin) / totalMin) * 100;
            const endPercentRaw = ((displayEndMin - offsetMin) / totalMin) * 100;
            const left = Math.max(0, Math.min(100, startPercentRaw));
            const right = Math.max(0, Math.min(100, endPercentRaw));
            const width = Math.max(0, right - left);
            if (width <= 0) return;
            if (right <= 0 || left >= 100) return;

            const seg = document.createElement('div');
            seg.className = 'timeline-segment';
            seg.style.cssText = `
                position: absolute; bottom: 0; height: 100%;
                left: ${left}%;
                width: ${width}%;
                background: ${color}; opacity: ${opacity};
            `;
            seg.dataset.timelineLabel = label || '';

            if (segMeta?.taskBlockId) seg.dataset.taskBlockId = segMeta.taskBlockId;
            if (segMeta?.taskBlockName) seg.dataset.taskBlockName = segMeta.taskBlockName;
            if (segMeta?.databaseBlockId) seg.dataset.databaseBlockId = segMeta.databaseBlockId;
            if (segMeta?.startIso) seg.dataset.startIso = segMeta.startIso;
            if (segMeta?.endIso) seg.dataset.endIso = segMeta.endIso;
            if (segMeta?.mode) seg.dataset.mode = segMeta.mode;

            if (userSettings.timeline?.enableBreathing !== false && userSettings.appearance?.enableBreathing !== false && opacity >= 0.75 && isRunning && !isTimerPaused) {
                seg.classList.add('breathing');
            }

            const hasTask = !!(segMeta?.taskBlockId);
            if (hasTask) seg.style.cursor = 'pointer';

            seg.addEventListener('click', (e) => {
                e.stopPropagation();
                showTimelineTooltipForSegment(seg);
            });

            seg.addEventListener('mouseenter', (e) => {
                if (timelineTooltipHideTimer) clearTimeout(timelineTooltipHideTimer);
                timelineTooltipHideTimer = null;
                showTimelineTooltipForSegment(seg);
            });
            seg.addEventListener('mouseleave', () => {
                if (timelineTooltipHideTimer) clearTimeout(timelineTooltipHideTimer);
                timelineTooltipHideTimer = setTimeout(() => {
                    hideTimelineTooltip();
                }, 120);
            });

            parent.appendChild(seg);
        };

        const useDisplayMap = !!(timelineDisplayMap?.enabled && timelineDisplayMap.totalMinutes === totalMin);
        if (!useDisplayMap) {
            appendSegment(startMin, endMin, meta);
            return;
        }

        const parts = splitTimelineRangeByHidden(startMin, endMin);
        const baseIso = meta?.startIso || meta?.endIso || null;
        for (const part of parts) {
            const ds = mapTimelineMinuteToDisplay(part.startMin);
            const de = mapTimelineMinuteToDisplay(part.endMin);
            if (ds == null || de == null || de <= ds) continue;
            let nextMeta = meta;
            if (meta && baseIso) {
                nextMeta = { ...meta };
                const partStartIso = dayMinuteToIso(baseIso, part.startMin);
                const partEndIso = dayMinuteToIso(baseIso, part.endMin);
                if (partStartIso) nextMeta.startIso = partStartIso;
                if (partEndIso) nextMeta.endIso = partEndIso;
            }
            appendSegment(ds, de, nextMeta);
        }
    }

    function renderTimelineActiveSegments(offsetMin, totalMin, layerEl = timelineActiveLayer) {
        if (!layerEl) return;
        layerEl.innerHTML = '';
        layerEl.style.pointerEvents = 'none';
        if (!isRunning && !isTimerPaused) return;
        const { tomatoColor, stopwatchColor, breakColor } = getTimelineHighlightPalette();

        const nowTs = Date.now();

        if (timerMode === 'countdown') {
            const startTs = currentStartTimeMs || syncState?.startTime || 0;
            if (!startTs) return;
            const endTs = startTs + (currentDuration * 60 * 1000);
            const startM = getDayMinutesFromTimestamp(startTs);
            const endM = getDayMinutesFromTimestamp(endTs);
            let currentTs = nowTs;
            if (isTimerPaused && pausedRemainingSeconds != null) {
                const elapsedSeconds = currentDuration * 60 - pausedRemainingSeconds;
                currentTs = startTs + Math.max(0, elapsedSeconds) * 1000;
            }
            const nowM = getDayMinutesFromTimestamp(currentTs);

            drawTimelineSegment(startM, endM, tomatoColor, 0.25, offsetMin, totalMin, '🍅 计划中', {
                taskBlockId: currentTaskBlockId,
                taskBlockName: currentTaskBlockName,
                databaseBlockId: currentDatabaseBlockId,
                startIso: new Date(startTs).toISOString(),
                endIso: new Date(endTs).toISOString(),
                mode: 'countdown'
            }, layerEl);
            drawTimelineSegment(startM, Math.min(nowM, endM), tomatoColor, 0.85, offsetMin, totalMin, '🍅 已专注', {
                taskBlockId: currentTaskBlockId,
                taskBlockName: currentTaskBlockName,
                databaseBlockId: currentDatabaseBlockId,
                startIso: new Date(startTs).toISOString(),
                endIso: new Date(currentTs).toISOString(),
                mode: 'countdown'
            }, layerEl);
            layerEl.style.pointerEvents = 'auto';
            return;
        }

        if (timerMode === 'stopwatch') {
            if (isTimerPaused) return;
            const startTs = syncState?.stopwatchStartTimeMs || syncState?.startTime || stopwatchStartTimeMs || startTime || 0;
            if (!startTs) return;
            const startM = getDayMinutesFromTimestamp(startTs);
            const nowM = getDayMinutesFromTimestamp(nowTs);
            drawTimelineSegment(startM, nowM, stopwatchColor, 0.8, offsetMin, totalMin, '⏱️ 正计时', {
                taskBlockId: currentTaskBlockId,
                taskBlockName: currentTaskBlockName,
                databaseBlockId: currentDatabaseBlockId,
                startIso: new Date(startTs).toISOString(),
                endIso: new Date(nowTs).toISOString(),
                mode: 'stopwatch'
            }, layerEl);
            layerEl.style.pointerEvents = 'auto';
            return;
        }

        if (timerMode === 'break' || timerMode === 'stopwatch-break') {
            const startTs = currentStartTimeMs || syncState?.startTime || startTime || 0;
            if (!startTs) return;
            const endTs = startTs + (currentDuration * 60 * 1000);
            const startM = getDayMinutesFromTimestamp(startTs);
            const endM = getDayMinutesFromTimestamp(endTs);
            let currentTs = nowTs;
            if (isTimerPaused && pausedRemainingSeconds != null) {
                const elapsedSeconds = currentDuration * 60 - pausedRemainingSeconds;
                currentTs = startTs + Math.max(0, elapsedSeconds) * 1000;
            }
            const nowM = getDayMinutesFromTimestamp(currentTs);

            drawTimelineSegment(startM, Math.min(nowM, endM), breakColor, 0.75, offsetMin, totalMin, '☕ 休息', {
                startIso: new Date(startTs).toISOString(),
                endIso: new Date(currentTs).toISOString(),
                mode: timerMode
            }, layerEl);
            if (layerEl.childElementCount > 0) layerEl.style.pointerEvents = 'auto';
        }
    }

    function updateProgressBar(animate = true) {
        if (userSettings.timeline?.enabled) {
            updateTimelineBar();
            hideProgressBar();
            return;
        }
        hideTimelineBar();

        // 计时器运行时或暂停状态时显示进度条
        if (!isRunning && !isTimerPaused) {
            hideProgressBar();
            return;
        }

        // 如果不是倒计时/休息模式，不显示进度条
        // 正计时模式需要额外检查是否启用了进度条
        if (timerMode === 'stopwatch') {
            if (userSettings.appearance?.enableStopwatchBar === false) {
                hideProgressBar();
                return;
            }
        } else if (timerMode !== 'countdown' && timerMode !== 'break') {
            hideProgressBar();
            return;
        }

        // 检测模式变化，强制重新创建进度条和指示器
        const currentMode = `${timerMode}_${userSettings.appearance?.theme || 'default'}_${!!userSettings.appearance?.enableNeonEffect}`;
        if (lastProgressMode !== currentMode) {
            // 模式变化，强制移除旧元素
            if (progressBar) {
                progressBar.remove();
                progressBar = null;
            }
            if (progressIndicator) {
                progressIndicator.remove();
                progressIndicator = null;
            }
            lastProgressMode = currentMode;
        }

        createProgressBar();
        createProgressIndicator();

        const total = currentDuration * 60;
        const percent = Math.max(0, (remainingSeconds / total) * 100);

        // 检查是否启用霓虹模式和动画
        const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
        const enableSmooth = userSettings.appearance?.enableSmoothAnimation !== false;
        const themeConfig = isNeonMode ? getThemeConfig() : null;

        // 暂停/恢复时不使用动画，直接更新
        if (!animate || !enableSmooth) {
            progressBar.style.transition = 'none';
            if (progressIndicator) progressIndicator.style.transition = 'none';
        } else {
            progressBar.style.transition = 'width 0.3s ease-out';
            if (progressIndicator) progressIndicator.style.transition = 'left 0.3s ease-out';
        }

        // 检查是否是休息模式（休息模式使用灰色）
        const isBreakMode = timerMode === 'break';
        // 检查是否是正计时模式
        const isStopwatchMode = timerMode === 'stopwatch';

        // 正计时模式：常亮绿色进度条，进行时呼吸，暂停时停止呼吸
        // 正计时模式下不显示指示器
        if (isStopwatchMode && userSettings.appearance?.enableStopwatchBar !== false) {
            const stopwatchColor = '#00C853'; // 纯正绿色
            const intensity = userSettings.appearance?.neonIntensity || 0.8;
            progressBar.style.width = '100%';
            progressBar.style.background = stopwatchColor;  // 使用 background 而不是 backgroundColor，覆盖渐变
            progressBar.style.backgroundColor = stopwatchColor;
            progressBar.style.boxShadow = `0 0 ${15 * intensity}px ${stopwatchColor}, 0 0 ${30 * intensity}px ${stopwatchColor}, 0 0 ${50 * intensity}px ${stopwatchColor}`;

            // 正计时模式下隐藏指示器
            if (progressIndicator) {
                progressIndicator.style.display = 'none';
            }

            // 呼吸动画控制：计时运行时才呼吸，暂停时停止
            if (userSettings.appearance?.enableBreathing !== false) {
                if (isRunning && !isTimerPaused) {
                    progressBar.classList.add('breathing');
                } else {
                    progressBar.classList.remove('breathing');
                }
            }

        } else if (isNeonMode && !isBreakMode) {
            // 霓虹模式样式（休息模式使用灰色）
            const intensity = userSettings.appearance?.neonIntensity || 0.8;
            progressBar.style.width = `${percent}%`;
            progressBar.style.background = `linear-gradient(90deg, ${themeConfig.gradientStart}, ${themeConfig.gradientEnd})`;
            // 增大发光范围
            progressBar.style.boxShadow = `0 0 ${15 * intensity}px ${themeConfig.glowColor},
                                          0 0 ${30 * intensity}px ${themeConfig.glowColor},
                                          0 0 ${50 * intensity}px ${themeConfig.glowColor}`;

            // 更新三角形指示器位置（尖端对准进度条右端）
            if (progressIndicator) {
                progressIndicator.style.color = themeConfig.glowColor;  // 设置 color，伪元素使用 currentColor
                progressIndicator.style.borderTopColor = themeConfig.glowColor;
                // 偏移量调整：指示器缩小后相应调整
                const arrowTipOffset = 2;
                const leftPos = (window.innerWidth * percent) / 100 - arrowTipOffset;
                progressIndicator.style.left = `${leftPos}px`;
                progressIndicator.style.display = 'block';

                // 呼吸动画控制：计时运行时才呼吸，暂停时停止
                if (userSettings.appearance?.enableBreathing !== false) {
                    if (isRunning && !isTimerPaused) {
                        progressBar.classList.add('breathing');
                        progressIndicator.classList.add('breathing');
                    } else {
                        progressBar.classList.remove('breathing');
                        progressIndicator.classList.remove('breathing');
                    }
                }
            } else {
                // 没有指示器时也移除呼吸动画
                progressBar.classList.remove('breathing');
            }

        } else if (getCurrentTheme() === 'default' && !isBreakMode) {
            // 默认主题倒计时模式：使用思源笔记主题色
            const defaultColor = 'var(--b3-theme-primary, #1E88E5)';
            progressBar.style.width = `${percent}%`;
            progressBar.style.background = defaultColor;  // 同时设置 background 和 backgroundColor
            progressBar.style.backgroundColor = defaultColor;
            progressBar.style.boxShadow = 'none';

            if (progressIndicator) {
                progressIndicator.style.borderTopColor = defaultColor;
                // 偏移量调整：指示器缩小后相应调整
                const arrowTipOffset = 0.5;
                const leftPos = (window.innerWidth * percent) / 100 - arrowTipOffset;
                progressIndicator.style.left = `${leftPos}px`;
                progressIndicator.style.display = 'block';

                // 移除呼吸动画
                progressIndicator.classList.remove('breathing');
            }

            // 移除呼吸动画
            progressBar.classList.remove('breathing');

        } else {
            // 休息模式：使用灰色
            const color = '#9E9E9E';
            progressBar.style.width = `${percent}%`;
            progressBar.style.background = color;  // 同时设置 background 和 backgroundColor，覆盖渐变
            progressBar.style.backgroundColor = color;
            progressBar.style.boxShadow = 'none';

            if (progressIndicator) {
                progressIndicator.style.color = color;  // 设置 color，伪元素使用 currentColor
                progressIndicator.style.borderTopColor = color;
                // 偏移量调整：指示器缩小后相应调整
                const arrowTipOffset = 0.5;
                const leftPos = (window.innerWidth * percent) / 100 - arrowTipOffset;
                progressIndicator.style.left = `${leftPos}px`;
                progressIndicator.style.display = 'block';

                // 移除呼吸动画
                progressIndicator.classList.remove('breathing');
            }

            // 移除呼吸动画
            progressBar.classList.remove('breathing');
        }

        // 如果禁用了动画，需要在下次渲染时恢复动画
        if (!animate || !enableSmooth) {
            requestAnimationFrame(() => {
                progressBar.style.transition = 'width 0.3s ease-out';
                if (progressIndicator) progressIndicator.style.transition = 'left 0.3s ease-out';
            });
        }
    }

    function hideProgressBar() {
        if (progressBar) {
            progressBar.style.width = '0%';
            // 移除完成动画类
            if (progressBar.classList.contains('completing')) {
                progressBar.classList.remove('completing');
            }
        }
        if (progressIndicator) progressIndicator.style.display = 'none';
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function formatFocusTime(minutes) {
        if (minutes < 60) return `${minutes}分钟`;
        return `${(minutes / 60).toFixed(1)}小时`;
    }

    function formatFocusTimeForTable(minutes) {
        if (minutes < 60) return `${minutes}分`;
        return `${(minutes / 60).toFixed(1)}小时`;
    }

    function formatDate(date) {
        return `${(date.getMonth() + 1).toString().padStart(2, '0')}月${date.getDate().toString().padStart(2, '0')}日`;
    }

    function updateDisplay() {
        // 🔧 v9.0 修复：如果 timeDisplay 不存在且用户已关闭悬浮窗，不重新创建
        if (!timeDisplay) {
            if (floatBarHiddenByUser) {
                return;
            }
            return;
        }

        let text;
        if (timerMode === 'countdown') {
            const displaySeconds = (isRunning || remainingSeconds > 0) ? remainingSeconds : currentDuration * 60;
            text = `🍅 ${formatTime(displaySeconds)}`;
        } else if (timerMode === 'break') {
            const displaySeconds = (isRunning || remainingSeconds > 0) ? remainingSeconds : currentDuration * 60;
            text = `☕ ${formatTime(displaySeconds)}`;
        } else if (timerMode === 'stopwatch') {
            // 🔧 修复：显示时加上休息前的时间偏移
            text = `⏱️ ${formatTime(elapsedSeconds + stopwatchDisplayOffset)}`;
        } else if (timerMode === 'stopwatch-break') {
            text = `☕ ${formatTime(elapsedSeconds)}`;
        }
        timeDisplay.textContent = text;
        timeDisplay.style.color = isRunning ? '#1E88E5' : 'var(--b3-theme-on-surface)';
        updateProgressBar();

        // 更新任务块图标状态
        updateTaskBlockIcon();

        // 桌面端：添加点击层用于显示菜单
        // 移动端不使用此功能，通过长按悬浮条显示菜单
        if (!isMobileDevice() && !document.getElementById('tomy-tomato-icon-click-layer')) {
            const iconClickLayer = document.createElement('span');
            iconClickLayer.id = 'tomy-tomato-icon-click-layer';
            iconClickLayer.style.cssText = `position: absolute; top: 0; left: 0; height: 100%; width: 1.4em; cursor: pointer; z-index: 1;`;
            iconClickLayer.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY);
            };
            timeDisplay.appendChild(iconClickLayer);
        }
    }

    async function tick() {
        if (!isRunning || startTime <= 0) return;

        const now = Date.now();

        if (timerMode === 'countdown' || timerMode === 'break') {
            const totalMs = currentDuration * 60 * 1000;
            const elapsedMs = now - startTime;
            
            if (elapsedMs >= totalMs) {
                // 计时结束！
                Logger.info('🍅 ⏰ 计时结束，准备播放提示音');
                Logger.info('🍅 timerMode:', timerMode);
                Logger.info('🍅 workEndAudio:', workEndAudio);
                Logger.info('🍅 breakEndAudio:', breakEndAudio);
                
                // 日志移除：避免高频调用消耗 CPU
                await recordEndTime();
                stopTimer();
                remainingSeconds = 0;
                updateDisplay();
                
                // 播放提示音
                try {
                    if (timerMode === 'break') {
                        // 休息结束，播放休息结束提示音
                        Logger.info('🍅 播放休息结束提示音...');
                        await playEndSound('break-end');
                        Logger.info('🍅 休息结束提示音播放完成');
                    } else {
                        // 工作/专注结束，播放工作结束提示音
                        Logger.info('🍅 播放工作结束提示音...');
                        await playEndSound('work-end');
                        Logger.info('🍅 工作结束提示音播放完成');
                    }
                } catch (audioError) {
                    Logger.warn('🍅 播放提示音失败:', audioError);
                }
                
                // 显示提示框（提示音播放后再显示）
                if (timerMode === 'break') {
                    showToastDialog('⏰ 休息结束', '继续你的计时吧！', 'break-end', currentTaskBlockId, currentTaskBlockName);
                } else {
                    showToastDialog('🍅 时间到！', '该休息一下了～', 'tomato-end', currentTaskBlockId, currentTaskBlockName);
                }
            } else {
                // v7.0.1 修复：始终使用 Date.now() 计算剩余时间，确保精准
                remainingSeconds = Math.ceil(Math.max(0, totalMs - elapsedMs) / 1000);
                updateDisplay();
            }
        }
    }

    async function handleTimerEndFromSyncOrLocal() {
        await recordEndTime();
        
        // 🔧 v9.5：番茄钟完成后，恢复 sessionId 供休息记录使用
        if (timerMode === 'countdown' && pendingBreakSessionId) {
            currentSessionId = pendingBreakSessionId;
            Logger.info('🔍 handleTimerEndFromSyncOrLocal: 恢复番茄钟 sessionId =', currentSessionId);
        }
        
        stopTimer();
        remainingSeconds = 0;
        updateDisplay();

        // 🔧 播放霓虹完成动画
        const isNeonMode = userSettings.appearance?.enableNeonEffect && userSettings.appearance?.theme !== 'default';
        if (isNeonMode && progressBar) {
            const progress = progressBar;
            const currentWidth = progress.style.width;
            progress.style.setProperty('--current-width', currentWidth);
            progress.classList.add('completing');

            // 动画结束后移除类
            setTimeout(() => {
                progress.classList.remove('completing');
            }, 2000);
        }

        try {
            if (timerMode === 'break') {
                await playEndSound('break-end');
            } else {
                await playEndSound('work-end');
            }
        } catch (audioError) {
            Logger.warn('🍅 播放提示音失败:', audioError);
        }

        if (timerMode === 'break') {
            showToastDialog('⏰ 休息结束', '继续你的计时吧！', 'break-end', currentTaskBlockId, currentTaskBlockName);
        } else {
            showToastDialog('🍅 时间到！', '该休息一下了～', 'tomato-end', currentTaskBlockId, currentTaskBlockName);
        }
    }

    // 🔧 新增：统一的本地计时器循环
    function startLocalTimerLoop() {
        if (timerId !== null) clearInterval(timerId);
        
        // 立即执行一次 tick
        handleTimerTick();
        
        timerId = setInterval(() => {
            if (!isRunning) return;
            handleTimerTick();
        }, CONFIG.TIMER_INTERVAL);
        
        Logger.debug('🔄 本地计时器循环已启动');
    }

    // 🔧 新增：计时器 tick 处理逻辑
    async function handleTimerTick() {
        const now = Date.now();
            
        if (timerMode === 'countdown' || timerMode === 'break') {
            let newRemainingSeconds;
            
            // 优先使用 syncState 计算
            if (syncState && syncState.startTime && syncState.status === 'RUNNING') {
                 newRemainingSeconds = StateCalculator.calculateRemaining(syncState);
            } else {
                 // 回退到本地计算
                 const totalMs = currentDuration * 60 * 1000;
                 const elapsedMs = now - startTime;
                 newRemainingSeconds = Math.ceil(Math.max(0, totalMs - elapsedMs) / 1000);
            }
            
            if (newRemainingSeconds <= 0) {
                await handleTimerEndFromSyncOrLocal();
            } else {
                // 🔧 性能优化：只在秒数变化时更新 DOM
                if (newRemainingSeconds !== remainingSeconds) {
                    remainingSeconds = newRemainingSeconds;
                    updateDisplay();
                    updateProgressBar(false);
                }
            }
        } else if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
             let newElapsedSeconds;
             
             if (syncState && syncState.stopwatchStartTimeMs && syncState.status === 'RUNNING') {
                 newElapsedSeconds = StateCalculator.calculateElapsed(syncState);
             } else {
                 if (stopwatchStartTimeMs > 0) {
                    newElapsedSeconds = Math.floor((now - stopwatchStartTimeMs) / 1000);
                } else {
                    newElapsedSeconds = Math.floor((now - startTime) / 1000);
                }
             }
             
             if (newElapsedSeconds !== elapsedSeconds) {
                elapsedSeconds = newElapsedSeconds;
                updateDisplay();
                updateProgressBar(false);
            }
        }
    }

    async function startTimer() {
        if (isRunning) return;
        
        // 🔧 v9.5：只有当番茄钟真正开始运行时才清除 pendingBreakSessionId
        // 如果只是恢复暂停的番茄钟，不要清除（休息记录还没保存）
        // pendingBreakSessionId 在休息记录保存时会被自动清除
        
        // 重置任务关联清除标志位
        taskAssociationCleared = false;
        Logger.info('🔍 startTimer: taskAssociationCleared 重置为 false');
        
        // 🔧 重新初始化音频，确保音频对象有效
        Logger.info('🍅 startTimer: 重新初始化音频...');
        await initAudio();
        Logger.info('🍅 startTimer: 音频初始化完成, workEndAudio:', !!workEndAudio, 'breakEndAudio:', !!breakEndAudio);

        // 🔧 修复：正计时不需要检查 currentStartTimestamp（正计时是累计计时）
        // 只有倒计时模式才需要检查 currentStartTimestamp
        if (timerMode !== 'stopwatch' && timerMode !== 'stopwatch-break') {
            if (currentStartTimestamp) await recordEndTime();
        }

        if (timerMode === 'countdown' || timerMode === 'break') {
            if (pausedRemainingSeconds !== null) {
                remainingSeconds = pausedRemainingSeconds;
                const totalMs = currentDuration * 60 * 1000;
                const elapsedMs = totalMs - (remainingSeconds * 1000);
                startTime = Date.now() - elapsedMs;
            } else {
                const isContinuingTomato = (remainingSeconds < currentDuration * 60);
                
                if (isContinuingTomato) {
                    const totalMs = currentDuration * 60 * 1000;
                    const elapsedMs = totalMs - (remainingSeconds * 1000);
                    startTime = Date.now() - elapsedMs;
                } else {
                    remainingSeconds = currentDuration * 60;
                    startTime = Date.now();
                }
            }
        } else if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
            if (pausedRemainingSeconds !== null) {
                // 正计时暂停后恢复
                elapsedSeconds = pausedRemainingSeconds;
                // 🔧 修复：只有当没有原始开始时间时才重新设置
                // 如果有原始开始时间（从休息恢复），保留它以确保历史记录正确
                if (!stopwatchStartTimestamp) {
                    stopwatchStartTimestamp = new Date().toISOString();
                }
                stopwatchStartTimeMs = Date.now() - (elapsedSeconds * 1000);
                startTime = Date.now() - (elapsedSeconds * 1000); // 同步设置 startTime
            } else {
                // 正计时全新开始
                // 🔧 修复：只有当没有原始开始时间时才重新设置
                if (!stopwatchStartTimestamp) {
                    stopwatchStartTimestamp = new Date().toISOString();
                }
                stopwatchStartTimeMs = Date.now() - (elapsedSeconds * 1000);
                startTime = Date.now() - (elapsedSeconds * 1000); // 同步设置 startTime
            }
        }
        
        isRunning = true;
        isTimerPaused = false;  // 清除暂停状态
        pausedRemainingSeconds = null;
        Logger.info('🔍 startTimer: 调用 recordStartTime，当前 timerMode =', timerMode, ', currentTaskBlockId =', currentTaskBlockId);
        recordStartTime();
        Logger.info('🔍 startTimer: recordStartTime 完成，currentStartTimestamp =', currentStartTimestamp, ', currentStartTimeMs =', currentStartTimeMs);

        if (controlButton) controlButton.innerHTML = '⏸️';
        if (timerId !== null) clearInterval(timerId);

        // 移动端悬浮条添加运行动画
        const floatBar = document.getElementById('siyuan-tomato-float-bar');
        if (floatBar) floatBar.classList.add('running');

        // 启动时使用动画效果
        updateProgressBar(true);

        // 🔧 性能优化：使用统一的计时器循环
        startLocalTimerLoop();
        
        // 🔧 修复：同步状态到云端
        if (isSyncEnabled() && typeof SyncManager !== 'undefined' && SyncManager.updateLocal) {
            // 🔧 v9.0 修复：正计时模式需要先设置 stopwatchStartTimeMs
            if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                // 如果是正计时模式且没有设置开始时间，则设置为当前时间
                if (!stopwatchStartTimeMs || stopwatchStartTimeMs === 0) {
                    stopwatchStartTimeMs = Date.now();
                }
            }
            
            syncState.status = 'RUNNING';
            syncState.startTime = timerMode === 'stopwatch' || timerMode === 'stopwatch-break' 
                ? stopwatchStartTimeMs 
                : startTime;
            syncState.mode = timerMode;
            syncState.duration = timerMode === 'stopwatch' || timerMode === 'stopwatch-break' 
                ? 8 * 3600  // 正计时最长 8 小时
                : currentDuration * 60;
            syncState.taskBlockId = currentTaskBlockId;
            syncState.taskBlockName = currentTaskBlockName;
            syncState.stopwatchStartTimeMs = stopwatchStartTimeMs;
            syncState.pausedIntervals = [];
            syncState.currentPauseStart = null;
            syncState.pausedElapsedSeconds = null;
            
            Logger.info('🔄 startTimer: 同步状态到云端', { 
                status: syncState.status, 
                mode: syncState.mode,
                startTime: syncState.startTime,
                stopwatchStartTimeMs: syncState.stopwatchStartTimeMs
            });
            
            await SyncManager.updateLocal(syncState, true);
        }
    }

    async function pauseTimer() {
        if (!isRunning) return;
        
        const now = Date.now();
        
        if (timerMode === 'countdown' || timerMode === 'break') {
            const totalMs = currentDuration * 60 * 1000;
            const elapsedMs = now - startTime;
            const remainingMs = Math.max(0, totalMs - elapsedMs);
            remainingSeconds = Math.floor(remainingMs / 1000);
            pausedRemainingSeconds = remainingSeconds;
        } else if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
            // 🔧 修复：正计时使用 stopwatchStartTimeMs 计算
            const elapsedMs = now - (stopwatchStartTimeMs || startTime);
            elapsedSeconds = Math.floor(elapsedMs / 1000);
            pausedRemainingSeconds = elapsedSeconds;
            // 🔧 修复：正计时暂停时保存记录
            if (elapsedSeconds > 0) {
                await recordEndTime(false, true);
            }
        }

        if (timerId !== null) clearInterval(timerId);
        timerId = null;
        isRunning = false;
        isTimerPaused = true;  // 设置暂停状态，进度条保持可见
        startTime = 0;
        lastTickTime = 0;

        // 移动端悬浮条移除运行动画
        const floatBar = document.getElementById('siyuan-tomato-float-bar');
        if (floatBar) floatBar.classList.remove('running');

        if (controlButton) controlButton.innerHTML = '▶️';
        updateDisplay();
        updateProgressBar(false);  // 暂停时不使用动画，进度条保持当前位置
        
        // 🔧 修复：同步暂停状态到云端
        if (isSyncEnabled() && typeof SyncManager !== 'undefined' && SyncManager.updateLocal) {
            syncState.status = 'PAUSED';
            syncState.currentPauseStart = now;
            if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                syncState.pausedElapsedSeconds = elapsedSeconds;
            }
            Logger.info('🔄 pauseTimer: 同步暂停状态到云端');
            await SyncManager.updateLocal(syncState, true);
        }
    }

    async function stopTimer() {
        if (timerId !== null) clearInterval(timerId);
        timerId = null;
        isRunning = false;
        isTimerPaused = false;  // 清除暂停状态
        startTime = 0;
        lastTickTime = 0;
        // 停止保持高亮的定时器
        stopHighlightKeepAlive();
        if (currentStartTimestamp) await recordEndTime();
        // 停止提示音
        stopAllAudio();
        hideProgressBar();  // 完全停止时隐藏进度条

        // 移动端悬浮条移除运行动画
        const floatBar = document.getElementById('siyuan-tomato-float-bar');
        if (floatBar) floatBar.classList.remove('running');
        
        // 🔧 修复：同步停止状态到云端
        if (isSyncEnabled() && typeof SyncManager !== 'undefined' && SyncManager.updateLocal) {
            syncState.status = 'IDLE';
            syncState.startTime = null;
            syncState.pausedIntervals = [];
            syncState.currentPauseStart = null;
            syncState.pausedElapsedSeconds = null;
            Logger.info('🔄 stopTimer: 同步停止状态到云端');
            await SyncManager.updateLocal(syncState, true);
        }
    }

    // 🔧 修复：为正计时添加变量，用于记录正计时的开始时间
    let stopwatchStartTimestamp = null;
    // stopwatchStartTimeMs 已在正计时模式专用状态区域声明

    // 🔧 v9.5 新增：番茄钟会话ID，用于追踪同一个番茄钟的多次暂停/恢复
    let currentSessionId = null;
    // 🔧 v9.5 新增：保存番茄钟完成后的 sessionId，供休息记录使用
    let pendingBreakSessionId = null;
    
    async function recordEndTime(isReset = false, isStopwatch = false) {
        Logger.info('🔍 recordEndTime 开始: isReset =', isReset, ', isStopwatch =', isStopwatch, ', timerMode =', timerMode);
        Logger.info('🔍 recordEndTime: currentTaskBlockId =', currentTaskBlockId);
        // 🔧 修复：支持正计时模式
        // 正计时使用 stopwatchStartTimestamp，倒计时使用 currentStartTimestamp
        let startTimestamp = isStopwatch ? stopwatchStartTimestamp : currentStartTimestamp;
        let startTimeMs = isStopwatch ? stopwatchStartTimeMs : currentStartTimeMs;

        // 🔧 v9.0 修复：如果本地时间戳无效，尝试从云端状态恢复
        if ((!startTimestamp || startTimeMs === 0) && syncState && syncState.startTime && syncState.status !== 'IDLE') {
            Logger.info('🔍 recordEndTime: 本地时间戳无效，从云端状态恢复');
            startTimeMs = syncState.stopwatchStartTimeMs || syncState.startTime;
            startTimestamp = new Date(startTimeMs).toISOString();
            Logger.info('🔍 recordEndTime: 从云端恢复，startTimestamp =', startTimestamp, ', startTimeMs =', startTimeMs);
        }

        Logger.info('🔍 recordEndTime: startTimestamp =', startTimestamp, ', startTimeMs =', startTimeMs);
        if (!startTimestamp || startTimeMs === 0) {
            Logger.info('🔍 recordEndTime: 时间戳无效，提前返回');
            return;
        }

        // 🔧 修复：计时结束后保持高亮（只要任务关联存在）
        // 不再清除高亮，让高亮定时器继续工作

        let endTimeMs = Date.now();

        // 🔧 修复：减去暂停时间
        // 如果存在暂停记录（syncState.currentPauseStart），说明是在暂停后恢复计时（或者暂停状态下停止），
        // 此时应该使用暂停开始的时间作为本段计时的结束时间，从而排除掉暂停持续的时间。
        // 仅对倒计时/休息模式有效（正计时模式使用 elapsedSeconds，已处理暂停）。
        if ((timerMode === 'countdown' || timerMode === 'break') && 
            typeof syncState !== 'undefined' && syncState && syncState.currentPauseStart) {
            endTimeMs = syncState.currentPauseStart;
            Logger.info('🔍 recordEndTime: 检测到暂停记录，使用暂停时间作为结束时间:', endTimeMs);
        }

        const now = new Date(endTimeMs);
        
        const actualElapsedMs = Math.max(0, endTimeMs - startTimeMs);
        const actualElapsedSec = Math.floor(actualElapsedMs / 1000);
        const actualElapsedMin = Math.round(actualElapsedMs / 60000);

        let finalElapsedSec = actualElapsedSec;
        let finalElapsedMin = actualElapsedMin;

        if (timerMode === 'countdown' || timerMode === 'break') {
            const totalSec = currentDuration * 60;
            if (actualElapsedSec > totalSec) {
                finalElapsedSec = totalSec;
                finalElapsedMin = currentDuration;
            }
        }

        // 🔧 正计时使用 elapsedSeconds（暂停时计算的值）
        if (isStopwatch) {
            finalElapsedSec = elapsedSeconds || finalElapsedSec;
            finalElapsedMin = Math.floor(finalElapsedSec / 60);
        }

        try {
            const records = await loadHistoryRecords();
            const durationMinToSave = finalElapsedMin;
            const durationSecToSave = finalElapsedSec;

            // 日志移除：减少开销

            // 准备记录数据，包含任务块信息
            Logger.info('🔍 recordEndTime: currentTaskBlockId =', currentTaskBlockId, ', taskAssociationCleared =', taskAssociationCleared);
            // 如果用户清除了关联，则不保存任务块信息
            const shouldSaveTaskAssociation = !taskAssociationCleared && currentTaskBlockId;
            Logger.info('🔍 recordEndTime: shouldSaveTaskAssociation =', shouldSaveTaskAssociation);
            
            // 🔧 v9.5 修改：检查是否需要为新番茄生成新的 sessionId
            // 只有当没有 sessionId，或者用户手动开始了一个全新的番茄钟（从头开始）时才生成新的
            // 从暂停恢复的番茄钟应该使用同一个 sessionId
            // 🔧 v9.5.1 修复：从休息模式重置回番茄钟继续计时后，再次保存记录时应该生成新的 sessionId
            // 这样每个"完整的番茄钟周期"（从开始到结束/重置）都有唯一的 sessionId
            const initialRemainingSecondsAtStart = getInitialRemainingAtStart();
            const fullDurationSeconds = currentDuration * 60;
            const isStartedFromFullDuration = initialRemainingSecondsAtStart === fullDurationSeconds;
            // 如果是从休息模式重置回来继续计时，需要生成新的 sessionId
            const isResumingFromBreak = timerMode === 'countdown' && preBreakState !== null && !isFreshTomatoStart;
            const shouldBeNewTomato = (isStartedFromFullDuration && isFreshTomatoStart) || timerMode === 'countdown' || isResumingFromBreak;
            
            // 🔧 v9.5.1：只有新番茄钟或从休息恢复时才生成新的 sessionId
            if (!currentSessionId || shouldBeNewTomato) {
                currentSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                Logger.info('🔍 recordEndTime: 生成新的 sessionId =', currentSessionId, ', shouldBeNewTomato =', shouldBeNewTomato, ', isResumingFromBreak =', isResumingFromBreak);
            }
            
            const recordData = {
                start: startTimestamp,
                end: now.toISOString(),
                durationMin: durationMinToSave,
                durationSec: durationSecToSave,
                mode: timerMode,
                timestamp: now.getTime(),
                date: formatDateKey(now),
                dateTime: now.toLocaleString('zh-CN'),
                timePeriod: getTimePeriod(new Date(startTimestamp).getHours()),
                isCompleted: false,
                wasReset: isReset,
                taskBlockId: shouldSaveTaskAssociation ? currentTaskBlockId : null,
                taskBlockName: shouldSaveTaskAssociation ? currentTaskBlockName : null,
                databaseBlockId: shouldSaveTaskAssociation ? currentDatabaseBlockId : null,
                // 🔧 v9.5 新增：会话ID，用于关联同一个番茄钟的多次暂停/恢复
                sessionId: currentSessionId,
                // 🔧 v9.5 新增：计划时长，用于统计去重
                plannedDuration: currentDuration
            };
            
            // 🔧 v9.5：如果设置了隐藏短记录且时长小于1分钟，则不保存
            if (userSettings.hideShortRecords && durationMinToSave < 1) {
                Logger.info('🔍 recordEndTime: 时长小于1分钟且开启隐藏短记录，跳过保存');
            } else {
                if (timerMode === 'break' || timerMode === 'stopwatch-break') {
                    recordData.mode = timerMode === 'break' ? 'break' : 'stopwatch-break';
                    // 🔧 v9.5：休息记录使用保存的 sessionId
                    recordData.sessionId = currentSessionId || pendingBreakSessionId;
                    recordData.plannedDuration = currentDuration;
                    records.push(recordData);
                } 
                else if (timerMode === 'countdown') {
                    // 🔧 v9.5 修改：移除合并逻辑，每次暂停/恢复都作为独立记录保存
                    // 通过 sessionId 在统计时去重，确保计划时间只计算一次
                    records.push(recordData);
                    isFreshTomatoStart = false;
                }
                else if (timerMode === 'stopwatch') {
                    records.push(recordData);
                }

                await saveHistoryRecords(records);
                Logger.info('✅ 记录已保存');
                markTimelineHistoryDirty();
            }

            // 🔧 v9.5：如果这是番茄钟记录，保存 sessionId 供休息记录使用
            if (timerMode === 'countdown') {
                pendingBreakSessionId = currentSessionId;
                Logger.info('🔍 recordEndTime: 保存番茄钟 sessionId 供休息使用 =', pendingBreakSessionId);
            } else if (timerMode === 'break' || timerMode === 'stopwatch-break') {
                // 🔧 v9.5：休息记录保存完成后，清除 pendingBreakSessionId
                pendingBreakSessionId = null;
                Logger.info('🔍 recordEndTime: 休息记录保存完成，清除 pendingBreakSessionId');
            }

            // 🔧 v9.5：重置 sessionId（下次开始时重新生成）
            // 注意：番茄钟的 sessionId 已保存到 pendingBreakSessionId，供休息记录使用
            currentSessionId = null;

            // 只有当用户没有清除关联，才更新任务块的番茄时间属性
            Logger.info('🔍 自定义属性更新检查:', { taskAssociationCleared, currentTaskBlockId, durationSecToSave, timerMode });
            if (!taskAssociationCleared && currentTaskBlockId && durationSecToSave > 0 && timerMode !== 'break' && timerMode !== 'stopwatch-break') {
                // 🔧 修复：传递秒数以便更精确地处理小于1分钟的记录
                // 🔧 修复：添加 await 确保异步函数正确执行
                Logger.info('🔍 调用 updateTaskBlockTomatoTime:', currentTaskBlockId, durationSecToSave);
                await updateTaskBlockTomatoTime(currentTaskBlockId, durationSecToSave);
                Logger.info('🔍 updateTaskBlockTomatoTime 执行完成');
            } else if (taskAssociationCleared) {
                Logger.info('🔍 用户已清除关联，跳过更新任务块番茄时间');
            } else {
                Logger.info('🔍 跳过自定义属性更新，条件不满足:', {
                    taskAssociationCleared,
                    hasTaskBlockId: !!currentTaskBlockId,
                    durationSecToSave,
                    timerMode
                });
            }
        } catch (e) {
            // 错误日志保留用于调试
            console.error('保存记录时出错:', e);
        }

        // 🔧 修复：正计时保存完成后清除正计时的时间变量
        if (isStopwatch) {
            stopwatchStartTimestamp = null;
            stopwatchStartTimeMs = 0;
        }

        // 注意：不再自动清除任务块关联，保留供后续计时使用
        currentStartTimestamp = null;
        currentStartTimeMs = 0;
    }

    /**
     * 清除当前计时记录中的任务块和数据库块关联
     * 当用户手动清除关联时调用，确保这笔计时与任务/数据库块无关
     */
    async function clearCurrentRecordAssociation() {
        if (!currentStartTimestamp) {
            Logger.info('🔍 没有正在进行的计时，无需清除记录关联');
            return;
        }

        // 设置标志位，确保后续保存记录时不关联任务
        taskAssociationCleared = true;
        Logger.info('🔍 已设置 taskAssociationCleared = true');

        try {
            const records = await loadHistoryRecords();
            // 查找当前正在进行的记录：
            // 1. 计时进行中：开始时间匹配，且还没有结束时间
            // 2. 计时刚完成：开始时间匹配，结束时间就是当前时间
            const currentRecordIndex = records.findIndex(r =>
                r.start === currentStartTimestamp &&
                (!r.end || r.end === 'null' || r.end === null || r.end === new Date().toISOString())
            );

            if (currentRecordIndex !== -1) {
                records[currentRecordIndex].taskBlockId = null;
                records[currentRecordIndex].taskBlockName = null;
                records[currentRecordIndex].databaseBlockId = null;
                await saveHistoryRecords(records);
                Logger.info('✅ 已清除当前计时记录中的任务块和数据库块关联');
            } else {
                Logger.info('🔍 未找到当前计时记录，可能尚未保存');
            }
        } catch (e) {
            Logger.warn('⚠️ 清除记录关联时出错:', e);
        }
    }

    async function switchToCountdownAndStart(duration) {
        // 🔧 修复：正计时模式下需要传递 isStopwatch = true
        if (isRunning) await recordEndTime(false, timerMode === 'stopwatch' || timerMode === 'stopwatch-break');
        preBreakState = null;
        pausedRemainingSeconds = null;
        currentStartTimestamp = null;
        currentStartTimeMs = 0;
        isFreshTomatoStart = true;
        timerMode = 'countdown';
        // 🔧 修复：同步更新 syncState.mode，确保自定义属性更新正确判断模式
        syncState.mode = 'countdown';
        currentDuration = duration;
        remainingSeconds = duration * 60;
        isRunning = false;
        lastTomatoConfig = { duration, mode: 'countdown' };
        lastTickTime = 0;
        updateDisplay();
        startTimer();
    }

    // 带任务块关联的番茄钟切换
    async function switchToCountdownAndStartWithTask(duration, taskBlockId, taskBlockName) {
        // 🔧 修复：正计时模式下需要传递 isStopwatch = true
        if (isRunning) await recordEndTime(false, timerMode === 'stopwatch' || timerMode === 'stopwatch-break');
        preBreakState = null;
        pausedRemainingSeconds = null;
        
        // ✅ 修复：在开始计时时设置 currentStartTimestamp 和 currentStartTimeMs
        const now = new Date();
        currentStartTimestamp = now.toISOString();
        currentStartTimeMs = Date.now();
        
        isFreshTomatoStart = true;
        timerMode = 'countdown';
        // 🔧 修复：同步更新 syncState.mode，确保自定义属性更新正确判断模式
        syncState.mode = 'countdown';
        currentDuration = duration;
        remainingSeconds = duration * 60;
        isRunning = false;
        lastTomatoConfig = { duration, mode: 'countdown' };
        lastTickTime = 0;

        // 设置任务块信息
        // 日志移除：减少开销
        currentTaskBlockId = taskBlockId;
        currentTaskBlockName = taskBlockName;
        // 日志移除：减少开销

        updateDisplay();
        startTimer();

        // 立即高亮
        highlightTaskBlock(taskBlockId);

        // 延迟再次高亮，确保元素已渲染
        setTimeout(() => {
            highlightTaskBlock(taskBlockId);
        }, 100);

        // 启动保持高亮的定时器
        startHighlightKeepAlive();
    }

    async function switchToStopwatchAndStart() {
        // 🔧 修复：正计时模式下需要传递 isStopwatch = true
        if (isRunning) await recordEndTime(false, timerMode === 'stopwatch' || timerMode === 'stopwatch-break');
        preBreakState = null;
        timerMode = 'stopwatch';
        // 🔧 修复：同步更新 syncState.mode，确保自定义属性更新正确判断模式
        syncState.mode = 'stopwatch';
        elapsedSeconds = 0;
        stopwatchDisplayOffset = 0;  // 🔧 新开始时清除显示偏移
        // 🔧 修复：清除旧的时间戳，确保 startTimer() 设置新值
        stopwatchStartTimestamp = null;
        stopwatchStartTimeMs = 0;
        isRunning = false;
        pausedRemainingSeconds = null;
        isFreshTomatoStart = false;
        lastTickTime = 0;
        updateDisplay();
        startTimer();
    }

    // 带任务块关联的正计时切换
    async function switchToStopwatchAndStartWithTask(taskBlockId, taskBlockName) {
        if (isRunning) await recordEndTime(false, timerMode === 'stopwatch' || timerMode === 'stopwatch-break');
        preBreakState = null;
        timerMode = 'stopwatch';
        // 🔧 修复：同步更新 syncState.mode，确保自定义属性更新正确判断模式
        syncState.mode = 'stopwatch';
        elapsedSeconds = 0;
        stopwatchDisplayOffset = 0;  // 🔧 新开始时清除显示偏移
        isRunning = false;
        pausedRemainingSeconds = null;
        isFreshTomatoStart = false;
        lastTickTime = 0;

        // 🔧 修复：正计时使用独立的开始时间变量，同时设置 startTime 供暂停计算使用
        const now = new Date();
        stopwatchStartTimestamp = now.toISOString();
        stopwatchStartTimeMs = Date.now();
        startTime = Date.now(); // 同时设置 startTime，供 pauseTimer 使用
        // 日志移除：减少开销

        // 设置任务块信息
        currentTaskBlockId = taskBlockId;
        currentTaskBlockName = taskBlockName;

        updateDisplay();
        startTimer();

        // 立即高亮
        highlightTaskBlock(taskBlockId);

        // 延迟再次高亮，确保元素已渲染
        setTimeout(() => {
            highlightTaskBlock(taskBlockId);
        }, 100);

        // 启动保持高亮的定时器
        startHighlightKeepAlive();
    }

    async function startBreakMode(duration) {
        if (timerMode === 'countdown') {
            let actualRemaining = null;
            if (isRunning && startTime > 0) {
                const now = Date.now();
                const totalMs = currentDuration * 60 * 1000;
                const elapsedMs = now - startTime;
                actualRemaining = Math.max(0, Math.floor((totalMs - elapsedMs) / 1000));
            } else if (pausedRemainingSeconds != null) {
                actualRemaining = pausedRemainingSeconds;
            } else {
                actualRemaining = remainingSeconds;
            }
            
            if (actualRemaining > 0) {
                preBreakState = {
                    mode: 'countdown',
                    currentDuration: currentDuration,
                    remainingSeconds: actualRemaining,
                };
            }
        } else if (timerMode === 'stopwatch') {
            let actualElapsed = null;
            if (isRunning && startTime > 0) {
                const elapsedMs = Date.now() - startTime;
                actualElapsed = Math.floor(elapsedMs / 1000);
            } else if (pausedRemainingSeconds != null) {
                actualElapsed = pausedRemainingSeconds;
            } else {
                actualElapsed = elapsedSeconds;
            }
            
            // 🔧 修复：保存原始开始时间，以便恢复后记录正确的开始时间
            preBreakState = { 
                mode: 'stopwatch', 
                elapsedSeconds: actualElapsed,
                originalStartTimestamp: stopwatchStartTimestamp,
                originalStartTimeMs: stopwatchStartTimeMs
            };
        }

        // 🔧 修复：正计时进入休息时保存当前记录，休息后继续计时会产生新记录
        // 🔧 修复：正计时模式下需要传递 isStopwatch = true
        const wasStopwatch = timerMode === 'stopwatch';
        if (isRunning) await recordEndTime(false, wasStopwatch);

        timerMode = 'break';
        currentDuration = duration;
        remainingSeconds = duration * 60;
        isRunning = false;
        pausedRemainingSeconds = null;
        // 🔧 修复：清除 currentStartTimestamp，避免重置休息模式时错误保存记录
        currentStartTimestamp = null;
        currentStartTimeMs = 0;
        isFreshTomatoStart = false;
        lastTickTime = 0;
        
        // 🔧 修复：同步休息模式到云端，避免被同步轮询覆盖
        syncState.mode = 'break';
        syncState.duration = duration * 60;
        syncState.status = 'IDLE';
        if (typeof SyncManager !== 'undefined' && SyncManager.updateLocal) {
            await SyncManager.updateLocal(syncState, true);
        }
        
        updateDisplay();
        startTimer();
    }

    async function startStopwatchBreakMode() {
        if (timerMode === 'countdown') {
            let actualRemaining = null;
            if (isRunning && startTime > 0) {
                const now = Date.now();
                const totalMs = currentDuration * 60 * 1000;
                const elapsedMs = now - startTime;
                actualRemaining = Math.max(0, Math.floor((totalMs - elapsedMs) / 1000));
            } else if (pausedRemainingSeconds != null) {
                actualRemaining = pausedRemainingSeconds;
            } else {
                actualRemaining = remainingSeconds;
            }
            
            if (actualRemaining > 0) {
                preBreakState = {
                    mode: 'countdown',
                    currentDuration: currentDuration,
                    remainingSeconds: actualRemaining,
                };
            }
        } else if (timerMode === 'stopwatch') {
            let actualElapsed = null;
            if (isRunning && startTime > 0) {
                const elapsedMs = Date.now() - startTime;
                actualElapsed = Math.floor(elapsedMs / 1000);
            } else if (pausedRemainingSeconds != null) {
                actualElapsed = pausedRemainingSeconds;
            } else {
                actualElapsed = elapsedSeconds;
            }
            
            // 🔧 修复：保存原始开始时间，以便恢复后记录正确的开始时间
            preBreakState = { 
                mode: 'stopwatch', 
                elapsedSeconds: actualElapsed,
                originalStartTimestamp: stopwatchStartTimestamp,
                originalStartTimeMs: stopwatchStartTimeMs
            };
        }

        // 🔧 修复：正计时进入休息时保存当前记录，休息后继续计时会产生新记录
        // 🔧 修复：正计时模式下需要传递 isStopwatch = true
        const wasStopwatch = timerMode === 'stopwatch';
        if (isRunning) await recordEndTime(false, wasStopwatch);

        timerMode = 'stopwatch-break';
        elapsedSeconds = 0;
        isRunning = false;
        pausedRemainingSeconds = null;
        isFreshTomatoStart = false;
        lastTickTime = 0;
        
        // 🔧 修复：同步休息模式到云端，避免被同步轮询覆盖
        syncState.mode = 'stopwatch-break';
        syncState.status = 'IDLE';
        if (typeof SyncManager !== 'undefined' && SyncManager.updateLocal) {
            await SyncManager.updateLocal(syncState, true);
        }
        
        updateDisplay();
        startTimer();
    }

    async function resetCurrentMode() {
        // 注意：不再自动清除任务块关联，用户可以通过📋️图标的删除按钮手动清除
        if (timerMode === 'break' || timerMode === 'stopwatch-break') {
            if (isRunning) {
                if (timerId !== null) clearInterval(timerId);
                timerId = null;
                isRunning = false;
                startTime = 0;
                lastTickTime = 0;
                await recordEndTime(true);
            } else if (currentStartTimestamp) {
                await recordEndTime(true);
            }

            if (preBreakState) {
                if (preBreakState.mode === 'countdown') {
                    timerMode = 'countdown';
                    // 🔧 修复：同步更新 syncState.mode
                    syncState.mode = 'countdown';
                    currentDuration = preBreakState.currentDuration;
                    remainingSeconds = preBreakState.remainingSeconds;
                    pausedRemainingSeconds = preBreakState.remainingSeconds;
                    isRunning = false;
                    currentStartTimestamp = null;
                    currentStartTimeMs = 0;
                    isFreshTomatoStart = false;
                    lastTickTime = 0;
                    // 🔧 修复：继续休息后保持高亮
                    if (controlButton) controlButton.innerHTML = '▶️';
                    updateDisplay();
                } else if (preBreakState.mode === 'stopwatch') {
                    timerMode = 'stopwatch';
                    // 🔧 修复：同步更新 syncState.mode
                    syncState.mode = 'stopwatch';
                    // 🔧 修复：保存休息前的时间作为显示偏移，实际计时从0开始
                    stopwatchDisplayOffset = preBreakState.elapsedSeconds || 0;
                    elapsedSeconds = 0;
                    // 🔧 修复：清除开始时间，让 startTimer 设置新的开始时间
                    stopwatchStartTimestamp = null;
                    stopwatchStartTimeMs = 0;
                    isRunning = false;
                    pausedRemainingSeconds = null;
                    isFreshTomatoStart = false;
                    lastTickTime = 0;
                    // 🔧 修复：恢复后显示待开始按钮
                    if (controlButton) controlButton.innerHTML = '▶️';
                    updateDisplay();
                }
            } else {
                timerMode = 'countdown';
                // 🔧 修复：同步更新 syncState.mode
                syncState.mode = 'countdown';
                remainingSeconds = currentDuration * 60;
                isRunning = false;
                pausedRemainingSeconds = null;
                currentStartTimestamp = null;
                currentStartTimeMs = 0;
                lastTickTime = 0;
                isFreshTomatoStart = true;
                // 🔧 修复：重置时保持高亮
                if (controlButton) controlButton.innerHTML = '▶️';
                updateDisplay();
            }
            
            // 🔧 v9.0 修复：休息模式重置后必须同步状态到云端，否则轮询会覆盖本地状态
            if (isSyncEnabled() && SyncManager.updateLocal) {
                syncState.status = 'IDLE';
                syncState.startTime = null;
                syncState.pausedIntervals = [];
                syncState.currentPauseStart = null;
                syncState.pausedElapsedSeconds = null;
                // 清除 preBreakState，避免云端恢复时再次进入休息前状态
                preBreakState = null;
                await SyncManager.updateLocal(syncState, true);
                Logger.info('🔄 休息模式重置状态已同步到云端');
            }
            return;
        }
        
        if (timerMode === 'countdown') {
            if (isRunning || (currentStartTimestamp && remainingSeconds < currentDuration * 60)) {
                Logger.info('🔍 resetCurrentMode: 倒计时重置，准备保存记录');
                Logger.info('🔍 resetCurrentMode: isRunning =', isRunning, ', currentStartTimestamp =', currentStartTimestamp);
                Logger.info('🔍 resetCurrentMode: currentTaskBlockId =', currentTaskBlockId);
                if (timerId !== null) clearInterval(timerId);
                timerId = null;
                isRunning = false;
                startTime = 0;
                lastTickTime = 0;
                await recordEndTime(true);
            } else if (syncState && syncState.startTime && syncState.status !== 'IDLE') {
                // 🔧 v9.0 修复：即使本地状态未运行，但云端有运行记录时也保存
                Logger.info('🔍 resetCurrentMode: 倒计时从云端状态恢复并重置，准备保存记录');
                const cloudRemaining = StateCalculator.calculateRemaining(syncState);
                if (cloudRemaining < syncState.duration) {
                    // 从云端计算实际用时
                    remainingSeconds = cloudRemaining;
                    await recordEndTime(true);
                }
            } else {
                Logger.info('🔍 resetCurrentMode: 倒计时重置，条件不满足，跳过保存');
                Logger.info('🔍 resetCurrentMode: isRunning =', isRunning, ', currentStartTimestamp =', currentStartTimestamp);
            }
        } else if (timerMode === 'stopwatch') {
            // 🔧 v9.0 修复：正计时重置时保存记录，优先从云端状态获取时间
            let actualElapsed = elapsedSeconds;
            
            // 优先从云端状态计算实际经过时间
            if (syncState && syncState.startTime && syncState.status !== 'IDLE') {
                const cloudElapsed = StateCalculator.calculateElapsed(syncState);
                actualElapsed = Math.max(actualElapsed, cloudElapsed);
                Logger.info('🔍 resetCurrentMode: 从云端状态计算正计时时间，cloudElapsed =', cloudElapsed);
            } else if (stopwatchStartTimeMs > 0) {
                actualElapsed = Math.max(elapsedSeconds, Math.floor((Date.now() - stopwatchStartTimeMs) / 1000));
            }
            
            if (actualElapsed > 0 || stopwatchDisplayOffset > 0) {
                // 确保 elapsedSeconds 是最新值
                elapsedSeconds = actualElapsed;
                await recordEndTime(true, true);
            }
            if (timerId !== null) clearInterval(timerId);
            timerId = null;
            isRunning = false;
            startTime = 0;
            lastTickTime = 0;
            elapsedSeconds = 0;
            stopwatchDisplayOffset = 0;  // 🔧 重置时清除显示偏移
            stopwatchStartTimestamp = null;
            stopwatchStartTimeMs = 0;
        }
        
        if (timerMode === 'countdown') {
            remainingSeconds = currentDuration * 60;
            isRunning = false;
            pausedRemainingSeconds = null;
            preBreakState = null;
            currentStartTimestamp = null;
            currentStartTimeMs = 0;
            lastTickTime = 0;
            isFreshTomatoStart = true;
        } else if (timerMode === 'break') {
            remainingSeconds = currentDuration * 60;
            isRunning = false;
            pausedRemainingSeconds = null;
            currentStartTimestamp = null;
            currentStartTimeMs = 0;
            lastTickTime = 0;
            isFreshTomatoStart = false;
        } else if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
            elapsedSeconds = 0;
            isRunning = false;
            pausedRemainingSeconds = null;
            startTime = 0;
            currentStartTimestamp = null;
            currentStartTimeMs = 0;
            lastTickTime = 0;
            isFreshTomatoStart = false;
        }

        // 注意：不再自动清除任务块关联，保留供后续计时使用
        if (controlButton) controlButton.innerHTML = '▶️';
        updateDisplay();
        // 🔧 修复：暂停时保持高亮（任务块关联仍然存在）
        
        // 🔧 v9.0 修复：重置后同步状态到云端
        if (isSyncEnabled() && SyncManager.updateLocal) {
            syncState.status = 'IDLE';
            syncState.startTime = null;
            syncState.pausedIntervals = [];
            syncState.currentPauseStart = null;
            syncState.pausedElapsedSeconds = null;
            await SyncManager.updateLocal(syncState, true);
            Logger.info('🔄 重置状态已同步到云端');
        }
    }

    function createButtonGroup(values, currentValue, onClick, isBreak = false) {
        const group = document.createElement('div');
        group.style.cssText = `
            display: flex;
            gap: 4px;
            padding: 4px 8px;
            justify-content: center;
            flex-wrap: wrap;
        `;
        
        values.forEach(val => {
            const btn = document.createElement('button');
            btn.textContent = val;
            btn.style.cssText = `
                font-size: 11px;
                padding: 2px 5px;
                border-radius: 3px;
                border: 1px solid var(--b3-theme-surface-light);
                background: ${val === currentValue ? 'var(--b3-theme-primary)' : 'transparent'};
                color: ${val === currentValue ? 'white' : 'var(--b3-theme-on-background)'};
                cursor: pointer;
                min-width: auto;
                flex: 1;
                transition: all 0.2s;
            `;
            // 悬停效果
            btn.onmouseenter = () => {
                if (val !== currentValue) {
                    btn.style.background = 'var(--b3-theme-surface-light)';
                }
            };
            btn.onmouseleave = () => {
                if (val !== currentValue) {
                    btn.style.background = 'transparent';
                }
            };
            btn.onclick = (e) => { 
                e.stopPropagation(); 
                onClick(val); 
                const menu = document.getElementById('tomy-tomato-context-menu');
                if (menu) menu.remove();
                isContextMenuOpen = false;  // 菜单关闭
            };
            group.appendChild(btn);
        });
        
        if (isBreak) {
            const stopwatchBtn = document.createElement('button');
            stopwatchBtn.textContent = '计';
            stopwatchBtn.style.cssText = `
                font-size: 11px;
                padding: 2px 5px;
                border-radius: 3px;
                border: 1px solid var(--b3-theme-surface-light);
                background: ${timerMode === 'stopwatch-break' ? '#4CAF50' : 'transparent'};
                color: ${timerMode === 'stopwatch-break' ? 'white' : 'var(--b3-theme-on-background)'};
                cursor: pointer;
                min-width: auto;
                flex: 1;
                transition: all 0.2s;
            `;
            // 悬停效果
            stopwatchBtn.onmouseenter = () => {
                if (timerMode !== 'stopwatch-break') {
                    stopwatchBtn.style.background = 'var(--b3-theme-surface-light)';
                }
            };
            stopwatchBtn.onmouseleave = () => {
                if (timerMode !== 'stopwatch-break') {
                    stopwatchBtn.style.background = 'transparent';
                }
            };
            stopwatchBtn.onclick = async (e) => { 
                e.stopPropagation(); 
                await startStopwatchBreakMode(); 
                const menu = document.getElementById('tomy-tomato-context-menu');
                if (menu) menu.remove();
                isContextMenuOpen = false;  // 菜单关闭
            };
            group.appendChild(stopwatchBtn);
        }
        
        return group;
    }

    async function showContextMenu(x, y) {
        // 设置菜单状态为打开
        isContextMenuOpen = true;

        // 🔧 关闭悬停显示的悬浮窗，防止堆叠
        const tooltipEl = document.getElementById('tomy-tomato-tooltip');
        if (tooltipEl) {
            tooltipEl.remove();
        }

        const existing = document.getElementById('tomy-tomato-context-menu');
        if (existing) {
            existing.remove();
        }

        let menu = document.createElement('div');
        menu.id = 'tomy-tomato-context-menu';
        menu.style.cssText = `
            position: fixed;
            top: 0,
            left: 0;
            transform: translate(0, 0);
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 2147483647;
            font-size: 13px;
            min-width: 160px;
            max-width: 240px;
            padding: 6px 0;
            pointer-events: auto;
            user-select: none;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.1s ease-out;
        `;

        // 移动端：关闭悬浮条选项（放在最顶部，仅当悬浮条存在时显示）
        if (isMobileDevice() && isUsingFloatBar) {
            const closeFloatBarItem = document.createElement('div');
            closeFloatBarItem.textContent = '❌ 关闭悬浮窗';
            closeFloatBarItem.style.cssText = `padding: 6px 12px; cursor: pointer; text-align: left; color: var(--b3-theme-error, #f44336); font-weight: bold;`;
            closeFloatBarItem.onmouseenter = () => closeFloatBarItem.style.backgroundColor = 'var(--b3-theme-surface-light)';
            closeFloatBarItem.onmouseleave = () => closeFloatBarItem.style.backgroundColor = '';
            closeFloatBarItem.onclick = async (e) => {
                e.stopPropagation();
                
                // 🔧 v9.0 修复：关闭悬浮窗不停止计时，只是隐藏UI
                // 计时器继续在后台运行，状态保持不变
                
                // 🔧 性能优化：先清理事件监听器
                cleanupFloatBarEvents();
                // 移除悬浮条
                document.getElementById('siyuan-tomato-float-bar')?.remove();
                isUsingFloatBar = false;
                // 🔧 v9.0 修复：清空 timeDisplay 和 controlButton 引用
                timeDisplay = null;
                controlButton = null;
                // 标记用户主动关闭
                floatBarHiddenByUser = true;
                // 关闭菜单
                menu.remove();
                isContextMenuOpen = false;
            };
            menu.appendChild(closeFloatBarItem);

            const hrClose = document.createElement('hr');
            hrClose.style.cssText = `margin: 4px 0; border: none; border-top: 1px solid var(--b3-theme-surface-light);`;
            menu.appendChild(hrClose);
        }

        const tomatoTitle = document.createElement('div');
        tomatoTitle.textContent = '🍅 番茄';
        tomatoTitle.style.cssText = `
            padding: 4px 12px 2px;
            font-size: 12px;
            font-weight: bold;
            opacity: 0.7;
            text-align: left;
        `;
        menu.appendChild(tomatoTitle);

        // 移动端显示关联项目名称
        if (isMobileDevice() && (currentTaskBlockName || currentDatabaseBlockId)) {
            const taskName = currentTaskBlockName || '数据库任务';
            const taskNameDisplay = document.createElement('div');
            taskNameDisplay.innerHTML = `📎 关联: <strong style="color: var(--b3-theme-primary);">${taskName}</strong>`;
            taskNameDisplay.style.cssText = `
                padding: 4px 12px;
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                text-align: left;
            `;
            menu.appendChild(taskNameDisplay);
        }

        // 清除关联任务（仅当有关联任务时显示）- 放在显示关联任务下方
        if (isMobileDevice() && (currentTaskBlockId || currentDatabaseBlockId)) {
            const clearTaskItem = document.createElement('div');
            clearTaskItem.textContent = '❌ 清除关联任务';
            clearTaskItem.style.cssText = `padding: 6px 12px; cursor: pointer; text-align: left;`;
            clearTaskItem.onmouseenter = () => clearTaskItem.style.backgroundColor = 'var(--b3-theme-surface-light)';
            clearTaskItem.onmouseleave = () => clearTaskItem.style.backgroundColor = '';
            clearTaskItem.onclick = async (e) => { 
                e.stopPropagation(); 
                Logger.info('🔍 清除关联前: currentTaskBlockId =', currentTaskBlockId);
                // 先清除当前记录中的关联
                await clearCurrentRecordAssociation();
                Logger.info('🔍 清除记录关联后: currentTaskBlockId =', currentTaskBlockId);
                // 清除任务关联（包括任务块和数据库块）
                currentTaskBlockId = null;
                currentTaskBlockName = null;
                currentDatabaseBlockId = null;
                Logger.info('🔍 设置变量为null后: currentTaskBlockId =', currentTaskBlockId);
                // 清除高亮
                document.querySelectorAll('.tomato-task-highlight').forEach(el => {
                    el.classList.remove('tomato-task-highlight');
                });
                // 同时清除数据库行高亮
                document.querySelectorAll('.tomato-db-row-highlight').forEach(el => {
                    el.classList.remove('tomato-db-row-highlight');
                });
                // 更新任务块图标
                updateTaskBlockIcon();
                // 🔧 v9.0 修复：同步清除任务关联到云端
                if (isSyncEnabled() && SyncManager.updateLocal) {
                    syncState.taskBlockId = null;
                    syncState.taskBlockName = null;
                    syncState.databaseBlockId = null;
                    await SyncManager.updateLocal(syncState, true);
                    Logger.info('🔄 任务关联已同步清除到云端');
                }
                // 关闭菜单
                menu.remove(); 
                isContextMenuOpen = false;  // 菜单关闭
            };
            menu.appendChild(clearTaskItem);
        }

        menu.appendChild(createButtonGroup(getTomatoDurations(),
            timerMode === 'countdown' ? currentDuration : null,
            async (val) => { await switchToCountdownAndStart(val); },
            false
        ));

        const breakTitle = document.createElement('div');
        breakTitle.textContent = '☕ 休息';
        breakTitle.style.cssText = `
            padding: 8px 12px 2px;
            font-size: 12px;
            font-weight: bold;
            opacity: 0.7;
            text-align: left;
        `;
        menu.appendChild(breakTitle);

        menu.appendChild(createButtonGroup(getBreakDurations(),
            timerMode === 'break' ? currentDuration : null,
            async (val) => { await startBreakMode(val); },
            true
        ));

        const hr2 = document.createElement('hr');
        hr2.style.cssText = `margin: 4px 0; border: none; border-top: 1px solid var(--b3-theme-surface-light);`;
        menu.appendChild(hr2);

        const stopwatchItem = document.createElement('div');
        stopwatchItem.textContent = '⏱️ 正计时模式';
        stopwatchItem.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            font-weight: ${timerMode === 'stopwatch' ? 'bold' : 'normal'};
            color: ${timerMode === 'stopwatch' ? '#4CAF50' : 'inherit'};
            text-align: left;
        `;
        stopwatchItem.onmouseenter = () => stopwatchItem.style.backgroundColor = 'var(--b3-theme-surface-light)';
        stopwatchItem.onmouseleave = () => stopwatchItem.style.backgroundColor = '';
        stopwatchItem.onclick = async (e) => { 
            e.stopPropagation(); 
            if (timerMode === 'stopwatch') {
                await startBreakMode(5);
            } else {
                await switchToStopwatchAndStart(); 
            }
            menu.remove(); 
            isContextMenuOpen = false;  // 菜单关闭
        };
        menu.appendChild(stopwatchItem);

        const resetItem = document.createElement('div');
        resetItem.textContent = '重置当前';
        resetItem.style.cssText = `padding: 6px 12px; cursor: pointer; text-align: left;`;
        resetItem.onmouseenter = () => resetItem.style.backgroundColor = 'var(--b3-theme-surface-light)';
        resetItem.onmouseleave = () => resetItem.style.backgroundColor = '';
        resetItem.onclick = async (e) => { 
            e.stopPropagation(); 
            await resetCurrentMode();
            // 🔧 v9.0 修复：移动端重置后，如果要继续计时，需要先关闭菜单再等待用户手动开始
            // 重置会清空时间戳，startTimer() 会创建新的时间戳并同步
            menu.remove(); 
            isContextMenuOpen = false;  // 菜单关闭
        };
        menu.appendChild(resetItem);

        const historyItem = document.createElement('div');
        historyItem.textContent = '查看历史';
        historyItem.style.cssText = `padding: 6px 12px; cursor: pointer; text-align: left;`;
        historyItem.onmouseenter = () => historyItem.style.backgroundColor = 'var(--b3-theme-surface-light)';
        historyItem.onmouseleave = () => historyItem.style.backgroundColor = '';
        historyItem.onclick = async (e) => { 
            e.stopPropagation(); 
            await showHistoryDialog(); 
            menu.remove(); 
            isContextMenuOpen = false;  // 菜单关闭
        };
        menu.appendChild(historyItem);

        document.body.appendChild(menu);

        const { width, height } = menu.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        let posX = x;
        let posY = y;
        if (posX + width > winW - 4) posX = winW - width - 4;
        if (posY + height > winH - 4) posY = y - height;
        posX = Math.max(4, posX);
        posY = Math.max(4, posY);

        menu.style.transform = `translate(${posX}px, ${posY}px)`;
        menu.style.visibility = 'visible';
        setTimeout(() => menu.style.opacity = '1', 10);

        // 清理之前的菜单监听器
        const closeMenu = (e) => {
            // 检查点击是否在菜单内部
            if (menu && !menu.contains(e.target)) {
                // 隐藏并移除菜单
                menu.style.opacity = '0';
                setTimeout(() => {
                    if (menu && menu.parentNode) {
                        menu.remove();
                    }
                    menu = null;
                    isContextMenuOpen = false;  // 菜单关闭
                }, 100);
                // 清理事件监听器
                document.removeEventListener('click', closeMenu, true);
                document.removeEventListener('contextmenu', closeMenu, true);
            }
        };

        // 延迟添加事件监听器
        setTimeout(() => {
            document.addEventListener('click', closeMenu, true);
            document.addEventListener('contextmenu', closeMenu, true);
        }, 50);
    }

	function getWeekStartDate(date) {
		const d = new Date(date);
		const day = d.getDay(); // 0=周日, 1=周一, ..., 6=周六
		
		// 修复：将周日(0)映射为7，统一计算逻辑
		// 这样周一(1)->diff=0, 周二(2)->diff=1, ..., 周日(7)->diff=6
		const normalizedDay = day === 0 ? 7 : day;
		const diff = normalizedDay - 1;
		
		d.setDate(d.getDate() - diff);
		d.setHours(0, 0, 0, 0);
		return d;
	}

    function getWeekEndDate(date) {
        const start = getWeekStartDate(date);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return end;
    }

    function getMonthStartDate(date) {
        const d = new Date(date);
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    function formatMonth(dateStr) {
        const date = new Date(dateStr);
        return `${date.getFullYear()}年${(date.getMonth() + 1).toString().padStart(2, '0')}月`;
    }

    function formatWeek(startDateStr, endDateStr) {
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        return `${formatDate(startDate)}-${formatDate(endDate)}`;
    }


// ✅ v7.0 修复：周统计计算（修复日期键值生成）
function calculateWeeklyStats(dailyStatsArray) {
    if (!dailyStatsArray || dailyStatsArray.length === 0) {
        Logger.warn('周统计：输入数据为空');
        return [];
    }
    
    const weeklyStats = {};
    Logger.info(`📊 开始计算周统计，共 ${dailyStatsArray.length} 天数据`);
    
    dailyStatsArray.forEach((day, index) => {
        const dateStr = day.date;
        const date = new Date(dateStr);
        const weekStart = getWeekStartDate(date);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEnd = getWeekEndDate(date);
        const weekEndStr = weekEnd.toISOString().split('T')[0];
        
        Logger.info(`  处理第${index + 1}天: ${dateStr} -> 周:${weekStartStr}~${weekEndStr}`);
        
        if (!weeklyStats[weekStartStr]) {
            weeklyStats[weekStartStr] = {
                weekStart: weekStartStr,
                weekEnd: weekEndStr,
                displayDate: `${formatDate(weekStart)}-${formatDate(weekEnd)}`,
                tomatoCount: 0,
                tomatoActual: 0,
                tomatoPlanned: 0,
                stopwatchCount: 0,
                stopwatchActual: 0,
                breakCount: 0,
                breakActual: 0,
                focusTime: 0
            };
        }
        
        const targetWeek = weeklyStats[weekStartStr];
        targetWeek.tomatoCount += day.tomatoCount;
        targetWeek.tomatoActual += day.tomatoActual;
        targetWeek.tomatoPlanned += day.tomatoPlanned;
        targetWeek.stopwatchCount += day.stopwatchCount;
        targetWeek.stopwatchActual += day.stopwatchActual;
        targetWeek.breakCount += day.breakCount;
        targetWeek.breakActual += day.breakActual;
        targetWeek.focusTime += day.focusTime;
    });
    
    const result = Object.values(weeklyStats).sort((a, b) => 
        new Date(b.weekStart) - new Date(a.weekStart)
    );
    
    Logger.info(`📊 周统计计算完成，共生成 ${result.length} 周数据`);
    return result;
}

    function calculateMonthlyStats(dailyStatsArray) {
        const monthlyStats = {};
        
        dailyStatsArray.forEach(day => {
            const dateStr = day.date;
            const date = new Date(dateStr);
            const monthStart = getMonthStartDate(date).toISOString().split('T')[0];
            
            if (!monthlyStats[monthStart]) {
                monthlyStats[monthStart] = {
                    monthStart,
                    tomatoCount: 0,
                    tomatoActual: 0,
                    tomatoPlanned: 0,
                    stopwatchCount: 0,
                    stopwatchActual: 0,
                    breakCount: 0,
                    breakActual: 0,
                    focusTime: 0
                };
            }
            
            monthlyStats[monthStart].tomatoCount += day.tomatoCount;
            monthlyStats[monthStart].tomatoActual += day.tomatoActual;
            monthlyStats[monthStart].tomatoPlanned += day.tomatoPlanned;
            monthlyStats[monthStart].stopwatchCount += day.stopwatchCount;
            monthlyStats[monthStart].stopwatchActual += day.stopwatchActual;
            monthlyStats[monthStart].breakCount += day.breakCount;
            monthlyStats[monthStart].breakActual += day.breakActual;
            monthlyStats[monthStart].focusTime += day.focusTime;
        });
        
        return Object.values(monthlyStats).sort((a, b) => b.monthStart.localeCompare(a.monthStart));
    }

    function calculateDailyStats(records) {
        const dailyStatsMap = {};
        
        // 🔧 v9.5 新增：用于去重统计计划时间，同一个 sessionId 只计算一次
        const processedSessions = new Map(); // date -> Set of sessionIds
        
        // 判断是否为筛选模式（通过检查记录是否有 actualFocusMinutes 属性）
        const isFilterMode = records.length > 0 && records[0].hasOwnProperty('actualFocusMinutes');
        
        records.forEach(record => {
            const date = record.date || formatDateKey(record.start);
            if (!dailyStatsMap[date]) {
                dailyStatsMap[date] = {
                    date,
                    tomatoCount: 0,
                    tomatoActual: 0,
                    tomatoPlanned: 0,
                    stopwatchCount: 0,
                    stopwatchActual: 0,
                    breakCount: 0,
                    breakActual: 0,
                    focusTime: 0
                };
                processedSessions.set(date, new Set());
            }
            
            const day = dailyStatsMap[date];
            const dateSessions = processedSessions.get(date);
            
            // 🔧 v9.5 核心修改：同一个 sessionId 的计划时间只计算一次
            // 如果记录有 sessionId，则检查是否已处理过
            // 如果没有 sessionId（兼容旧数据），直接计算
            const sessionId = record.sessionId;
            const plannedDuration = record.plannedDuration || record.durationMin;
            
            if (isFilterMode) {
                // 筛选模式：使用实际专注时长计算
                const actualMinutes = record.actualFocusMinutes || 0;
                if (actualMinutes > 0) {
                    if (record.mode === 'countdown') {
                        day.tomatoCount += 1;
                        day.tomatoActual += actualMinutes;
                        // 🔧 v9.5：去重计算计划时间
                        if (sessionId) {
                            if (!dateSessions.has(sessionId)) {
                                day.tomatoPlanned += plannedDuration;
                                dateSessions.add(sessionId);
                            }
                        } else {
                            // 兼容旧数据：没有 sessionId 时直接计算
                            day.tomatoPlanned += plannedDuration;
                        }
                    } else if (record.mode === 'stopwatch') {
                        day.stopwatchCount += 1;
                        day.stopwatchActual += actualMinutes;
                    } else if (record.mode === 'break' || record.mode === 'stopwatch-break') {
                        day.breakCount += 1;
                        day.breakActual += actualMinutes;
                    }
                }
            } else {
                // 普通模式：使用原始时长
                if (record.mode === 'countdown' && record.durationMin >= 1) {
                    day.tomatoCount += 1;
                    day.tomatoActual += record.durationMin;
                    // 🔧 v9.5：去重计算计划时间
                    if (sessionId) {
                        if (!dateSessions.has(sessionId)) {
                            day.tomatoPlanned += plannedDuration;
                            dateSessions.add(sessionId);
                        }
                    } else {
                        // 兼容旧数据：没有 sessionId 时直接计算
                        day.tomatoPlanned += plannedDuration;
                    }
                } else if (record.mode === 'stopwatch') {
                    day.stopwatchCount += 1;
                    day.stopwatchActual += record.durationMin;
                } else if (record.mode === 'break' || record.mode === 'stopwatch-break') {
                    day.breakCount += 1;
                    day.breakActual += record.durationMin;
                }
            }
        });
        
        Object.values(dailyStatsMap).forEach(day => {
            day.focusTime = day.tomatoActual + day.stopwatchActual;
        });
        
        return Object.values(dailyStatsMap).sort((a, b) => {
            return new Date(b.date) - new Date(a.date);
        });
    }

    function createFocusTimeChart(dailyStatsArray) {
        if (!dailyStatsArray || dailyStatsArray.length === 0) return null;
        
        const recentStats = dailyStatsArray.slice(0, 30).reverse();
        const maxFocusTime = Math.max(...recentStats.map(d => d.focusTime));
        const dailyTarget = userSettings.dailyFocusTargetMinutes || 180;
        const getScaleMaxValue = (rawMax) => {
            if (!rawMax || rawMax <= 0) return 0;
            const absMax = Math.max(0, rawMax);
            let step;
            if (absMax <= 60) step = 15;
            else if (absMax <= 180) step = 30;
            else if (absMax <= 360) step = 60;
            else step = 120;
            return Math.ceil(absMax / step) * step;
        };
        const scaleMaxValue = getScaleMaxValue(Math.max(maxFocusTime, dailyTarget));
        const container = document.createElement('div');
        container.style.cssText = `
            margin: 20px 0;
            padding: 20px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 1px solid var(--b3-theme-surface-light);
        `;
        
        const title = document.createElement('div');
        title.textContent = '📈 近30天专注时长波动';
        title.style.cssText = `
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 16px;
            color: var(--b3-theme-primary);
            text-align: center;
        `;
        container.appendChild(title);
        
        const CHART_HEIGHT = 200;
        const X_AXIS_HEIGHT = 40;
        const CHART_PLOT_HEIGHT = CHART_HEIGHT - X_AXIS_HEIGHT;

        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = `
            display: flex;
            align-items: flex-end;
            height: ${CHART_HEIGHT}px;
            gap: 8px;
            padding: 0 10px;
            border-bottom: 1px solid var(--b3-theme-surface-light);
            position: relative;
        `;
        
        const yAxisOuter = document.createElement('div');
        yAxisOuter.style.cssText = `
            display: flex;
            flex-direction: column;
            height: 100%;
            margin-right: 10px;
            font-size: 11px;
            color: var(--b3-theme-on-surface-light);
        `;

        const yAxis = document.createElement('div');
        yAxis.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: ${CHART_PLOT_HEIGHT}px;
        `;
        
        if (scaleMaxValue > 0) {
            for (let i = 4; i >= 0; i--) {
                const value = Math.round(scaleMaxValue * i / 4);
                const label = document.createElement('div');
                label.textContent = value > 60 ? `${(value / 60).toFixed(1)}h` : `${value}m`;
                label.style.cssText = `text-align: right;`;
                yAxis.appendChild(label);
            }
        }
        const yAxisSpacer = document.createElement('div');
        yAxisSpacer.style.cssText = `height: ${X_AXIS_HEIGHT}px;`;
        yAxisOuter.appendChild(yAxis);
        yAxisOuter.appendChild(yAxisSpacer);
        chartContainer.appendChild(yAxisOuter);

        const plotWrap = document.createElement('div');
        plotWrap.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
            position: relative;
            min-width: 0;
        `;

        const plotArea = document.createElement('div');
        plotArea.style.cssText = `
            height: ${CHART_PLOT_HEIGHT}px;
            display: flex;
            align-items: flex-end;
            gap: 8px;
            position: relative;
        `;

        const xAxis = document.createElement('div');
        xAxis.style.cssText = `
            height: ${X_AXIS_HEIGHT}px;
            display: flex;
            align-items: flex-start;
            gap: 8px;
        `;

        // ========== 添加目标线（绘制在 plotArea 内，确保与柱状图基线一致） ==========
        if (dailyTarget > 0 && scaleMaxValue > 0) {
            const targetPercent = dailyTarget / scaleMaxValue;
            const targetLine = document.createElement('div');
            targetLine.style.cssText = `
                position: absolute;
                left: 0;
                right: 0;
                bottom: ${targetPercent * 100}%;
                height: 1px;
                background: repeating-linear-gradient(
                    90deg,
                    #FF4444,
                    #FF4444 8px,
                    transparent 8px,
                    transparent 16px
                );
                z-index: 100;
                pointer-events: none;
            `;
            plotArea.appendChild(targetLine);
        }

        recentStats.forEach((day) => {
            const barContainer = document.createElement('div');
            barContainer.style.cssText = `
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-end;
                height: 100%;
                position: relative;
                min-width: 0;
            `;

            const barHeight = scaleMaxValue > 0 ? (day.focusTime / scaleMaxValue * CHART_PLOT_HEIGHT) : 0;
            const bar = document.createElement('div');
            bar.style.cssText = `
                width: 20px;
                height: ${barHeight}px;
                background: linear-gradient(to top, var(--b3-theme-primary), #64B5F6);
                border-radius: 3px 3px 0 0;
                transition: height 0.3s ease;
            `;

            const tooltip = document.createElement('div');
            tooltip.style.cssText = `
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.2s;
                pointer-events: none;
                z-index: 101;
            `;
            tooltip.textContent = `${day.date}\n${formatFocusTimeForTable(day.focusTime)}`;

            barContainer.appendChild(tooltip);
            barContainer.appendChild(bar);

            barContainer.onmouseenter = () => {
                tooltip.style.opacity = '1';
                bar.style.transform = 'scaleX(1.2)';
            };
            barContainer.onmouseleave = () => {
                tooltip.style.opacity = '0';
                bar.style.transform = 'scaleX(1)';
            };

            plotArea.appendChild(barContainer);

            const dateLabel = document.createElement('div');
            dateLabel.textContent = new Date(day.date).getDate();
            dateLabel.style.cssText = `
                flex: 1;
                text-align: center;
                font-size: 11px;
                color: var(--b3-theme-on-surface-light);
                white-space: nowrap;
                min-width: 0;
            `;
            xAxis.appendChild(dateLabel);
        });

        plotWrap.appendChild(plotArea);
        plotWrap.appendChild(xAxis);
        chartContainer.appendChild(plotWrap);
        
        container.appendChild(chartContainer);
        
        const legend = document.createElement('div');
        legend.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 10px;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        `;
        
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
        const dateRange = `${thirtyDaysAgo.getFullYear()}/${(thirtyDaysAgo.getMonth() + 1)}/${thirtyDaysAgo.getDate()} - ${today.getFullYear()}/${(today.getMonth() + 1)}/${today.getDate()}`;
        
        const rangeLabel = document.createElement('div');
        rangeLabel.textContent = `日期范围: ${dateRange}`;
        rangeLabel.style.cssText = `font-size: 11px; color: var(--b3-theme-on-surface-light);`;
        legend.appendChild(rangeLabel);
        
        container.appendChild(legend);
        
        return container;
    }

    async function showHistoryDialog(targetPage = 'summary') {
        // 完整清理可能存在的旧对话框，防止DOM残留导致界面变黑
        const oldDialog = document.getElementById('tomy-tomato-history-dialog');
        const oldBackdrop = document.getElementById('tomy-tomato-history-backdrop');
        if (oldDialog) oldDialog.remove();
        if (oldBackdrop) oldBackdrop.remove();
        
        // 清理可能影响主题渲染的残留元素
        document.querySelectorAll('.tomato-task-highlight').forEach(el => {
            el.classList.remove('tomato-task-highlight');
        });
        
        const allRecords = await loadHistoryRecords();
        await loadUserSettings();
        await loadFocusTimeSettings();
        
        // 保存到全局状态，供历史记录显示时使用
        historyState.allRecords = allRecords;
        
        let filteredRecords = allRecords;
        if (!userSettings.showBreakRecords) {
            filteredRecords = allRecords.filter(r => r.mode !== 'break' && r.mode !== 'stopwatch-break');
        }
        
        if (userSettings.hideShortRecords) {
            // 使用 durationSec 确保过滤掉所有小于60秒的记录
            // 注意：durationMin 可能因四舍五入而>=1，所以需要检查 durationSec
            filteredRecords = filteredRecords.filter(r => r.durationSec >= 60);
        }

        const existing = document.getElementById('tomy-tomato-history-dialog');
        if (existing) existing.remove();

        // 检测是否是移动端
        const isMobile = isMobileDevice();

        const backdrop = document.createElement('div');
        backdrop.id = 'tomy-tomato-history-backdrop';
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.3); z-index: 2147483645; pointer-events: auto;
        `;

        const dialog = document.createElement('div');
        dialog.id = 'tomy-tomato-history-dialog';
        // 移动端适配：全屏显示
        if (isMobile) {
            dialog.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: var(--b3-theme-background);
                box-shadow: 0 -4px 20px rgba(0,0,0,0.25); z-index: 2147483646;
                padding: 0; width: 100%; height: 100%;
                display: flex; flex-direction: column; pointer-events: auto;
                color: var(--b3-theme-on-background);
                box-sizing: border-box;
            `;
        } else {
            dialog.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: var(--b3-theme-background); border: 1px solid var(--b3-theme-surface-light);
                border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483646;
                padding: 0; width: 95vw; max-width: 1200px; max-height: 85vh;
                display: flex; flex-direction: column; pointer-events: auto;
                color: var(--b3-theme-on-background);
            `;
        }

        const topBar = document.createElement('div');
        // 移动端适配：更紧凑的布局
        if (isMobile) {
            topBar.style.cssText = `
                padding: 12px 16px 8px 16px;
                border-bottom: 1px solid var(--b3-theme-surface-light);
                background: var(--b3-theme-background);
                z-index: 10;
                flex-shrink: 0;
            `;
        } else {
            topBar.style.cssText = `
                padding: 12px 20px 8px 20px;
                border-bottom: 1px solid var(--b3-theme-surface-light);
                background: var(--b3-theme-background);
                position: sticky;
                top: 0;
                z-index: 10;
            `;
        }

        const titleBar = document.createElement('div');
        titleBar.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; ${isMobile ? 'margin-bottom: 4px;' : ''}`;

        // 移动端适配：添加拖动手柄
        if (isMobile) {
            const dragHandle = document.createElement('div');
            dragHandle.style.cssText = `
                width: 40px; height: 4px; background: var(--b3-theme-surface-light);
                border-radius: 2px; position: absolute; top: 8px; left: 50%;
                transform: translateX(-50%);
            `;
            topBar.appendChild(dragHandle);
        }

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '🗑️ 清除';
        clearBtn.style.cssText = `
            padding: 6px 10px; background: var(--b3-theme-error); color: white;
            border: none; border-radius: 4px; cursor: pointer; font-size: 12px;
            min-width: 60px; font-weight: normal; height: 32px;
        `;
        clearBtn.onclick = async () => {
            if (confirm('确定要清除所有历史记录吗？此操作不可恢复。')) {
                const success = await saveHistoryRecords([]);
                if (success) {
                    showToastDialog('清除成功', '所有历史记录已清除', 'info');
                    dialog.remove();
                    backdrop.remove();
                }
            }
        };
        titleBar.appendChild(clearBtn);

        // 添加音频设置按钮
        const audioSettingsBtn = document.createElement('button');
        audioSettingsBtn.innerHTML = '⚙️ 设置';
        audioSettingsBtn.style.cssText = `
            padding: 6px 10px; background: var(--b3-theme-surface-light); color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-surface); border-radius: 4px; cursor: pointer;
            font-size: 12px; min-width: 60px; font-weight: normal; height: 32px; margin-right: 8px;
        `;
        audioSettingsBtn.onclick = () => {
            showSettingsDialog();
        };
        titleBar.appendChild(audioSettingsBtn);

        const title = document.createElement('div');
        title.textContent = `🍅 番茄钟历史记录（最近1年）`;
        // 移动端适配：更小的字体
        if (isMobile) {
            title.style.cssText = `
                font-weight: bold; font-size: 14px; color: var(--b3-theme-primary);
                text-align: center; flex: 1; margin: 0 8px;
            `;
        } else {
            title.style.cssText = `
                font-weight: bold; font-size: 16px; color: var(--b3-theme-primary);
                text-align: center; flex: 1; margin: 0 10px;
            `;
        }
        titleBar.appendChild(title);

        // 🔧 新增：窗口外点击关闭功能（必须在 closeBtn.onclick 使用前定义）
        const closeHistoryDialog = () => {
            // 完整清理对话框和遮罩
            dialog.remove();
            backdrop.remove();
            // 确保清理彻底
            document.getElementById('tomy-tomato-history-backdrop')?.remove();
            document.getElementById('tomy-tomato-history-dialog')?.remove();
            // 清理可能的高亮残留
            document.querySelectorAll('.tomato-task-highlight').forEach(el => {
                el.classList.remove('tomato-task-highlight');
            });
        };

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = `
            padding: 6px 12px; background: var(--b3-theme-surface-light); color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-surface); border-radius: 4px; cursor: pointer;
            font-size: 12px; min-width: 60px; font-weight: normal; height: 32px;
        `;
        closeBtn.onclick = closeHistoryDialog;
        titleBar.appendChild(closeBtn);

        topBar.appendChild(titleBar);

        const dates = {};
        filteredRecords.forEach(record => {
            const date = record.date || formatDateKey(record.start);
            dates[date] = true;
        });
        const dateList = Object.keys(dates).sort((a, b) => 
            new Date(b) - new Date(a)
        );

        historyState = {
            currentPage: 'summary',
            dateList: dateList,
            filteredRecords: filteredRecords,
            allRecords: allRecords
        };

        const pageButtons = document.createElement('div');
        pageButtons.id = 'tomy-tomato-page-buttons';
        pageButtons.style.cssText = `display: flex; gap: 6px; justify-content: center; margin-bottom: 4px; flex-wrap: wrap; ${isMobile ? 'margin-top: 4px;' : ''}`;

        topBar.appendChild(pageButtons);

        const contentArea = document.createElement('div');
        contentArea.id = 'tomy-tomato-history-content';
        // 移动端适配：占满剩余空间
        if (isMobile) {
            contentArea.style.cssText = `
                padding: 16px; overflow-y: auto; flex: 1;
                font-size: 14px; position: relative;
            `;
        } else {
            contentArea.style.cssText = `
                padding: 16px; overflow-y: auto; flex: 1; max-height: calc(85vh - 116px);
                font-size: 13px; position: relative;
            `;
        }

        dialog.appendChild(topBar);
        dialog.appendChild(contentArea);
        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);

        // 监听背景遮罩点击事件，点击时关闭对话框
        EventManager.add(backdrop, 'click', (e) => {
            // 确保点击的是背景遮罩，而不是对话框内部
            if (e.target === backdrop) {
                closeHistoryDialog();
            }
        }, true, 'history-dialog-backdrop');

        // 绑定任务链接点击事件
        setupTaskLinkListeners(dialog);

        updatePageButtons();
        showPage(targetPage);

        contentArea.focus();
    }

    function updatePageButtons() {
        const pageButtons = document.getElementById('tomy-tomato-page-buttons');
        if (!pageButtons) return;

        pageButtons.innerHTML = '';
        
        const { dateList, currentPage } = historyState;

        const summaryBtn = createPageButton('📊 统计', 'summary', currentPage === 'summary');
        pageButtons.appendChild(summaryBtn);

        const today = formatDateKey(new Date());
        if (dateList.includes(today)) {
            const todayBtn = createPageButton('📅 今天', 'today', currentPage === 'today');
            pageButtons.appendChild(todayBtn);
        }

        const yesterday = formatDateKey(new Date(Date.now() - 86400000));
        if (dateList.includes(yesterday)) {
            const yesterdayBtn = createPageButton('📅 昨天', 'yesterday', currentPage === 'yesterday');
            pageButtons.appendChild(yesterdayBtn);
        }

        const dayBeforeYesterday = formatDateKey(new Date(Date.now() - 172800000));
        if (dateList.includes(dayBeforeYesterday)) {
            const dayBeforeBtn = createPageButton('📅 前天', 'day-before-yesterday', currentPage === 'day-before-yesterday');
            pageButtons.appendChild(dayBeforeBtn);
        }

        if (dateList.length > 0) {
            // 日历类型日期选择器
            const dateInputContainer = document.createElement('div');
            dateInputContainer.style.cssText = `
                position: relative; display: flex; align-items: center; min-width: 100px;
            `;
            
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.style.cssText = `
                padding: 3px 6px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px;
                background: var(--b3-theme-background); color: var(--b3-theme-on-background);
                font-size: 12px; cursor: pointer; width: 100%; min-width: 115px;
                letter-spacing: 0.5px;
            `;
            
            // 如果当前显示的是某个日期，设置输入框的值
            if (historyState.currentPage && historyState.currentPage.match(/^\d{4}-\d{2}-\d{2}$/)) {
                dateInput.value = historyState.currentPage;
            }
            
            // 限制日期范围（只在有数据的日期范围内）
            const sortedDates = dateList.sort((a, b) => new Date(a) - new Date(b));
            if (sortedDates.length > 0) {
                dateInput.min = sortedDates[0];
                dateInput.max = sortedDates[sortedDates.length - 1];
            }
            
            dateInput.onchange = () => {
                const selectedDate = dateInput.value;
                if (selectedDate && dateList.includes(selectedDate)) {
                    showPage(selectedDate);
                } else {
                    // 如果选择的日期没有数据，恢复到当前显示的日期
                    if (historyState.currentPage && historyState.currentPage.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        dateInput.value = historyState.currentPage;
                    } else {
                        dateInput.value = '';
                    }
                    if (selectedDate && !dateList.includes(selectedDate)) {
                        showToastDialog('提示', `该日期 (${selectedDate}) 没有番茄钟记录`, 'info');
                    }
                }
            };
            
            // 当用户聚焦时显示日历，模糊时检查是否需要显示提示
            dateInput.onfocus = () => {
                // 正常显示日历
            };
            
            dateInputContainer.appendChild(dateInput);
            pageButtons.appendChild(dateInputContainer);
        }
    }

    function createPageButton(text, pageId, isActive) {
        const button = document.createElement('button');
        button.textContent = text;
        button.dataset.page = pageId;
        button.style.cssText = `
            padding: 6px 10px;
            background: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-surface)'};
            color: ${isActive ? 'white' : 'var(--b3-theme-on-background)'};
            border: 1px solid ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-surface-light)'};
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            min-width: 70px;
            font-weight: ${isActive ? 'bold' : 'normal'};
            box-shadow: ${isActive ? '0 1px 3px rgba(0,0,0,0.2)' : 'none'};
            transition: all 0.2s;
        `;
        
        button.onmouseenter = () => {
            if (!isActive) {
                button.style.background = 'var(--b3-theme-surface-light)';
                button.style.transform = 'translateY(-1px)';
            }
        };
        button.onmouseleave = () => {
            if (!isActive) {
                button.style.background = 'var(--b3-theme-surface)';
                button.style.transform = 'translateY(0)';
            }
        };
        
        button.onclick = () => {
            showPage(pageId);
        };
        
        return button;
    }

    function showPage(pageId) {
        historyState.currentPage = pageId;
        
        const contentArea = document.getElementById('tomy-tomato-history-content');
        if (!contentArea) return;
        
        updatePageButtons();
        contentArea.innerHTML = '';

        const contentWrapper = document.createElement('div');
        contentWrapper.style.cssText = `position: relative; z-index: 1;`;
        
        if (pageId === 'summary') {
            showSummaryPage(contentWrapper);
        } else {
            let targetDate;
            if (pageId === 'today') {
                targetDate = formatDateKey(new Date());
            } else if (pageId === 'yesterday') {
                targetDate = formatDateKey(new Date(Date.now() - 86400000));
            } else if (pageId === 'day-before-yesterday') {
                targetDate = formatDateKey(new Date(Date.now() - 172800000));
            } else {
                targetDate = pageId;
            }
            
            const pageIndex = historyState.dateList.indexOf(targetDate);
            showDayPage(contentWrapper, targetDate, pageIndex + 1);
        }
        
        contentArea.appendChild(contentWrapper);
    }

    function navigateToPage(direction) {
        const { currentPage, dateList } = historyState;
        let nextPageId = currentPage;
        
        if (currentPage === 'summary') {
            if (direction === 1 && dateList.length > 0) {
                nextPageId = dateList[0];
            }
        } else {
            const currentIndex = dateList.indexOf(currentPage);
            if (currentIndex !== -1) {
                const nextIndex = currentIndex + direction;
                if (nextIndex >= 0 && nextIndex < dateList.length) {
                    nextPageId = dateList[nextIndex];
                } else if (nextIndex < 0) {
                    nextPageId = 'summary';
                }
            } else {
                const specialPages = ['today', 'yesterday', 'day-before-yesterday'];
                const currentIndex = specialPages.indexOf(currentPage);
                
                if (currentIndex !== -1) {
                    if (direction === 1) {
                        if (currentIndex < specialPages.length - 1) {
                            nextPageId = specialPages[currentIndex + 1];
                        } else if (dateList.length > 0) {
                            const today = formatDateKey(new Date());
                            const yesterday = formatDateKey(new Date(Date.now() - 86400000));
                            const dayBefore = formatDateKey(new Date(Date.now() - 172800000));
                            
                            for (let date of dateList) {
                                if (date !== today && date !== yesterday && date !== dayBefore) {
                                    nextPageId = date;
                                    break;
                                }
                            }
                        }
                    } else {
                        nextPageId = 'summary';
                    }
                }
            }
        }
        
        if (nextPageId !== currentPage) {
            showPage(nextPageId);
        }
    }

    function showSummaryPage(container) {
        const { filteredRecords, allRecords, dateList } = historyState;
        
        const headerContainer = document.createElement('div');
        headerContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        `;
        
        const prevButton = document.createElement('button');
        prevButton.id = 'tomy-tomato-prev-page-summary';
        prevButton.innerHTML = '◀';
        prevButton.style.cssText = `
            width: 30px; height: 30px; border-radius: 50%; background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background); border: 1px solid var(--b3-theme-surface-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 16px; opacity: 0.8; transition: all 0.2s; flex-shrink: 0;
        `;
        prevButton.onmouseenter = () => {
            prevButton.style.opacity = '1';
            prevButton.style.background = 'var(--b3-theme-surface-light)';
        };
        prevButton.onmouseleave = () => {
            prevButton.style.opacity = '0.8';
            prevButton.style.background = 'var(--b3-theme-surface)';
        };
        prevButton.onclick = () => navigateToPage(-1);
        
        const configContainer = document.createElement('div');
        configContainer.style.cssText = `
            display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
            align-items: center; flex: 1; margin: 0 10px;
        `;
        
        const showBreakLabel = document.createElement('label');
        showBreakLabel.style.cssText = `
            display: flex; align-items: center; gap: 6px; cursor: pointer;
            font-size: 12px; white-space: nowrap;
        `;
        const showBreakCheckbox = document.createElement('input');
        showBreakCheckbox.type = 'checkbox';
        showBreakCheckbox.checked = userSettings.showBreakRecords;
        showBreakCheckbox.onchange = async () => {
            userSettings.showBreakRecords = showBreakCheckbox.checked;
            await saveUserSettings();
            const dialog = document.getElementById('tomy-tomato-history-dialog');
            const backdrop = document.getElementById('tomy-tomato-history-backdrop');
            if (dialog) dialog.remove();
            if (backdrop) backdrop.remove();
            showHistoryDialog();
        };
        showBreakLabel.appendChild(showBreakCheckbox);
        showBreakLabel.appendChild(document.createTextNode('显示休息记录'));
        configContainer.appendChild(showBreakLabel);
        
        const groupLabel = document.createElement('label');
        groupLabel.style.cssText = `
            display: flex; align-items: center; gap: 6px; cursor: pointer;
            font-size: 12px; white-space: nowrap;
        `;
        const groupCheckbox = document.createElement('input');
        groupCheckbox.type = 'checkbox';
        groupCheckbox.checked = userSettings.groupByTimePeriod;
        groupCheckbox.onchange = async () => {
            userSettings.groupByTimePeriod = groupCheckbox.checked;
            await saveUserSettings();
            const dialog = document.getElementById('tomy-tomato-history-dialog');
            const backdrop = document.getElementById('tomy-tomato-history-backdrop');
            if (dialog) dialog.remove();
            if (backdrop) backdrop.remove();
            showHistoryDialog();
        };
        groupLabel.appendChild(groupCheckbox);
        groupLabel.appendChild(document.createTextNode('按时间段分组'));
        configContainer.appendChild(groupLabel);
        
        // 删除无需确认设置
        const deleteConfirmLabel = document.createElement('label');
        deleteConfirmLabel.style.cssText = `
            display: flex; align-items: center; gap: 6px; cursor: pointer;
            font-size: 12px; white-space: nowrap;
        `;
        const deleteConfirmCheckbox = document.createElement('input');
        deleteConfirmCheckbox.type = 'checkbox';
        deleteConfirmCheckbox.checked = userSettings.deleteWithoutConfirm;
        deleteConfirmCheckbox.onchange = async () => {
            userSettings.deleteWithoutConfirm = deleteConfirmCheckbox.checked;
            await saveUserSettings();
        };
        deleteConfirmLabel.appendChild(deleteConfirmCheckbox);
        deleteConfirmLabel.appendChild(document.createTextNode('删除无需确认'));
        deleteConfirmLabel.title = '删除历史记录时无需二次确认';
        configContainer.appendChild(deleteConfirmLabel);
        
        const hideShortLabel = document.createElement('label');
        hideShortLabel.style.cssText = `
            display: flex; align-items: center; gap: 6px; cursor: pointer;
            font-size: 12px; white-space: nowrap;
        `;
        const hideShortCheckbox = document.createElement('input');
        hideShortCheckbox.type = 'checkbox';
        hideShortCheckbox.checked = userSettings.hideShortRecords;
        hideShortCheckbox.onchange = async () => {
            userSettings.hideShortRecords = hideShortCheckbox.checked;
            await saveUserSettings();
            const dialog = document.getElementById('tomy-tomato-history-dialog');
            const backdrop = document.getElementById('tomy-tomato-history-backdrop');
            if (dialog) dialog.remove();
            if (backdrop) backdrop.remove();
            showHistoryDialog();
        };
        hideShortLabel.appendChild(hideShortCheckbox);
        hideShortLabel.appendChild(document.createTextNode('不记录1分钟以下计时'));
        configContainer.appendChild(hideShortLabel);
        
        const nextButton = document.createElement('button');
        nextButton.id = 'tomy-tomato-next-page-summary';
        nextButton.innerHTML = '▶';
        nextButton.style.cssText = `
            width: 30px; height: 30px; border-radius: 50%; background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background); border: 1px solid var(--b3-theme-surface-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 16px; opacity: 0.8; transition: all 0.2s; flex-shrink: 0;
        `;
        nextButton.onmouseenter = () => {
            nextButton.style.opacity = '1';
            nextButton.style.background = 'var(--b3-theme-surface-light)';
        };
        nextButton.onmouseleave = () => {
            nextButton.style.opacity = '0.8';
            nextButton.style.background = 'var(--b3-theme-surface)';
        };
        nextButton.onclick = () => navigateToPage(1);
        
        headerContainer.appendChild(prevButton);
        headerContainer.appendChild(configContainer);
        headerContainer.appendChild(nextButton);
        container.appendChild(headerContainer);

        if (filteredRecords.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '暂无计时记录，开始你的第一个番茄吧！';
            empty.style.textAlign = 'center';
            empty.style.opacity = '0.6';
            empty.style.padding = '40px 0';
            container.appendChild(empty);
            updateSummaryPageNavButtons();
            return;
        }

        // 创建过滤器
        const filterContainer = createTimeRangeFilter();
        container.appendChild(filterContainer);
        
        // ✅ v7.0 修复：确保先创建过滤器，再进行数据处理和渲染
        let currentRecords = filteredRecords;
        let dailyStatsArray = calculateDailyStats(filteredRecords);
        
        const enabledFocusGroups = Array.isArray(focusTimeSettings?.groups) ? focusTimeSettings.groups.filter(g => g?.enabled) : [];
        if (statsState.currentFilter === 'group' && statsState.currentGroupId && enabledFocusGroups.length > 0) {
            // 修复：检查 groupId 是否存在
            const groupExists = enabledFocusGroups.some(g => g.id === statsState.currentGroupId);
            if (groupExists) {
                const focusRecords = filterRecordsByFocusTime(filteredRecords, statsState.currentGroupId);
                currentRecords = focusRecords;
                dailyStatsArray = calculateDailyStats(focusRecords);
            } else {
                // 修复：如果groupId不存在，重置为全部时间
                Logger.warn(`GroupId ${statsState.currentGroupId} 不存在，重置为全部时间`);
                statsState.currentFilter = 'all';
                statsState.currentGroupId = null;
            }
        }
        
        // ✅ v7.0 修复：始终显示过滤器，即使无数据
        if (dailyStatsArray && dailyStatsArray.length > 0) {
            const chart = createFocusTimeChart(dailyStatsArray);
            if (chart) {
                container.appendChild(chart);
            }
            
            const monthlyTable = createMonthlyStatsTable(dailyStatsArray);
            if (monthlyTable) {
                container.appendChild(monthlyTable);
            }
            
            const weeklyTable = createWeeklyStatsTable(dailyStatsArray);
            if (weeklyTable) {
                container.appendChild(weeklyTable);
            }
            
            const dailyTable = createDailyStatsTable(dailyStatsArray);
            if (dailyTable) {
                container.appendChild(dailyTable);
            }
        } else if (statsState.currentFilter === 'group') {
            // 修复：专注时间组无数据时，显示提示但保留过滤器
            const noDataMsg = document.createElement('div');
            noDataMsg.style.cssText = `
                padding: 40px;
                background: var(--b3-theme-surface);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-surface-light);
                text-align: center;
                margin: 20px 0;
                color: var(--b3-theme-on-surface-light);
            `;
            noDataMsg.innerHTML = `
                <p>📊 <strong>当前专注时间组内暂无记录</strong></p>
                <p style="font-size: 14px; margin-top: 8px;">请选择"全部时间"查看所有记录</p>
            `;
            container.appendChild(noDataMsg);
        }
        
        updateSummaryPageNavButtons();
    }

    function createTimeRangeFilter() {
        const filterContainer = document.createElement('div');
        filterContainer.style.cssText = `
            margin-bottom: 16px;
            padding: 12px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 1px solid var(--b3-theme-surface-light);
        `;
        
        const filterLabel = document.createElement('div');
        filterLabel.textContent = '时间范围筛选：';
        filterLabel.style.cssText = `font-weight: bold; margin-bottom: 8px; color: var(--b3-theme-on-background);`;
        filterContainer.appendChild(filterLabel);
        
        const filterSelectContainer = document.createElement('div');
        filterSelectContainer.style.cssText = `display: flex; align-items: center; gap: 8px;`;
        
        const filterSelect = document.createElement('select');
        filterSelect.id = 'tomy-tomato-time-filter';
        filterSelect.style.cssText = `
            padding: 6px 12px; border: 1px solid var(--b3-theme-surface-light); border-radius: 4px;
            background: var(--b3-theme-background); color: var(--b3-theme-on-background);
            font-size: 13px; cursor: pointer; flex: 1;
        `;
        
        const allTimeOption = document.createElement('option');
        allTimeOption.value = 'all';
        allTimeOption.textContent = '⏰ 全部时间';
        allTimeOption.selected = statsState.currentFilter === 'all';
        filterSelect.appendChild(allTimeOption);
        
        const enabledFocusGroups = Array.isArray(focusTimeSettings?.groups) ? focusTimeSettings.groups.filter(g => g?.enabled) : [];
        if (enabledFocusGroups.length > 0) {
            enabledFocusGroups.forEach(group => {
                const groupOption = document.createElement('option');
                groupOption.value = group.id;
                groupOption.textContent = `🎯 ${group.name}`;
                groupOption.selected = statsState.currentGroupId === group.id;
                filterSelect.appendChild(groupOption);
            });
        } else {
            const noGroupOption = document.createElement('option');
            noGroupOption.value = '';
            noGroupOption.textContent = '⚠️ 暂无专注时间组';
            noGroupOption.disabled = true;
            filterSelect.appendChild(noGroupOption);
        }
        
        filterSelect.onchange = () => {
            const selectedValue = filterSelect.value;
            if (selectedValue === 'all') {
                statsState.currentFilter = 'all';
                statsState.currentGroupId = null;
            } else if (selectedValue) {
                statsState.currentFilter = 'group';
                statsState.currentGroupId = selectedValue;
            }
            
            // 修复：重新渲染统计页面
            const contentArea = document.getElementById('tomy-tomato-history-content');
            if (contentArea) {
                contentArea.innerHTML = '';
                const contentWrapper = document.createElement('div');
                contentWrapper.style.cssText = `position: relative; z-index: 1;`;
                showSummaryPage(contentWrapper);
                contentArea.appendChild(contentWrapper);
            }
        };
        
        filterSelectContainer.appendChild(filterSelect);
        
        const focusSettingsBtn = document.createElement('button');
        focusSettingsBtn.textContent = '⚙️ 时间范围设置';
        focusSettingsBtn.style.cssText = `
            padding: 6px 12px; background: var(--b3-theme-surface); color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; cursor: pointer;
            font-size: 12px; white-space: nowrap;
        `;
        focusSettingsBtn.onclick = async () => {
            await showFocusTimeSettingsDialog();
        };
        filterSelectContainer.appendChild(focusSettingsBtn);
        
        filterContainer.appendChild(filterSelectContainer);
        
        // ========== 专注目标时间设定 ==========
        const targetContainer = document.createElement('div');
        targetContainer.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px dashed var(--b3-theme-surface-light);
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        const targetLabel = document.createElement('label');
        targetLabel.textContent = '🎯专注目标：';
        targetLabel.style.cssText = `
            font-weight: bold;
            color: var(--b3-theme-on-background);
            white-space: nowrap;
            font-size: 13px;
        `;
        targetContainer.appendChild(targetLabel);
        
        // 输入框容器
        const inputWrapper = document.createElement('div');
        inputWrapper.style.cssText = `
            display: flex;
            align-items: center;
            flex: 1;
        `;
        
        const targetInput = document.createElement('input');
        targetInput.type = 'number';
        targetInput.min = '0.5';
        targetInput.max = '24';
        targetInput.step = '0.5';
        const currentHours = (userSettings.dailyFocusTargetMinutes || 180) / 60;
        targetInput.value = currentHours % 1 === 0 ? currentHours : currentHours.toFixed(1);
        targetInput.style.cssText = `
            flex: 1;
            padding: 6px 10px;
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 4px 0 0 4px;
            background: var(--b3-theme-background);
            color: var(--b3-theme-on-background);
            font-size: 13px;
            outline: none;
        `;
        targetInput.title = '输入小时数，支持小数如 4.5';
        
        const targetUnit = document.createElement('span');
        targetUnit.textContent = '小时';
        targetUnit.style.cssText = `
            padding: 6px 10px;
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background);
            border: 1px solid var(--b3-theme-surface-light);
            border-left: none;
            border-radius: 0 4px 4px 0;
            font-size: 13px;
        `;
        
        // 实时验证输入
        targetInput.oninput = () => {
            const value = parseFloat(targetInput.value);
            if (isNaN(value) || value <= 0) {
                targetInput.style.borderColor = '#F44336';
            } else {
                targetInput.style.borderColor = '#4CAF50';
            }
        };
        
        // 失焦时保存
        targetInput.onblur = async () => {
            const value = parseFloat(targetInput.value);
            
            if (!isNaN(value) && value > 0) {
                const minutes = Math.round(value * 60);
                userSettings.dailyFocusTargetMinutes = Math.max(1, Math.min(1440, minutes));
                await saveUserSettings();
                
                // 更新显示值
                const newHours = userSettings.dailyFocusTargetMinutes / 60;
                targetInput.value = newHours % 1 === 0 ? newHours : newHours.toFixed(1);
                targetInput.style.borderColor = 'var(--b3-theme-surface-light)';
                
                // 刷新图表显示
                const contentArea = document.getElementById('tomy-tomato-history-content');
                if (contentArea) {
                    contentArea.innerHTML = '';
                    const contentWrapper = document.createElement('div');
                    contentWrapper.style.cssText = `position: relative; z-index: 1;`;
                    showSummaryPage(contentWrapper);
                    contentArea.appendChild(contentWrapper);
                }
            } else {
                // 恢复原值
                const hours = (userSettings.dailyFocusTargetMinutes || 180) / 60;
                targetInput.value = hours % 1 === 0 ? hours : hours.toFixed(1);
                targetInput.style.borderColor = 'var(--b3-theme-surface-light)';
            }
        };
        
        // 回车键保存
        targetInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                targetInput.blur();
            }
        };
        
        inputWrapper.appendChild(targetInput);
        inputWrapper.appendChild(targetUnit);
        targetContainer.appendChild(inputWrapper);

        const timelineBtn = document.createElement('button');
        timelineBtn.innerHTML = '📅 时间轴设置';
        timelineBtn.title = '配置底部全天时间轴模式';
        timelineBtn.style.cssText = `
            margin-left: 8px;
            padding: 6px 12px;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 4px;
            color: var(--b3-theme-on-surface);
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
        `;
        timelineBtn.onmouseenter = () => timelineBtn.style.background = 'var(--b3-theme-surface-light)';
        timelineBtn.onmouseleave = () => timelineBtn.style.background = 'var(--b3-theme-surface)';
        timelineBtn.onclick = () => showTimelineSettingsDialog();
        targetContainer.appendChild(timelineBtn);
        
        filterContainer.appendChild(targetContainer);
        
        return filterContainer;
    }

    function createMonthlyStatsTable(dailyStatsArray) {
        if (!dailyStatsArray || dailyStatsArray.length === 0) return null;
        
        const monthlyStats = calculateMonthlyStats(dailyStatsArray);
        
        const container = document.createElement('div');
        container.style.cssText = `
            margin-top: 20px;
            padding: 16px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 2px solid var(--b3-theme-surface-light);
        `;

        // 标题区域（包含折叠按钮）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 12px;
            gap: 8px;
        `;

        const title = document.createElement('div');
        title.textContent = '📅 月统计';
        title.style.cssText = `
            font-weight: bold;
            font-size: 16px;
            color: var(--b3-theme-primary);
            text-align: center;
        `;
        titleRow.appendChild(title);

        // 折叠按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '▼';
        toggleBtn.title = '折叠/展开';
        toggleBtn.style.cssText = `
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            padding: 4px 6px;
            border-radius: 3px;
            transition: all 0.2s;
        `;
        toggleBtn.onmouseenter = () => {
            toggleBtn.style.backgroundColor = 'var(--b3-theme-surface-light)';
        };
        toggleBtn.onmouseleave = () => {
            toggleBtn.style.backgroundColor = 'transparent';
        };

        // 内容区域
        const content = document.createElement('div');

        toggleBtn.onclick = () => {
            if (content.style.display === 'none') {
                content.style.display = '';
                toggleBtn.innerHTML = '▼';
            } else {
                content.style.display = 'none';
                toggleBtn.innerHTML = '◀';
            }
        };

        titleRow.appendChild(toggleBtn);
        container.appendChild(titleRow);

        if (monthlyStats.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '暂无月统计数据';
            empty.style.textAlign = 'center';
            empty.style.opacity = '0.6';
            empty.style.padding = '20px 0';
            content.appendChild(empty);
        } else {
            const monthlyTable = document.createElement('div');
            monthlyTable.style.cssText = `
                font-size: 12px;
                margin-bottom: 10px;
                overflow-x: auto;
                max-height: 350px;
                overflow-y: auto;
            `;
            
            let tableHTML = `
                <div style="display: grid; grid-template-columns: 80px repeat(8, 1fr); gap: 5px; margin-bottom: 5px; padding: 8px; background: var(--b3-theme-surface-light); border-radius: 5px; min-width: 800px; font-weight: bold; position: sticky; top: 0; z-index: 1;">
                    <div style="text-align: left;">月份</div>
                    <div style="text-align: center;">🍅 数量</div>
                    <div style="text-align: center;">🍅 实际</div>
                    <div style="text-align: center;">🍅 计划</div>
                    <div style="text-align: center;">⏱️ 数量</div>
                    <div style="text-align: center;">⏱️ 时长</div>
                    <div style="text-align: center;">☕ 时长</div>
                    <div style="text-align: center;">🎯 专注</div>
                    <div style="text-align: center;">📊 完成度</div>
                </div>
            `;
            
            monthlyStats.forEach((month, index) => {
                const bgColor = index % 2 === 0 ? 'var(--b3-theme-background)' : 'var(--b3-theme-surface-light)';
                const completionRate = month.tomatoPlanned > 0 ? Math.round((month.tomatoActual / month.tomatoPlanned) * 100) : 0;
                const actualColor = completionRate >= 100 ? '#4CAF50' : (completionRate >= 80 ? '#FF9800' : '#F44336');
                const focusColor = month.focusTime >= 1200 ? '#4CAF50' : (month.focusTime >= 600 ? '#FF9800' : '#F44336');
                
                tableHTML += `
                    <div style="display: grid; grid-template-columns: 80px repeat(8, 1fr); gap: 5px; padding: 8px; background: ${bgColor}; border-bottom: 1px solid var(--b3-theme-surface-light); min-width: 800px;">
                        <div style="text-align: left; font-weight: bold;">${formatMonth(month.monthStart)}</div>
                        <div style="text-align: center;">${month.tomatoCount}</div>
                        <div style="text-align: center; color: ${actualColor};">${month.tomatoActual}分</div>
                        <div style="text-align: center;">${month.tomatoPlanned}分</div>
                        <div style="text-align: center;">${month.stopwatchCount}</div>
                        <div style="text-align: center;">${month.stopwatchActual}分</div>
                        <div style="text-align: center;">${month.breakActual}分</div>
                        <div style="text-align: center; color: ${focusColor}; font-weight: bold;">${formatFocusTimeForTable(month.focusTime)}</div>
                        <div style="text-align: center; color: ${actualColor}; font-weight: bold;">${completionRate}%</div>
                    </div>
                `;
            });
            
            monthlyTable.innerHTML = tableHTML;
            content.appendChild(monthlyTable);
        }

        container.appendChild(content);
        
        return container;
    }

    function createWeeklyStatsTable(dailyStatsArray) {
        if (!dailyStatsArray || dailyStatsArray.length === 0) return null;
        
        const weeklyStats = calculateWeeklyStats(dailyStatsArray);
        
        const container = document.createElement('div');
        container.style.cssText = `
            margin-top: 20px;
            padding: 16px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 2px solid var(--b3-theme-surface-light);
        `;

        // 标题区域（包含折叠按钮）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 12px;
            gap: 8px;
        `;

        const title = document.createElement('div');
        title.textContent = '📅 周统计（周一到周日）';
        title.style.cssText = `
            font-weight: bold;
            font-size: 16px;
            color: var(--b3-theme-primary);
            text-align: center;
        `;
        titleRow.appendChild(title);

        // 折叠按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '▼';
        toggleBtn.title = '折叠/展开';
        toggleBtn.style.cssText = `
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            padding: 4px 6px;
            border-radius: 3px;
            transition: all 0.2s;
        `;
        toggleBtn.onmouseenter = () => {
            toggleBtn.style.backgroundColor = 'var(--b3-theme-surface-light)';
        };
        toggleBtn.onmouseleave = () => {
            toggleBtn.style.backgroundColor = 'transparent';
        };

        // 内容区域
        const content = document.createElement('div');

        toggleBtn.onclick = () => {
            if (content.style.display === 'none') {
                content.style.display = '';
                toggleBtn.innerHTML = '▼';
            } else {
                content.style.display = 'none';
                toggleBtn.innerHTML = '◀';
            }
        };

        titleRow.appendChild(toggleBtn);
        container.appendChild(titleRow);

        if (weeklyStats.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '暂无周统计数据';
            empty.style.textAlign = 'center';
            empty.style.opacity = '0.6';
            empty.style.padding = '20px 0';
            content.appendChild(empty);
        } else {
            const weeklyTable = document.createElement('div');
            weeklyTable.style.cssText = `
                font-size: 12px;
                margin-bottom: 10px;
            `;
            
            // 分页设置
            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(weeklyStats.length / ITEMS_PER_PAGE);
            let currentPage = 1;
            
            // 分页控件容器
            const paginationContainer = document.createElement('div');
            paginationContainer.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                margin-bottom: 10px;
                padding: 8px;
                background: var(--b3-theme-surface-light);
                border-radius: 5px;
            `;
            
            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '◀';
            prevBtn.style.cssText = `
                padding: 4px 10px;
                background: var(--b3-theme-primary);
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
            `;
            prevBtn.disabled = currentPage <= 1;
            
            const pageInfo = document.createElement('span');
            pageInfo.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
            `;
            
            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '▶';
            nextBtn.style.cssText = `
                padding: 4px 10px;
                background: var(--b3-theme-primary);
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
            `;
            nextBtn.disabled = currentPage >= totalPages;
            
            paginationContainer.appendChild(prevBtn);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextBtn);
            weeklyTable.appendChild(paginationContainer);
            
            // 表格容器
            const tableContainer = document.createElement('div');
            tableContainer.style.cssText = `
                max-height: none;
                overflow-y: visible;
                overflow-x: auto;
            `;
            
            const renderPage = () => {
                const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
                const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, weeklyStats.length);
                const pageData = weeklyStats.slice(startIdx, endIdx);
                
                // 每次都重新生成表头，避免翻页时累积旧数据
                let currentTableHTML = `
                    <div style="display: grid; grid-template-columns: 120px repeat(8, 1fr); gap: 5px; margin-bottom: 5px; padding: 8px; background: var(--b3-theme-surface-light); border-radius: 5px; min-width: 800px; font-weight: bold; position: sticky; top: 0; z-index: 1;">
                        <div style="text-align: left;">周次</div>
                        <div style="text-align: center;">🍅 数量</div>
                        <div style="text-align: center;">🍅 实际</div>
                        <div style="text-align: center;">🍅 计划</div>
                        <div style="text-align: center;">⏱️ 数量</div>
                        <div style="text-align: center;">⏱️ 时长</div>
                        <div style="text-align: center;">☕ 时长</div>
                        <div style="text-align: center;">🎯 专注</div>
                        <div style="text-align: center;">📊 完成度</div>
                    </div>
                `;
                
                pageData.forEach((week, idx) => {
                    const realIndex = startIdx + idx;
                    const bgColor = realIndex % 2 === 0 ? 'var(--b3-theme-background)' : 'var(--b3-theme-surface-light)';
                    const completionRate = week.tomatoPlanned > 0 ? Math.round((week.tomatoActual / week.tomatoPlanned) * 100) : 0;
                    const actualColor = completionRate >= 100 ? '#4CAF50' : (completionRate >= 80 ? '#FF9800' : '#F44336');
                    const focusColor = week.focusTime >= 300 ? '#4CAF50' : (week.focusTime >= 150 ? '#FF9800' : '#F44336');
                    
                    currentTableHTML += `
                        <div style="display: grid; grid-template-columns: 120px repeat(8, 1fr); gap: 5px; padding: 8px; background: ${bgColor}; border-bottom: 1px solid var(--b3-theme-surface-light); min-width: 800px;">
                            <div style="text-align: left; font-weight: bold;">${week.displayDate || formatWeek(week.weekStart, week.weekEnd)}</div>
                            <div style="text-align: center;">${week.tomatoCount}</div>
                            <div style="text-align: center; color: ${actualColor};">${week.tomatoActual}分</div>
                            <div style="text-align: center;">${week.tomatoPlanned}分</div>
                            <div style="text-align: center;">${week.stopwatchCount}</div>
                            <div style="text-align: center;">${week.stopwatchActual}分</div>
                            <div style="text-align: center;">${week.breakActual}分</div>
                            <div style="text-align: center; color: ${focusColor}; font-weight: bold;">${formatFocusTimeForTable(week.focusTime)}</div>
                            <div style="text-align: center; color: ${actualColor}; font-weight: bold;">${completionRate}%</div>
                        </div>
                    `;
                });
                
                tableContainer.innerHTML = currentTableHTML;
                pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页 (${weeklyStats.length} 周)`;
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= totalPages;
            };
            
            prevBtn.onclick = () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderPage();
                }
            };
            
            nextBtn.onclick = () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    renderPage();
                }
            };
            
            // 如果只有一页，隐藏分页控件
            if (totalPages <= 1) {
                paginationContainer.style.display = 'none';
            }
            
            renderPage();
            weeklyTable.appendChild(tableContainer);
            content.appendChild(weeklyTable);
        }

        container.appendChild(content);
        
        return container;
    }

    function createDailyStatsTable(dailyStatsArray) {
        if (!dailyStatsArray || dailyStatsArray.length === 0) return null;
        
        const container = document.createElement('div');
        container.style.cssText = `
            margin-top: 20px;
            padding: 16px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 2px solid var(--b3-theme-surface-light);
        `;

        // 标题区域（包含折叠按钮）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 12px;
            gap: 8px;
        `;

        const title = document.createElement('div');
        title.textContent = '📊 每日详细统计';
        title.style.cssText = `
            font-weight: bold;
            font-size: 16px;
            color: var(--b3-theme-primary);
            text-align: center;
        `;
        titleRow.appendChild(title);

        // 折叠按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '▼';
        toggleBtn.title = '折叠/展开';
        toggleBtn.style.cssText = `
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            padding: 4px 6px;
            border-radius: 3px;
            transition: all 0.2s;
        `;
        toggleBtn.onmouseenter = () => {
            toggleBtn.style.backgroundColor = 'var(--b3-theme-surface-light)';
        };
        toggleBtn.onmouseleave = () => {
            toggleBtn.style.backgroundColor = 'transparent';
        };

        // 内容区域
        const content = document.createElement('div');

        toggleBtn.onclick = () => {
            if (content.style.display === 'none') {
                content.style.display = '';
                toggleBtn.innerHTML = '▼';
            } else {
                content.style.display = 'none';
                toggleBtn.innerHTML = '◀';
            }
        };

        titleRow.appendChild(toggleBtn);
        container.appendChild(titleRow);

        const dailyTable = document.createElement('div');
        dailyTable.style.cssText = `
            font-size: 12px;
            margin-bottom: 10px;
        `;
        
        // 分页设置
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(dailyStatsArray.length / ITEMS_PER_PAGE);
        let currentPage = 1;
        
        // 分页控件容器
        const paginationContainer = document.createElement('div');
        paginationContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-bottom: 10px;
            padding: 8px;
            background: var(--b3-theme-surface-light);
            border-radius: 5px;
        `;
        
        const prevBtn = document.createElement('button');
        prevBtn.innerHTML = '◀';
        prevBtn.style.cssText = `
            padding: 4px 10px;
            background: var(--b3-theme-primary);
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        `;
        prevBtn.disabled = currentPage <= 1;
        
        const pageInfo = document.createElement('span');
        pageInfo.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        `;
        
        const nextBtn = document.createElement('button');
        nextBtn.innerHTML = '▶';
        nextBtn.style.cssText = `
            padding: 4px 10px;
            background: var(--b3-theme-primary);
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        `;
        nextBtn.disabled = currentPage >= totalPages;
        
        paginationContainer.appendChild(prevBtn);
        paginationContainer.appendChild(pageInfo);
        paginationContainer.appendChild(nextBtn);
        dailyTable.appendChild(paginationContainer);
        
        // 表格容器
        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = `
            max-height: none;
            overflow-y: visible;
            overflow-x: auto;
        `;
        
        const renderPage = () => {
            const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
            const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, dailyStatsArray.length);
            const pageData = dailyStatsArray.slice(startIdx, endIdx);
            
            // 每次都重新生成表头，避免翻页时累积旧数据
            let currentTableHTML = `
                <div style="display: grid; grid-template-columns: 90px repeat(8, 1fr); gap: 5px; margin-bottom: 5px; padding: 8px; background: var(--b3-theme-surface-light); border-radius: 5px; min-width: 900px; font-weight: bold; position: sticky; top: 0; z-index: 1;">
                    <div style="text-align: left;">日期</div>
                    <div style="text-align: center;">🍅 数量</div>
                    <div style="text-align: center;">🍅 实际</div>
                    <div style="text-align: center;">🍅 计划</div>
                    <div style="text-align: center;">⏱️ 数量</div>
                    <div style="text-align: center;">⏱️ 时长</div>
                    <div style="text-align: center;">☕ 时长</div>
                    <div style="text-align: center;">🎯 专注</div>
                    <div style="text-align: center;">📊 完成度</div>
                </div>
            `;
            
            pageData.forEach((day, idx) => {
                const realIndex = startIdx + idx;
                const bgColor = realIndex % 2 === 0 ? 'var(--b3-theme-background)' : 'var(--b3-theme-surface-light)';
                const completionRate = day.tomatoPlanned > 0 ? Math.round((day.tomatoActual / day.tomatoPlanned) * 100) : 0;
                const actualColor = completionRate >= 100 ? '#4CAF50' : (completionRate >= 80 ? '#FF9800' : '#F44336');
                const focusColor = day.focusTime >= 60 ? '#4CAF50' : (day.focusTime >= 30 ? '#FF9800' : '#F44336');
                
                currentTableHTML += `
                    <div style="display: grid; grid-template-columns: 90px repeat(8, 1fr); gap: 5px; padding: 8px; background: ${bgColor}; border-bottom: 1px solid var(--b3-theme-surface-light); min-width: 900px; cursor: pointer;"
                         onclick="const dialog = document.getElementById('tomy-tomato-history-dialog');
                                  if (dialog) {
                                      const contentArea = dialog.querySelector('#tomy-tomato-history-content');
                                      if (contentArea) {
                                          window.showPage('${day.date}');
                                      }
                                  }">
                        <div style="text-align: left; font-weight: bold;">${day.date}</div>
                        <div style="text-align: center;">${day.tomatoCount}</div>
                        <div style="text-align: center; color: ${actualColor};">${day.tomatoActual}分</div>
                        <div style="text-align: center;">${day.tomatoPlanned}分</div>
                        <div style="text-align: center;">${day.stopwatchCount}</div>
                        <div style="text-align: center;">${day.stopwatchActual}分</div>
                        <div style="text-align: center;">${day.breakActual}分</div>
                        <div style="text-align: center; color: ${focusColor}; font-weight: bold;">${formatFocusTimeForTable(day.focusTime)}</div>
                        <div style="text-align: center; color: ${actualColor}; font-weight: bold;">${completionRate}%</div>
                    </div>
                `;
            });
            
            tableContainer.innerHTML = currentTableHTML;
            pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页 (${dailyStatsArray.length} 天)`;
            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = currentPage >= totalPages;
        };
        
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                renderPage();
            }
        };
        
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderPage();
            }
        };
        
        // 如果只有一页，隐藏分页控件
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
        }
        
        renderPage();
        dailyTable.appendChild(tableContainer);
        content.appendChild(dailyTable);
        container.appendChild(content);
        
        return container;
    }

    function updateSummaryPageNavButtons() {
        const prevButton = document.getElementById('tomy-tomato-prev-page-summary');
        const nextButton = document.getElementById('tomy-tomato-next-page-summary');
        const { dateList } = historyState;
        
        if (prevButton && nextButton) {
            const hasNext = dateList.length > 0;
            
            prevButton.style.display = 'none';
            nextButton.style.display = hasNext ? 'flex' : 'none';
        }
    }

    function showDayPage(container, date, pageIndex) {
        const { filteredRecords } = historyState;
        
        const headerContainer = document.createElement('div');
        headerContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        `;
        
        const prevButton = document.createElement('button');
        prevButton.id = 'tomy-tomato-prev-page-day';
        prevButton.innerHTML = '◀';
        prevButton.style.cssText = `
            width: 30px; height: 30px; border-radius: 50%; background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background); border: 1px solid var(--b3-theme-surface-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 16px; opacity: 0.8; transition: all 0.2s; flex-shrink: 0;
        `;
        prevButton.onmouseenter = () => {
            prevButton.style.opacity = '1';
            prevButton.style.background = 'var(--b3-theme-surface-light)';
        };
        prevButton.onmouseleave = () => {
            prevButton.style.opacity = '0.8';
            prevButton.style.background = 'var(--b3-theme-surface)';
        };
        prevButton.onclick = () => navigateToPage(-1);
        
        const dateHeader = document.createElement('div');
        dateHeader.textContent = `📅 ${date}`;
        dateHeader.style.cssText = `
            font-weight: bold; font-size: 16px; color: var(--b3-theme-primary);
            text-align: center; flex: 1; margin: 0 8px;
        `;
        
        const nextButton = document.createElement('button');
        nextButton.id = 'tomy-tomato-next-page-day';
        nextButton.innerHTML = '▶';
        nextButton.style.cssText = `
            width: 30px; height: 30px; border-radius: 50%; background: var(--b3-theme-surface);
            color: var(--b3-theme-on-background); border: 1px solid var(--b3-theme-surface-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 16px; opacity: 0.8; transition: all 0.2s; flex-shrink: 0;
        `;
        nextButton.onmouseenter = () => {
            nextButton.style.opacity = '1';
            nextButton.style.background = 'var(--b3-theme-surface-light)';
        };
        nextButton.onmouseleave = () => {
            nextButton.style.opacity = '0.8';
            nextButton.style.background = 'var(--b3-theme-surface)';
        };
        nextButton.onclick = () => navigateToPage(1);
        
        headerContainer.appendChild(prevButton);
        headerContainer.appendChild(dateHeader);
        headerContainer.appendChild(nextButton);
        container.appendChild(headerContainer);

        const dateRecords = filteredRecords.filter(r => 
            (r.date || formatDateKey(r.start)) === date
        );
        
        dateRecords.sort((a, b) => new Date(a.start) - new Date(b.start));

        if (dateRecords.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '该日无计时记录';
            empty.style.textAlign = 'center';
            empty.style.opacity = '0.6';
            empty.style.padding = '30px 0';
            container.appendChild(empty);
            updateDayPageNavButtons();
            return;
        }

        if (userSettings.groupByTimePeriod) {
            displayGroupedRecordsForDay(container, dateRecords, date);
        } else {
            displaySimpleRecordsForDay(container, dateRecords, date);
        }
        
        updateDayPageNavButtons();
    }

    function updateDayPageNavButtons() {
        const prevButton = document.getElementById('tomy-tomato-prev-page-day');
        const nextButton = document.getElementById('tomy-tomato-next-page-day');
        const { currentPage, dateList } = historyState;
        
        if (prevButton && nextButton) {
            let hasPrev = false;
            let hasNext = false;
            
            if (dateList.includes(currentPage)) {
                const currentIndex = dateList.indexOf(currentPage);
                hasPrev = currentIndex > 0 || true;
                hasNext = currentIndex < dateList.length - 1;
            } else {
                hasPrev = true;
                const specialPages = ['today', 'yesterday', 'day-before-yesterday'];
                const currentIndex = specialPages.indexOf(currentPage);
                if (currentIndex !== -1) {
                    hasNext = currentIndex < specialPages.length - 1 || dateList.length > 0;
                }
            }
            
            prevButton.style.display = hasPrev ? 'flex' : 'none';
            nextButton.style.display = hasNext ? 'flex' : 'none';
        }
    }

    function displayGroupedRecordsForDay(container, dateRecords, date) {
        const periodOrder = getTimePeriodOrder();
        const groupedByPeriod = {};
        
        periodOrder.forEach(period => {
            groupedByPeriod[period] = [];
        });
        
        dateRecords.forEach(record => {
            const period = record.timePeriod || getTimePeriod(new Date(record.start).getHours());
            if (groupedByPeriod[period]) {
                groupedByPeriod[period].push(record);
            }
        });

        periodOrder.forEach(period => {
            const periodRecords = groupedByPeriod[period];
            if (periodRecords.length === 0) return;

            const periodHeader = document.createElement('div');
            periodHeader.textContent = getTimePeriodName(period);
            periodHeader.style.cssText = `
                font-weight: bold; font-size: 15px; margin-top: 14px; margin-bottom: 6px;
                padding-left: 6px; opacity: 0.9;
            `;
            container.appendChild(periodHeader);

            periodRecords.sort((a, b) => new Date(a.start) - new Date(b.start));
            periodRecords.forEach(record => {
                const item = createHistoryItem(record, historyState.allRecords);
                container.appendChild(item);
            });
        });

        displayDailyDateStatistics(container, dateRecords, date);
    }

    function displaySimpleRecordsForDay(container, dateRecords, date) {
        dateRecords.sort((a, b) => new Date(a.start) - new Date(b.start));
        
        dateRecords.forEach(record => {
            const item = createHistoryItem(record, historyState.allRecords);
            container.appendChild(item);
        });

        displayDailyDateStatistics(container, dateRecords, date);
    }

    function displayDailyDateStatistics(container, dateRecords, date) {
        // 检测是否是移动端
        const isMobile = isMobileDevice();

        // 添加删除当天记录按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️ 删除当天记录';
        deleteBtn.style.cssText = `
            padding: ${isMobile ? '8px 12px' : '6px 12px'}; 
            background: #F44336; color: white; border: none; border-radius: 4px; 
            cursor: pointer; font-size: ${isMobile ? '13px' : '12px'}; 
            margin-bottom: 12px; display: block; width: 100%;
        `;
        deleteBtn.onclick = async () => {
            const recordCount = dateRecords.length;
            
            // 🔧 v9.0 修复：移动端使用自定义对话框替代原生 confirm
            const confirmDelete = await new Promise((resolve) => {
                const confirmDialog = document.createElement('div');
                confirmDialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: var(--b3-theme-background);
                    border: 1px solid var(--b3-theme-surface-light);
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    z-index: 2147483648;
                    padding: 20px;
                    max-width: 80%;
                    min-width: 280px;
                `;
                
                confirmDialog.innerHTML = `
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 12px; color: var(--b3-theme-on-background);">
                        ⚠️ 确认删除
                    </div>
                    <div style="font-size: 14px; margin-bottom: 20px; color: var(--b3-theme-on-surface); line-height: 1.5;">
                        确定要删除 ${date} 的所有 ${recordCount} 条记录吗？<br>此操作不可恢复。
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button id="confirm-cancel-btn" style="padding: 8px 16px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); border: 1px solid var(--b3-theme-surface-light); border-radius: 4px; cursor: pointer;">
                            取消
                        </button>
                        <button id="confirm-delete-btn" style="padding: 8px 16px; background: #F44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            删除
                        </button>
                    </div>
                `;
                
                document.body.appendChild(confirmDialog);
                
                document.getElementById('confirm-delete-btn').onclick = () => {
                    confirmDialog.remove();
                    resolve(true);
                };
                
                document.getElementById('confirm-cancel-btn').onclick = () => {
                    confirmDialog.remove();
                    resolve(false);
                };
            });
            
            if (!confirmDelete) {
                return;
            }
            
            try {
                // 加载所有记录
                const allRecords = await loadHistoryRecords();
                
                // 过滤掉当天的记录
                const filteredRecords = allRecords.filter(r => r.date !== date);
                
                // 保存
                const success = await saveHistoryRecords(filteredRecords);
                
                if (success) {
                    // 🔧 v9.0 修复：使用自定义提示替代 alert
                    const successToast = document.createElement('div');
                    successToast.style.cssText = `
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--b3-theme-primary);
                        color: white;
                        padding: 12px 24px;
                        border-radius: 6px;
                        z-index: 2147483648;
                        font-size: 14px;
                    `;
                    successToast.textContent = '✅ 已删除当天记录';
                    document.body.appendChild(successToast);
                    setTimeout(() => successToast.remove(), 1000);
                    
                    // 关闭当前历史对话框
                    const dialog = document.getElementById('tomy-tomato-history-dialog');
                    const backdrop = document.getElementById('tomy-tomato-history-backdrop');
                    if (dialog) dialog.remove();
                    if (backdrop) backdrop.remove();
                    
                    // 重新打开历史对话框（会重新加载数据）
                    setTimeout(() => showHistoryDialog(), 1100);
                } else {
                    const errorToast = document.createElement('div');
                    errorToast.style.cssText = `
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: #F44336;
                        color: white;
                        padding: 12px 24px;
                        border-radius: 6px;
                        z-index: 2147483648;
                        font-size: 14px;
                    `;
                    errorToast.textContent = '❌ 删除失败';
                    document.body.appendChild(errorToast);
                    setTimeout(() => errorToast.remove(), 2000);
                }
            } catch (e) {
                const errorToast = document.createElement('div');
                errorToast.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #F44336;
                    color: white;
                    padding: 12px 24px;
                    border-radius: 6px;
                    z-index: 2147483648;
                    font-size: 14px;
                `;
                errorToast.textContent = '❌ 删除失败: ' + e.message;
                document.body.appendChild(errorToast);
                setTimeout(() => errorToast.remove(), 2000);
            }
        };
        container.appendChild(deleteBtn);

        const dailyTomatoCount = dateRecords.filter(r => r.mode === 'countdown' && r.durationSec >= 60).length;
        const dailyStopwatchCount = dateRecords.filter(r => r.mode === 'stopwatch').length;
        const dailyBreakCount = dateRecords.filter(r => r.mode === 'break' || r.mode === 'stopwatch-break').length;
        
        const dailyTomatoRecords = dateRecords.filter(r => r.mode === 'countdown' && r.durationSec >= 60);
        const dailyTomatoActual = dailyTomatoRecords.reduce((sum, r) => sum + r.durationMin, 0);
        const dailyTomatoPlanned = dailyTomatoRecords.reduce((sum, r) => sum + (r.plannedDuration || r.durationMin), 0);
        
        const dailyStopwatchRecords = dateRecords.filter(r => r.mode === 'stopwatch');
        const dailyStopwatchActual = dailyStopwatchRecords.reduce((sum, r) => sum + r.durationMin, 0);
        
        const dailyBreakRecords = dateRecords.filter(r => r.mode === 'break' || r.mode === 'stopwatch-break');
        const dailyBreakActual = dailyBreakRecords.reduce((sum, r) => sum + r.durationMin, 0);
        
        const dailyFocusTime = dailyTomatoActual + dailyStopwatchActual;
        
        const dailyStats = document.createElement('div');
        dailyStats.style.cssText = `
            font-size: 13px; margin: 20px 0 4px 0; padding: 12px;
            background: var(--b3-theme-surface-light); border-radius: 6px;
            text-align: center; border-left: 3px solid var(--b3-theme-primary);
        `;
        
        let statsHTML = `<strong>📊 ${date} 统计</strong><br>`;
        
        if (dailyFocusTime > 0) {
            statsHTML += `
                <div style="margin: 6px 0; padding-bottom: 8px;">
                    <span style="font-weight: bold; color: var(--b3-theme-primary);">🎯 专注时长:</span><br>
                    ${formatFocusTime(dailyFocusTime)}
                </div>
            `;
        }
        
        if (dailyTomatoCount > 0) {
            const completionRate = dailyTomatoPlanned > 0 ? Math.round((dailyTomatoActual / dailyTomatoPlanned) * 100) : 0;
            const rateColor = completionRate >= 100 ? '#4CAF50' : (completionRate >= 80 ? '#FF9800' : '#F44336');
            
            statsHTML += `
                <div style="margin: 6px 0;">
                    🍅 ${dailyTomatoCount} 个番茄<br>
                    实际: ${dailyTomatoActual}分钟 | 计划: ${dailyTomatoPlanned}分钟<br>
                    完成度: <span style="color:${rateColor}; font-weight:bold">${completionRate}%</span>
                </div>
            `;
        }
        
        if (dailyStopwatchCount > 0) {
            statsHTML += `
                <div style="margin-top: 6px;">
                    ⏱️ ${dailyStopwatchCount} 次正计时<br>
                    总时长: ${dailyStopwatchActual}分钟
                </div>
            `;
        }
        
        if (dailyBreakCount > 0 && userSettings.showBreakRecords) {
            statsHTML += `
                <div style="margin-top: 6px;">
                    ☕ ${dailyBreakCount} 次休息<br>
                    总时长: ${dailyBreakActual}分钟
                </div>
            `;
        }
        
        // 新增：显示任务块统计
        const taskRecords = dateRecords.filter(r => r.taskBlockId && r.taskBlockName);
        if (taskRecords.length > 0) {
            const uniqueTasks = [...new Set(taskRecords.map(r => r.taskBlockId))];
            statsHTML += `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--b3-theme-surface-light);">
                    📋 关联任务: ${uniqueTasks.length} 个
                </div>
            `;
        }
        
        dailyStats.innerHTML = statsHTML;
        container.appendChild(dailyStats);
    }

    function createHistoryItem(record, allRecords = []) {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 10px;
            margin: 4px 0;
            border-bottom: 1px solid var(--b3-theme-surface-light);
            border-radius: 5px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        `;
        
        if (record.mode === 'break' || record.mode === 'stopwatch-break') {
            item.style.backgroundColor = 'var(--b3-theme-surface-light)';
                } else if (record.mode === 'stopwatch') {
            item.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        } else if (record.wasReset) {
            item.style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
        } else {
            item.style.backgroundColor = 'var(--b3-theme-background)';
        }
        
        const modeEmoji = record.mode === 'countdown' ? '🍅' : 
                         record.mode === 'break' ? '☕' : 
                         record.mode === 'stopwatch-break' ? '☕' : '⏱️';
        const startDate = new Date(record.start);
        const endDate = new Date(record.end);
        
        const formatShortTime = (date) => {
            return date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });
        };
        
        const timePeriodText = userSettings.groupByTimePeriod ? '' : 
            ` | ${getTimePeriodName(record.timePeriod || getTimePeriod(startDate.getHours()))}`;
        
        let durationText = '';
        
        if (record.durationSec < 60) {
            durationText = `${record.durationSec}秒`;
        } else {
            durationText = `${record.durationMin}分钟`;
        }
        
        const resetText = record.wasReset ? '<span style="color:#FF9800; font-weight:bold">🔄重置</span> ' : '';
        const plannedText = record.mode === 'countdown' && record.plannedDuration && record.plannedDuration !== record.durationMin ?
            ` (预设${record.plannedDuration}分)` : '';
        
        // 🔧 新增：任务块信息 - 添加点击跳转功能
        const taskBlockText = record.taskBlockId && record.taskBlockName ? 
            `<span class="tomato-task-link" data-block-id="${record.taskBlockId}" style="
                font-size: 11px; margin-top: 2px; color: var(--b3-theme-primary); 
                cursor: pointer; display: inline-flex; align-items: center; gap: 3px;
            ">📋 ${record.taskBlockName}</span>` : '';
        
        // 合并相同任务时间（默认开启）
        let mergedDurationText = '';
        if (record.taskBlockId && record.taskBlockName && allRecords.length > 0) {
            // 获取所有相同任务的记录
            const sameTaskRecords = allRecords.filter(r => 
                r.taskBlockId === record.taskBlockId && 
                r.taskBlockName === record.taskBlockName
            );
            
            if (sameTaskRecords.length > 1) {
                const totalDuration = sameTaskRecords.reduce((sum, r) => sum + (r.durationMin || 0), 0);
                const totalCount = sameTaskRecords.length;
                mergedDurationText = `<div style="font-size: 11px; margin-top: 2px; color: var(--b3-theme-primary);">
                    📊 合计: ${totalDuration}分钟 (${totalCount}次)
                </div>`;
            }
        }
        
        const leftContent = document.createElement('div');
        leftContent.style.cssText = `flex: 1; min-width: 0;`;
        leftContent.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <strong>${modeEmoji}</strong> 
                <span style="white-space: nowrap;">${formatShortTime(startDate)} - ${formatShortTime(endDate)}</span>
                ${timePeriodText ? `<small style="opacity:0.7; white-space: nowrap;">${timePeriodText}</small>` : ''}
            </div>
            ${taskBlockText}
            ${mergedDurationText}
        `;
        
        const rightContent = document.createElement('div');
        rightContent.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            margin-left: auto;
            flex-shrink: 0;
        `;
        
        const timerInfo = document.createElement('div');
        timerInfo.style.cssText = `
            text-align: right;
            padding-right: 8px;
            min-width: 80px;
        `;
        timerInfo.innerHTML = `
            ${resetText}<span style="font-weight:bold; color:${record.wasReset ? '#FF9800' : 'var(--b3-theme-primary)'};">${durationText}${plannedText}</span>
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = '删除记录';
        deleteBtn.style.cssText = `
            background: transparent;
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 3px;
            color: var(--b3-theme-error);
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
            opacity: 0.7;
            transition: opacity 0.2s;
            flex-shrink: 0;
        `;
        
        deleteBtn.onmouseenter = () => {
            deleteBtn.style.opacity = '1';
            deleteBtn.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
        };
        deleteBtn.onmouseleave = () => {
            deleteBtn.style.opacity = '0.7';
            deleteBtn.style.backgroundColor = 'transparent';
        };
        
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            
            // 禁用按钮防止重复点击
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';
            
            try {
                const success = await deleteRecord(record);
                if (success) {
                    // 先移除现有的对话框和遮罩
                    const existingDialog = document.getElementById('tomy-tomato-history-dialog');
                    const existingBackdrop = document.getElementById('tomy-tomato-history-backdrop');
                    if (existingDialog) existingDialog.remove();
                    if (existingBackdrop) existingBackdrop.remove();
                    
                    // 短暂延迟后重新打开，确保DOM已清理
                    setTimeout(() => {
                        showHistoryDialog(historyState.currentPage);
                    }, 50);
                }
            } finally {
                // 恢复按钮状态
                deleteBtn.disabled = false;
                deleteBtn.style.opacity = '0.7';
            }
        };
        
        rightContent.appendChild(timerInfo);
        rightContent.appendChild(deleteBtn);
        
        item.appendChild(leftContent);
        item.appendChild(rightContent);
        
        return item;
    }

    // 🔧 新增：跳转到任务块（支持打开文档后跳转）- 不进入聚焦模式
    async function navigateToBlock(blockId) {
        Logger.info('🔍 尝试跳转到块:', blockId);
        
        if (!blockId) return;

        // 🔧 修复：检查是否有正在进行的计时任务
        // 如果有，跳转后需要恢复高亮状态
        const shouldRestoreHighlight = !!currentTaskBlockId;
        
        // 方法1：检查块是否在当前活动文档中
        let blockElement = findBlockElement(blockId);
        if (blockElement) {
            Logger.info('✅ 块元素在当前活动文档中，直接滚动');
            // 🔧 修复：使用 scrollIntoView 滚动，不会触发聚焦
            blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 🔧 修复：如果有计时任务，恢复高亮状态
            if (shouldRestoreHighlight && blockId === currentTaskBlockId) {
                Logger.info('✅ 跳转成功，恢复任务块高亮');
                highlightTaskBlock(currentTaskBlockId);
                startHighlightKeepAlive();
            } else {
                // 没有计时任务时，临时高亮后移除
                blockElement.classList.add('tomato-task-highlight');
                setTimeout(() => {
                    blockElement.classList.remove('tomato-task-highlight');
                }, 2000);
            }
            return;
        }
        
        // 方法2：块不在当前活动文档中，需要打开文档再跳转
        Logger.info('⚠️ 块不在当前活动文档中，尝试使用块链接跳转...');
        
        try {
            if (await __openBlockByOfficialApi(blockId)) {
                setTimeout(() => {
                    checkAndScrollToBlock(blockId);
                }, 600);
                return;
            }

            // 🔧 改进：使用模拟点击 siyuan:// 链接的方式跳转，这是最原生的方式
            // 这种方式兼容性最好，能自动处理打开文档、定位块等逻辑
            const siyuanUrl = `siyuan://blocks/${blockId}`;
            Logger.info('🔗 尝试模拟点击块链接:', siyuanUrl);
            
            const link = document.createElement('a');
            link.href = siyuanUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            Logger.info('✅ 模拟点击完成');
            
            // 延迟检查是否跳转成功（可选）
            setTimeout(() => {
                checkAndScrollToBlock(blockId);
            }, 500);
            
            return;
        } catch (e) {
            Logger.warn('⚠️ 模拟点击块链接失败:', e);
        }

        // 后备方案：尝试其他 API
        Logger.info('⚠️ 块链接跳转可能失败，尝试使用 API 打开...');
        
        let docId = await findDocumentIdByBlockId(blockId);
        if (!docId) {
            docId = blockId; // 使用块ID作为后备
        }
        
        Logger.info('📄 文档ID:', docId, '正在打开...');

        // 🔧 修复：优先使用不刷新页面的方法打开文档
        // 尝试方法1：使用 siyuan.block.scrollToBlock（推荐，不刷新页面）
        if (window.siyuan?.block?.scrollToBlock) {
            try {
                Logger.info('🔄 尝试使用 siyuan.block.scrollToBlock 打开文档...');
                window.siyuan.block.scrollToBlock(blockId);
                Logger.info('✅ 使用 siyuan.block.scrollToBlock 跳转成功');

                // 延迟检查并滚动，确保文档已打开
                setTimeout(() => {
                    const blockEl = findBlockElement(blockId);
                    if (blockEl) {
                        blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    checkAndScrollToBlock(blockId);
                }, 300);
                return;
            } catch (e) {
                Logger.warn('⚠️ siyuan.block.scrollToBlock 失败:', e);
            }
        }

        // 尝试方法2：使用 openFileById（思源 API，不会刷新页面）
        if (window.siyuan?.openFileById) {
            try {
                await window.siyuan.openFileById(docId);
                Logger.info('✅ 使用 openFileById 打开文档');
                setTimeout(() => {
                    checkAndScrollToBlock(blockId);
                }, 500);
                return;
            } catch (e) {
                Logger.warn('⚠️ openFileById 失败:', e);
            }
        }

        // 尝试方法3：使用 ws 协议通知（思源内部通信，不会刷新页面）
        if (window.siyuan?.ws?.editor?.openDoc) {
            try {
                await window.siyuan.ws.editor.openDoc(docId);
                Logger.info('✅ 使用 ws.editor.openDoc 打开文档');
                setTimeout(() => {
                    checkAndScrollToBlock(blockId);
                }, 500);
                return;
            } catch (e) {
                Logger.warn('⚠️ ws.editor.openDoc 失败:', e);
            }
        }

        // 尝试方法4：使用 URL scheme（移动端兼容）
        try {
            const siyuanUrl = `siyuan://blocks/${docId}`;
            
            Logger.warn('⚠️ 所有不刷新页面的方法都失败了，使用 URL scheme 跳转');
            
            // 🔧 修复：移动端必须保存状态后再跳转
            if (isRunning) {
                Logger.info('💾 移动端跳转前保存计时器状态...');
                saveTimerState();
            }
            
            // 使用 location.href 跳转（移动端更可靠）
            window.location.href = siyuanUrl;
            
            return;
        } catch (e) {
            Logger.warn('⚠️ URL scheme 跳转失败:', e);
        }

        Logger.warn('⚠️ 所有打开文档的方法都失败了');
    }
    
    // 🔧 修复：查找块元素 - 增强查找逻辑，支持非聚焦状态
    function findBlockElement(blockId) {
        // 1. 优先查找当前活动文档的编辑器区域
        const activeEditor = document.querySelector('.protyle--focus .protyle-wysiwyg, .protyle--focus .protyle-content');
        if (activeEditor) {
            const element = activeEditor.querySelector(`[data-node-id="${blockId}"]`);
            if (element) {
                Logger.info('✅ 在当前活动文档中找到块元素');
                return element;
            }
        }

        // 2. 如果没找到，尝试在所有可见的编辑器中查找
        // 这种情况常见于：点击悬浮窗时焦点可能不在编辑器上，或者多页签/分屏情况
        const allEditors = document.querySelectorAll('.protyle-wysiwyg, .protyle-content');
        for (const editor of allEditors) {
            // 排除隐藏的编辑器（例如未激活的页签）
            if (editor.offsetParent === null) continue;
            
            const element = editor.querySelector(`[data-node-id="${blockId}"]`);
            if (element) {
                Logger.info('✅ 在可见编辑器（非聚焦）中找到块元素');
                return element;
            }
        }
        
        Logger.info('⚠️ 未在当前活动/可见文档中找到块元素，需要打开文档');
        return null;
    }
    
    // 🔧 新增：检查并滚动到块（排除面包屑）- 不进入聚焦模式
    function checkAndScrollToBlock(blockId) {
        // 使用通用的查找函数（已排除面包屑）
        const blockElement = findBlockElement(blockId);

        if (blockElement) {
            Logger.info('✅ 文档加载成功，已跳转到块（已排除面包屑）');
            // 🔧 修复：使用 scrollIntoView 滚动，不会触发聚焦
            blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 🔧 修复：如果有计时任务，恢复高亮状态
            if (currentTaskBlockId && blockId === currentTaskBlockId) {
                Logger.info('✅ 文档加载成功，已跳转到块，恢复高亮状态');
                highlightTaskBlock(currentTaskBlockId);
                startHighlightKeepAlive();
            } else {
                // 没有计时任务时，临时高亮后移除
                blockElement.classList.add('tomato-task-highlight');
                setTimeout(() => {
                    blockElement.classList.remove('tomato-task-highlight');
                }, 2000);
            }
        } else {
            Logger.warn('⚠️ 文档已打开但仍未找到块元素');
            // 再次尝试 scrollToBlock
            if (window.siyuan?.block?.scrollToBlock) {
                try {
                    window.siyuan.block.scrollToBlock(blockId);
                    Logger.info('✅ 使用 scrollToBlock 跳转成功');
                } catch (e) {
                    Logger.warn('⚠️ scrollToBlock 也失败:', e);
                }
            }
        }
    }
    
    // 🔧 新增：根据块ID查找所属的文档ID
    async function findDocumentIdByBlockId(blockId) {
        // 思源笔记的块ID通常包含时间戳前缀
        // 尝试从历史记录数据中查找该块所属的文档
        try {
            // 方法1：检查全局状态中是否保存了文档信息
            if (window.tomatoBlockDocs && window.tomatoBlockDocs[blockId]) {
                return window.tomatoBlockDocs[blockId];
            }
            
            // 方法2：使用思源API查询块信息
            if (window.siyuan?.block?.getBlockInfo) {
                try {
                    const blockInfo = await window.siyuan.block.getBlockInfo(blockId);
                    if (blockInfo?.rootID) {
                        return blockInfo.rootID;
                    }
                } catch (e) {
                    Logger.warn('⚠️ 获取块信息失败:', e);
                }
            }
            
            // 方法3：如果块ID格式是"时间戳-随机字符"，尝试提取文档ID
            // 注意：这不是100%准确的，但可以作为后备方案
            // 块ID通常不是文档ID，需要通过API获取
            
            Logger.warn('⚠️ 无法找到文档ID，使用块ID直接尝试');
            return blockId; // 返回块ID作为后备
            
        } catch (e) {
            Logger.error('❌ 查找文档ID时出错:', e);
            return blockId;
        }
    }

    // 🔧 新增：任务块名称点击事件（事件委托）- 跳转后关闭历史界面
    function setupTaskLinkListeners(container) {
        EventManager.add(container, 'click', (e) => {
            const link = e.target.closest('.tomato-task-link');
            if (link) {
                if (isMobileDevice() && !__canUseOfficialOpenBlock()) {
                    Logger.info('🖱️ 移动端点击任务链接，但未检测到插件 openBlock 能力，跳过跳转');
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                const blockId = link.dataset.blockId;
                if (blockId) {
                    Logger.info('🖱️ 点击任务链接, 准备跳转并关闭历史界面');
                    // 使用官方 API 方案跳转
                    navigateToBlock(blockId);

                    // 延迟关闭历史界面，确保跳转已经执行
                    setTimeout(() => {
                        const dialog = document.getElementById('tomy-tomato-history-dialog');
                        const backdrop = document.getElementById('tomy-tomato-history-backdrop');
                        if (dialog) dialog.remove();
                        if (backdrop) backdrop.remove();
                        Logger.info('✅ 历史界面已关闭');
                    }, 100);
                }
            }
        });
    }

    // ========== 移动端悬浮条功能 ==========
    // 检测是否是移动端（用于悬浮条创建）
    function isMobileDevice() {
        const ua = navigator.userAgent;
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)) return true;
        if (/HarmonyOS/i.test(ua)) return true;
        if (/Huawei|HUAWEI/.test(ua) && !/Chrome|Chromium|EdgA|Firefox/.test(ua)) return true;
        if (window.matchMedia("(any-pointer:coarse)").matches) {
            if (/Android|Linux/.test(ua) && !/Win|Mac|X11/.test(ua)) return true;
        }
        return false;
    }

    // 🔍 排除移动端 & 鸿蒙（8.2版本逻辑，用于完全禁用）
    function isMobileOrHarmony() {
        const ua = navigator.userAgent;
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)) return true;
        if (/HarmonyOS/i.test(ua)) return true;
        if (/Huawei|HUAWEI/.test(ua) && !/Chrome|Chromium|EdgA|Firefox/.test(ua)) return true;
        if (window.matchMedia("(any-pointer:coarse)").matches) {
            if (/Android|Linux/.test(ua) && !/Win|Mac|X11/.test(ua)) return true;
        }
        return false;
    }

    // 移动端状态变量
    let isUsingFloatBar = false;
    let floatBarHiddenByUser = false;  // 用户是否主动关闭悬浮窗
    let floatBarLongPressTimer = null;
    let isLongPress = false;
    let isContextMenuOpen = false;  // 跟踪菜单是否打开
    
    // 🔧 v9.0 修复：保存悬浮窗位置，用于关闭后再打开时恢复
    let savedFloatBarPosition = {
        x: null,
        y: null
    };
    
    // 🔧 性能优化：悬浮窗事件处理函数引用，用于清理
    let floatBarEventHandlers = {
        mousemove: null,
        mouseup: null,
        touchmove: null,
        touchend: null,
        resize: null
    };
    
    // 🔧 性能优化：清理悬浮窗相关的 document 级别事件监听器
    function cleanupFloatBarEvents() {
        if (floatBarEventHandlers.mousemove) {
            document.removeEventListener('mousemove', floatBarEventHandlers.mousemove);
            floatBarEventHandlers.mousemove = null;
        }
        if (floatBarEventHandlers.mouseup) {
            document.removeEventListener('mouseup', floatBarEventHandlers.mouseup);
            floatBarEventHandlers.mouseup = null;
        }
        if (floatBarEventHandlers.touchmove) {
            document.removeEventListener('touchmove', floatBarEventHandlers.touchmove);
            floatBarEventHandlers.touchmove = null;
        }
        if (floatBarEventHandlers.touchend) {
            document.removeEventListener('touchend', floatBarEventHandlers.touchend);
            floatBarEventHandlers.touchend = null;
        }
        if (floatBarEventHandlers.resize) {
            window.removeEventListener('resize', floatBarEventHandlers.resize);
            floatBarEventHandlers.resize = null;
        }
        // 清理长按定时器
        if (floatBarLongPressTimer) {
            clearTimeout(floatBarLongPressTimer);
            floatBarLongPressTimer = null;
        }
    }

    // 创建可拖动悬浮条（移动端专用）
    function createDraggableFloatBar() {
        // 🔧 v9.0 修复：如果用户主动关闭了悬浮窗，不创建
        if (floatBarHiddenByUser) {
            Logger.info('🍅 用户已主动关闭悬浮窗，不创建悬浮条');
            return false;
        }
        
        // 检查是否已存在悬浮条
        if (document.getElementById('siyuan-tomato-float-bar')) {
            return true;
        }

        const floatBar = document.createElement('div');
        floatBar.id = 'siyuan-tomato-float-bar';

        // 获取屏幕尺寸
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // 根据屏幕宽度决定悬浮条大小和位置
        const isSmallMobile = screenWidth < 360;

        // 样式
        floatBar.style.cssText = `
            position: fixed;
            right: 16px;
            bottom: 100px;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--b3-theme-background, #fff);
            border: 1px solid var(--b3-theme-surface-light, #e0e0e0);
            border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            cursor: move;
            user-select: none;
            touch-action: none;
            transition: box-shadow 0.2s ease;
            ${isSmallMobile ? 'width: 44px; height: 44px;' : 'width: 52px; height: 52px;'}
        `;

        // 计时器显示区域
        const timerDisplay = document.createElement('div');
        timerDisplay.id = 'siyuan-tomato-timer';
        timerDisplay.style.cssText = `
            font-size: ${isSmallMobile ? '13px' : '15px'};
            font-weight: 600;
            color: var(--b3-theme-on-background, #333);
            font-family: monospace;
            text-align: center;
            line-height: 1;
            pointer-events: none;  // 确保触摸事件由floatBar处理，不被timerDisplay阻挡
        `;
        // 初始显示：倒计时模式显示番茄图标，停止状态也显示
        const initialText = timerMode === 'countdown' ? `🍅 ${formatTime(remainingSeconds)}` :
                          timerMode === 'break' ? `☕ ${formatTime(remainingSeconds)}` :
                          timerMode === 'stopwatch' ? `⏱️ ${formatTime(elapsedSeconds)}` : '🍅 00:00';
        timerDisplay.textContent = initialText;
        floatBar.appendChild(timerDisplay);
        timeDisplay = timerDisplay;

        // 控制按钮
        const ctrlBtn = document.createElement('button');
        ctrlBtn.className = 'tomato-float-ctrl-btn';
        ctrlBtn.style.cssText = `
            position: absolute;
            top: -8px;
            right: -8px;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: none;
            background: var(--b3-theme-error, #f44336);
            color: white;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            padding: 0;
            line-height: 1;
        `;
        ctrlBtn.innerHTML = isRunning ? '⏸' : '▶';
        ctrlBtn.title = isRunning ? '暂停' : '开始';
        ctrlBtn.onclick = (e) => {
            e.stopPropagation();
            if (isRunning) {
                pauseTimer();
            } else {
                startTimer();
            }
        };
        floatBar.appendChild(ctrlBtn);
        controlButton = ctrlBtn;

        // 拖动功能变量
        let isDragging = false;
        let startX, startY;
        let initialX, initialY;
        // 🔧 v9.0 修复：恢复保存的位置，否则使用默认位置
        let currentX = savedFloatBarPosition.x !== null ? savedFloatBarPosition.x : (screenWidth - 76);
        let currentY = savedFloatBarPosition.y !== null ? savedFloatBarPosition.y : (screenHeight - 180);
        
        // 如果有保存的位置，初始化时应用
        if (savedFloatBarPosition.x !== null && savedFloatBarPosition.y !== null) {
            floatBar.style.left = currentX + 'px';
            floatBar.style.top = currentY + 'px';
            floatBar.style.right = 'auto';
            floatBar.style.bottom = 'auto';
        }

        // 触摸时间追踪（用于区分长按和点击）
        let touchStartTime = 0;
        let isLongPressTriggered = false;

        // 边界检测
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        // 吸附边缘（支持全屏幕位置）- 使用动态屏幕尺寸
        const snapToEdge = (x, y) => {
            const margin = 10;
            const barWidth = 60;
            const barHeight = 60;
            // 动态获取当前屏幕尺寸
            const currentScreenWidth = window.innerWidth;
            const currentScreenHeight = window.innerHeight;

            // 底部吸附
            if (y > currentScreenHeight - barHeight) {
                y = currentScreenHeight - barHeight - margin;
            } else if (y < margin) {
                y = margin;
            }

            // 左右吸附
            if (x > currentScreenWidth - barWidth) {
                x = currentScreenWidth - barWidth - margin;
            } else if (x < margin) {
                x = margin;
            }

            return { x, y };
        };

        // 鼠标/触摸开始
        const onDragStart = (e) => {
            // 点击控制按钮时不触发拖动
            const target = e.target;
            if (target === ctrlBtn || target.closest('.tomato-float-ctrl-btn')) return;

            // 如果菜单已经打开，不触发拖动
            if (isContextMenuOpen) return;

            // 确保在 floatBar 内（排除子元素的特殊情况）
            if (!floatBar.contains(target)) return;

            // 移动端：由专门的 touchstart 处理器处理长按和拖动，这里不处理 touchstart
            if (e.type === 'touchstart') return;

            isDragging = true;
            isLongPress = false;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            startX = clientX;
            startY = clientY;
            initialX = currentX;
            initialY = currentY;

            floatBar.style.transition = 'none';
            floatBar.style.zIndex = '10000';
            floatBar.style.opacity = '0.9';
            floatBar.style.transform = 'scale(1.1)';
            floatBar.style.cursor = 'grabbing';
            floatBar.classList.add('dragging');

            // 清除可能的长按定时器（仅桌面端）
            if (floatBarLongPressTimer && e.type !== 'touchstart') {
                clearTimeout(floatBarLongPressTimer);
                floatBarLongPressTimer = null;
            }

            e.preventDefault();
        };

        // 鼠标/触摸移动
        const onDragMove = (e) => {
            if (!isDragging) return;

            // 如果菜单已打开，不处理拖动
            if (isContextMenuOpen) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            // 检测是否移动超过一定距离，如果是则不是长按
            if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                isLongPress = false;
                if (floatBarLongPressTimer) {
                    clearTimeout(floatBarLongPressTimer);
                    floatBarLongPressTimer = null;
                }
            }

            // 动态获取屏幕尺寸，适应窗口变化
            const currentScreenWidth = window.innerWidth;
            const currentScreenHeight = window.innerHeight;

            currentX = clamp(initialX + deltaX, 0, currentScreenWidth - 60);
            currentY = clamp(initialY + deltaY, 0, currentScreenHeight - 80);

            floatBar.style.left = currentX + 'px';
            floatBar.style.top = currentY + 'px';
            floatBar.style.right = 'auto';
            floatBar.style.bottom = 'auto';

            e.preventDefault();
        };

        // 鼠标/触摸结束
        const onDragEnd = () => {
            if (!isDragging) return;

            isDragging = false;
            floatBar.classList.remove('dragging');
            floatBar.style.transition = 'all 0.2s ease';
            floatBar.style.opacity = '';
            floatBar.style.transform = '';
            floatBar.style.cursor = 'move';

            // 如果不是长按，则吸附到边缘
            if (!isLongPress) {
                const snapped = snapToEdge(currentX, currentY);
                currentX = snapped.x;
                currentY = snapped.y;

                floatBar.style.left = currentX + 'px';
                floatBar.style.top = currentY + 'px';
                floatBar.style.right = 'auto';
                floatBar.style.bottom = 'auto';
                
                // 🔧 v9.0 修复：保存位置，用于关闭后再打开时恢复
                savedFloatBarPosition.x = currentX;
                savedFloatBarPosition.y = currentY;
            }

            floatBar.style.zIndex = '9999';
        };

        // 长按显示右键菜单
        const onLongPress = (e) => {
            isLongPress = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            // 显示右键菜单
            showContextMenu(clientX, clientY);

            // 清除长按定时器
            if (floatBarLongPressTimer) {
                clearTimeout(floatBarLongPressTimer);
                floatBarLongPressTimer = null;
            }
        };

        // 绑定事件
        // 🔧 性能优化：保存事件处理函数引用，用于后续清理
        floatBarEventHandlers.mousemove = onDragMove;
        floatBarEventHandlers.mouseup = onDragEnd;
        
        // 桌面端使用 mousedown/mousemove/mouseup
        floatBar.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', floatBarEventHandlers.mousemove);
        document.addEventListener('mouseup', floatBarEventHandlers.mouseup);

        // 移动端触摸事件处理器
        let touchStartX = 0;
        let touchStartY = 0;

        floatBar.addEventListener('touchstart', (e) => {
            if (e.target === ctrlBtn || e.target.closest('.tomato-float-ctrl-btn')) return;

            // 记录触摸开始位置
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;

            // 记录触摸开始时间
            touchStartTime = Date.now();
            isLongPressTriggered = false;

            // 如果菜单已经打开，再次触摸则关闭菜单并重置状态
            if (isContextMenuOpen) {
                const existingMenu = document.getElementById('tomy-tomato-context-menu');
                if (existingMenu) {
                    existingMenu.style.opacity = '0';
                    setTimeout(() => {
                        existingMenu.remove();
                    }, 100);
                }
                // 立即重置状态，确保可以继续操作
                isContextMenuOpen = false;
                // 清除长按定时器
                if (floatBarLongPressTimer) {
                    clearTimeout(floatBarLongPressTimer);
                    floatBarLongPressTimer = null;
                }
                // 重置拖动状态
                isDragging = false;
                isLongPress = false;
                // 立即返回，不触发新的长按
                return;
            }

            // 设置长按定时器（500ms触发长按）
            floatBarLongPressTimer = setTimeout(() => {
                isLongPressTriggered = true;
                // 触发长按菜单
                const rect = floatBar.getBoundingClientRect();
                onLongPress({
                    touches: [{ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }]
                });
            }, 500);
        }, { passive: true });

        // 移动端触摸移动 - 处理拖动
        // 🔧 v9.0 修复：使用命名函数并保存引用，确保可以正确清理
        const onTouchMove = (e) => {
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;
            
            // 如果正在拖动，持续更新位置
            if (isDragging) {
                const deltaX = clientX - startX;
                const deltaY = clientY - startY;

                // 更新位置
                const currentScreenWidth = window.innerWidth;
                const currentScreenHeight = window.innerHeight;
                currentX = clamp(initialX + deltaX, 0, currentScreenWidth - 60);
                currentY = clamp(initialY + deltaY, 0, currentScreenHeight - 80);

                floatBar.style.left = currentX + 'px';
                floatBar.style.top = currentY + 'px';
                floatBar.style.right = 'auto';
                floatBar.style.bottom = 'auto';
                return;
            }

            // 如果还没有开始拖动，检查是否应该开始
            if (floatBarLongPressTimer) {
                const deltaX = Math.abs(clientX - touchStartX);
                const deltaY = Math.abs(clientY - touchStartY);

                // 如果移动超过一定距离，取消长按，开始拖动
                if (deltaX > 10 || deltaY > 10) {
                    // 取消长按状态
                    isLongPress = false;
                    isLongPressTriggered = false;

                    clearTimeout(floatBarLongPressTimer);
                    floatBarLongPressTimer = null;

                    // 开始拖动
                    isDragging = true;
                    startX = touchStartX;
                    startY = touchStartY;
                    initialX = currentX;
                    initialY = currentY;

                    floatBar.style.transition = 'none';
                    floatBar.style.zIndex = '10000';
                    floatBar.style.opacity = '0.9';
                    floatBar.style.transform = 'scale(1.1)';
                    floatBar.style.cursor = 'grabbing';
                    floatBar.classList.add('dragging');
                } else {
                    // 移动距离不足，重新记录触摸位置（允许用户微调后继续判断）
                    touchStartX = clientX;
                    touchStartY = clientY;
                    // 重新设置长按定时器
                    clearTimeout(floatBarLongPressTimer);
                    floatBarLongPressTimer = setTimeout(() => {
                        isLongPressTriggered = true;
                        // 触发长按菜单
                        const rect = floatBar.getBoundingClientRect();
                        onLongPress({
                            touches: [{ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }]
                        });
                    }, 500);
                }
            }
        };
        
        floatBarEventHandlers.touchmove = onTouchMove;
        document.addEventListener('touchmove', floatBarEventHandlers.touchmove, { passive: true });

        // 移动端触摸结束
        // 🔧 v9.0 修复：使用命名函数并保存引用，确保可以正确清理
        const onTouchEnd = () => {
            if (floatBarLongPressTimer) {
                clearTimeout(floatBarLongPressTimer);
                floatBarLongPressTimer = null;
            }

            // 如果不是长按，则吸附到边缘
            if (!isLongPress && isDragging) {
                isDragging = false;
                floatBar.classList.remove('dragging');
                floatBar.style.transition = 'all 0.2s ease';
                floatBar.style.opacity = '';
                floatBar.style.transform = '';
                floatBar.style.cursor = 'move';
                floatBar.style.zIndex = '9999';

                const snapped = snapToEdge(currentX, currentY);
                currentX = snapped.x;
                currentY = snapped.y;

                floatBar.style.left = currentX + 'px';
                floatBar.style.top = currentY + 'px';
                floatBar.style.right = 'auto';
                floatBar.style.bottom = 'auto';
                
                // 🔧 v9.0 修复：保存位置，用于关闭后再打开时恢复
                savedFloatBarPosition.x = currentX;
                savedFloatBarPosition.y = currentY;
            }

            isDragging = false;
        };
        
        floatBarEventHandlers.touchend = onTouchEnd;
        document.addEventListener('touchend', floatBarEventHandlers.touchend);

        // 移动端：点击事件处理 - 阻止短按产生click事件，避免与长按冲突
        floatBar.addEventListener('click', (e) => {
            if (e.target === ctrlBtn || e.target.closest('.tomato-float-ctrl-btn')) return;

            // 移动端直接阻止所有点击事件，由触摸事件处理
            if (isMobileDevice()) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        floatBar.addEventListener('touchcancel', () => {
            if (floatBarLongPressTimer) {
                clearTimeout(floatBarLongPressTimer);
                floatBarLongPressTimer = null;
            }
        });

        // 窗口大小变化时更新边界
        // 🔧 v9.0 修复：使用命名函数并保存引用，确保可以正确清理
        const onResize = () => {
            const newScreenWidth = window.innerWidth;
            const newScreenHeight = window.innerHeight;

            currentX = clamp(currentX, 0, newScreenWidth - 60);
            currentY = clamp(currentY, 0, newScreenHeight - 80);

            floatBar.style.left = currentX + 'px';
            floatBar.style.top = currentY + 'px';
            
            // 保存调整后的位置
            savedFloatBarPosition.x = currentX;
            savedFloatBarPosition.y = currentY;
        };
        
        floatBarEventHandlers.resize = onResize;
        window.addEventListener('resize', floatBarEventHandlers.resize);

        document.body.appendChild(floatBar);
        Logger.info('🍅 移动端悬浮条已创建');

        return true;
    }

    // 显示悬浮条（面包屑按钮点击时调用）
    function showFloatBar() {
        if (!isMobileSupportEnabled()) return;

        // 🔧 v9.0 修复：如果用户主动关闭了悬浮窗，不自动显示
        if (floatBarHiddenByUser) {
            Logger.info('🍅 用户已主动关闭悬浮窗，不自动显示');
            return;
        }

        // 如果已经使用悬浮条，直接显示
        if (isUsingFloatBar) {
            const floatBar = document.getElementById('siyuan-tomato-float-bar');
            if (floatBar) {
                floatBar.style.display = 'flex';
                floatBar.style.opacity = '1';
                floatBar.style.transform = 'scale(1)';
                Logger.info('🍅 悬浮条已显示');
            }
            return;
        }

        // 如果悬浮条已存在，直接显示并设置标志
        if (document.getElementById('siyuan-tomato-float-bar')) {
            isUsingFloatBar = true;
            const floatBar = document.getElementById('siyuan-tomato-float-bar');
            floatBar.style.display = 'flex';
            floatBar.style.opacity = '1';
            Logger.info('🍅 悬浮条已显示（已存在）');
            return;
        }

        // 创建悬浮条
        addFloatBarStyle();
        if (createDraggableFloatBar()) {
            isUsingFloatBar = true;
            Logger.info('🍅 悬浮条已创建并显示');
        }
    }

    // 懒加载模式：开始计时时显示悬浮条
    function showFloatBarOnTimerStart() {
        // 🔧 v9.0 修复：如果用户主动关闭了悬浮窗，不自动显示
        if (floatBarHiddenByUser) {
            Logger.info('🍅 懒加载模式：用户已主动关闭悬浮窗，不自动显示');
            return;
        }
        
        // 如果已经使用悬浮条，不再重复创建
        if (isUsingFloatBar) return;
        
        // 如果悬浮条已存在，直接显示
        if (document.getElementById('siyuan-tomato-float-bar')) {
            isUsingFloatBar = true;
            return;
        }
        
        // 创建悬浮条
        if (createDraggableFloatBar()) {
            isUsingFloatBar = true;
            Logger.info('🍅 懒加载模式：计时开始，显示悬浮条');
        }
    }

    // ========== 霓虹样式管理器 ==========
    const NeonStyleManager = {
        // 获取呼吸速度对应的动画时长
        getBreathingDuration() {
            const speed = userSettings.appearance?.breathingSpeed || 'normal';
            const durations = { slow: '4s', normal: '3s', fast: '2s' };
            return durations[speed] || '3s';
        },
        
        // 更新CSS变量
        updateCSSVariables(themeKey) {
            const config = getThemeConfig(themeKey);
            const root = document.documentElement;
            
            // 设置CSS变量
            root.style.setProperty('--neon-start', config.gradientStart);
            root.style.setProperty('--neon-end', config.gradientEnd);
            root.style.setProperty('--neon-glow', config.glowColor);
            
            // 设置呼吸速度
            root.style.setProperty('--breathing-duration', this.getBreathingDuration());

            const minOpacity = Math.max(0.05, Math.min(1, Number(userSettings.appearance?.breathingMinOpacity ?? 0.5)));
            const maxOpacity = Math.max(0.05, Math.min(1, Number(userSettings.appearance?.breathingMaxOpacity ?? 1)));
            const finalMin = Math.min(minOpacity, maxOpacity);
            const finalMax = Math.max(minOpacity, maxOpacity);
            root.style.setProperty('--breathing-min-opacity', String(finalMin));
            root.style.setProperty('--breathing-max-opacity', String(finalMax));
            
            Logger.info('🎨 NeonStyleManager: CSS变量已更新', {
                theme: themeKey,
                start: config.gradientStart,
                end: config.gradientEnd,
                glow: config.glowColor,
                breathingDuration: this.getBreathingDuration(),
                breathingMinOpacity: finalMin,
                breathingMaxOpacity: finalMax
            });
        },
        
        // 刷新霓虹样式
        refresh() {
            const theme = getCurrentTheme();
            this.updateCSSVariables(theme);
            
            // 同时更新进度条元素的颜色
            this.updateProgressBarColors();
            this.updateIndicatorColors();
            this.updateNeonIntensity();
        },
        
        // 更新进度条填充颜色
        updateProgressBarColors() {
            const theme = getCurrentTheme();
            const config = getThemeConfig(theme);
            
            // 更新所有霓虹模式进度条
            const progressBars = document.querySelectorAll('.tomato-progress-bar.neon-mode');
            progressBars.forEach(bar => {
                bar.style.background = `linear-gradient(90deg, ${config.gradientStart}, ${config.gradientEnd})`;
            });
            
            // 更新预览条
            const previewBars = document.querySelectorAll('.tomato-preview-bar');
            previewBars.forEach(bar => {
                bar.style.background = `linear-gradient(90deg, ${config.gradientStart}, ${config.gradientEnd})`;
            });
        },
        
        // 更新霓虹发光强度
        updateNeonIntensity() {
            const intensity = userSettings.appearance?.neonIntensity || 0.8;
            const theme = getCurrentTheme();
            const config = getThemeConfig(theme);
            
            // 更新所有霓虹模式进度条的发光强度
            const progressBars = document.querySelectorAll('.tomato-progress-bar.neon-mode');
            progressBars.forEach(bar => {
                bar.style.boxShadow = `0 0 ${15 * intensity}px ${config.glowColor},
                                       0 0 ${30 * intensity}px ${config.glowColor},
                                       0 0 ${50 * intensity}px ${config.glowColor}`;
            });
            
            // 更新正计时模式进度条的发光强度
            const stopwatchColor = '#00C853';
            const allBars = document.querySelectorAll('.tomato-progress-bar');
            allBars.forEach(bar => {
                // 检查是否为正计时模式（没有 neon-mode 类但有 breathing 类或者在正计时状态）
                if (!bar.classList.contains('neon-mode') && userSettings.appearance?.enableStopwatchBar !== false) {
                    bar.style.boxShadow = `0 0 ${15 * intensity}px ${stopwatchColor},
                                           0 0 ${30 * intensity}px ${stopwatchColor},
                                           0 0 ${50 * intensity}px ${stopwatchColor}`;
                }
            });
        },
        
        // 更新指示器颜色
        updateIndicatorColors() {
            const theme = getCurrentTheme();
            const config = getThemeConfig(theme);
            
            // 更新指示器
            const indicators = document.querySelectorAll('.tomato-progress-indicator.neon-mode');
            indicators.forEach(indicator => {
                const text = indicator.querySelector('.progress-text');
                if (text) {
                    text.style.color = config.glowColor;
                    text.style.textShadow = `0 0 10px ${config.glowColor}, 0 0 20px ${config.glowColor}, 0 0 40px ${config.glowColor}`;
                }
            });
        }
    };
    
    // ========== 添加霓虹发光效果样式 ==========
    function addNeonStyles() {
        if (document.getElementById('tomato-neon-style')) {
            // 如果样式已存在，先移除它再重新添加（支持刷新）
            document.getElementById('tomato-neon-style').remove();
        }

        const theme = getCurrentTheme();
        const config = getThemeConfig(theme);
        
        // 更新CSS变量
        NeonStyleManager.updateCSSVariables(theme);
        
        const style = document.createElement('style');
        style.id = 'tomato-neon-style';
        style.textContent = `
            /* ===== 霓虹发光进度条样式 ===== */
            .tomato-progress-bar.neon-mode {
                height: 4px;
                border-radius: 2px;
                box-shadow: 0 0 15px var(--neon-glow, #ff6b9d),
                            0 0 30px var(--neon-glow, #ff6b9d),
                            0 0 50px var(--neon-glow, #c44569);
            }

            .tomato-progress-bar.neon-mode.breathing {
                animation: neonBreatheStrong var(--breathing-duration, 3s) ease-in-out infinite;
            }

            /* 正计时模式呼吸动画 - 性能优化版 */
            .tomato-progress-bar.breathing {
                animation: stopwatchBreathe var(--breathing-duration, 3s) ease-in-out infinite;
                will-change: opacity;
            }

            #tomato-timeline-bar .timeline-visual.breathing {
                animation: stopwatchBreathe var(--breathing-duration, 3s) ease-in-out infinite;
                will-change: opacity;
            }

            #tomato-timeline-bar .timeline-visual.neon-mode.breathing {
                animation: neonBreatheStrong var(--breathing-duration, 3s) ease-in-out infinite;
                will-change: opacity, transform;
                transform-origin: bottom;
            }

            #tomato-timeline-bar .timeline-viewport {
                scrollbar-width: none;
                -ms-overflow-style: none;
            }

            #tomato-timeline-bar .timeline-viewport::-webkit-scrollbar {
                height: 0;
                width: 0;
                display: none;
            }

            #tomato-timeline-bar .timeline-segment.breathing {
                animation: neonBreatheStrong var(--breathing-duration, 3s) ease-in-out infinite;
                will-change: opacity, transform;
                transform-origin: bottom;
            }

            @keyframes stopwatchBreathe {
                0%, 100% {
                    opacity: var(--breathing-min-opacity, 0.5);
                }
                50% {
                    opacity: var(--breathing-max-opacity, 1);
                }
            }

            @keyframes neonBreathe {
                0%, 100% {
                    opacity: var(--breathing-min-opacity, 0.5);
                }
                50% {
                    opacity: var(--breathing-max-opacity, 1);
                }
            }

            /* 增强版呼吸动画 - 性能优化版 */
            @keyframes neonBreatheStrong {
                0%, 100% {
                    opacity: var(--breathing-min-opacity, 0.5);
                    transform: scaleY(1);
                }
                50% {
                    opacity: var(--breathing-max-opacity, 1);
                    transform: scaleY(1.02);
                }
            }

            /* 完成动画 - 霓虹绽放 */
            .tomato-progress-bar.neon-mode.completing {
                animation: neonComplete 1.5s ease-out forwards;
            }

            @keyframes neonComplete {
                0% {
                    width: var(--current-width, 100%);
                    box-shadow: 0 0 10px var(--neon-start),
                                0 0 20px var(--neon-start);
                }
                50% {
                    width: 100%;
                    box-shadow: 0 0 30px var(--neon-start),
                                0 0 60px var(--neon-start),
                                0 0 90px var(--neon-end);
                    filter: brightness(1.5);
                }
                100% {
                    width: 100%;
                    box-shadow: 0 0 20px var(--neon-start),
                                0 0 40px var(--neon-start),
                                0 0 60px var(--neon-end);
                    filter: brightness(1.2);
                }
            }

            /* ===== 霓虹指示器样式 ===== */
            .tomato-progress-indicator.neon-mode {
                background: rgba(20, 20, 35, 0.95) !important;
                border: 1px solid var(--neon-glow, rgba(255, 107, 157, 0.4)) !important;
                box-shadow: 0 0 30px var(--neon-glow, rgba(255, 107, 157, 0.2)),
                            0 0 60px var(--neon-glow, rgba(255, 107, 157, 0.1)),
                            inset 0 0 30px rgba(0, 0, 0, 0.3) !important;
            }

            .tomato-progress-indicator.neon-mode .progress-text {
                color: var(--neon-glow, #ff6b9d) !important;
                text-shadow: 0 0 10px var(--neon-glow, #ff6b9d),
                             0 0 20px var(--neon-glow, #ff6b9d),
                             0 0 40px var(--neon-glow, #ff6b9d) !important;
                transition: all 0.3s ease;
            }

            /* 指示器呼吸动画 */
            .tomato-progress-indicator.neon-mode.breathing {
                animation: indicatorBreathe var(--breathing-duration, 3s) ease-in-out infinite;
            }

            .tomato-progress-indicator.neon-mode.breathing .progress-text {
                animation: textGlowBreathe var(--breathing-duration, 3s) ease-in-out infinite;
            }

            @keyframes indicatorBreathe {
                0%, 100% {
                    opacity: var(--breathing-min-opacity, 0.5);
                }
                50% {
                    opacity: var(--breathing-max-opacity, 1);
                }
            }

            @keyframes textGlowBreathe {
                0%, 100% {
                    opacity: var(--breathing-min-opacity, 0.5);
                }
                50% {
                    opacity: var(--breathing-max-opacity, 1);
                }
            }

            /* ===== 霓虹指示器箭头 ===== */
            .tomato-progress-indicator.neon-mode::before {
                content: '';
                position: absolute;
                top: -5px;
                left: 50%;
                transform: translateX(-50%);
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 5px solid currentColor;
            }

            /* ===== 外观设置页面样式 ===== */
            .tomato-theme-cards {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                margin-top: 10px;
            }

            .tomato-theme-card {
                flex: 1;
                min-width: 100px;
                max-width: 140px;
                border: 2px solid var(--b3-theme-surfaceVariant, #e0e0e0);
                border-radius: 8px;
                padding: 10px;
                cursor: pointer;
                transition: all 0.3s ease;
                background: var(--b3-theme-background, #fff);
            }

            .tomato-theme-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }

            .tomato-theme-card--active {
                border-color: var(--b3-theme-primary, #1E88E5);
                box-shadow: 0 0 0 3px rgba(30, 136, 229, 0.2);
            }

            .tomato-theme-preview {
                height: 40px;
                border-radius: 4px;
                margin-bottom: 8px;
            }

            .tomato-theme-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .tomato-theme-name {
                font-weight: bold;
                font-size: 13px;
                color: var(--b3-theme-onSurface, #333);
            }

            .tomato-theme-desc {
                font-size: 11px;
                color: var(--b3-theme-onSurfaceVariant, #666);
            }

            .tomato-preview-container {
                background: rgba(20, 20, 35, 0.9);
                border-radius: 12px;
                padding: 20px;
                margin-top: 15px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
            }

            .tomato-preview-progress {
                width: 100%;
                height: 12px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                overflow: visible;
                position: relative;
            }

            .tomato-preview-bar {
                height: 100%;
                background: linear-gradient(90deg, var(--neon-start, #ff6b9d), var(--neon-end, #c44569));
                border-radius: 6px;
                transition: all 0.3s ease;
            }

            /* 预览指示器 - 三角形 */
            .tomato-preview-indicator {
                position: absolute;
                top: -12px;
                left: 60%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 6px solid var(--neon-glow, #ff6b9d);
                filter: drop-shadow(0 -2px 4px var(--neon-glow, rgba(255, 107, 157, 0.5)));
                transition: left 0.3s ease-out;
            }

            .tomato-preview-indicator.breathing {
                animation: previewIndicatorBreathe var(--breathing-duration, 3s) ease-in-out infinite;
            }

            @keyframes previewIndicatorBreathe {
                0%, 100% {
                    opacity: 0.4;  // 较暗
                }
                50% {
                    opacity: 1;   // 最亮
                }
            }

            .tomato-preview-bar--completing {
                animation: previewComplete 1.5s ease-out forwards;
            }

            @keyframes previewComplete {
                0% { width: 60%; box-shadow: none; }
                50% { width: 100%; box-shadow: 0 0 30px #ff6b9d, 0 0 60px #c44569; }
                100% { width: 100%; box-shadow: 0 0 20px #ff6b9d; }
            }

            .tomato-preview-text {
                color: var(--neon-glow, #fff);
                font-size: 28px;
                font-weight: bold;
                text-shadow: 0 0 10px var(--neon-glow, #ff6b9d),
                             0 0 20px var(--neon-glow, #ff6b9d);
                font-family: 'SF Mono', 'Consolas', monospace;
            }

            .tomato-preview--breathing .tomato-preview-bar {
                animation: previewBreatheStrong var(--breathing-duration, 3s) ease-in-out infinite;
            }

            @keyframes previewBreatheStrong {
                0%, 100% { 
                    opacity: 0.5;   // 较暗
                    transform: scaleX(1);
                }
                50% { 
                    opacity: 1;    // 最亮
                    transform: scaleX(1.01);
                }
            }

            /* 进度条背景发光 */
            .tomato-progress-bar-wrapper.neon-mode {
                position: relative;
            }

            .tomato-progress-bar-wrapper.neon-mode::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: inherit;
                filter: blur(10px);
                opacity: 0.5;
                z-index: -1;
            }
        `;

        document.head.appendChild(style);
    }

    // 添加悬浮条动画样式
    function addFloatBarStyle() {
        if (document.getElementById('tomato-float-bar-style')) return;

        const style = document.createElement('style');
        style.id = 'tomato-float-bar-style';
        style.textContent = `
            @keyframes tomatoSlideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }
            #siyuan-tomato-float-bar.running {
                border-color: var(--b3-theme-primary, #1E88E5);
            }
            #siyuan-tomato-float-bar.running .tomato-float-ctrl-btn {
                background: var(--b3-theme-primary, #1E88E5) !important;
            }
            #siyuan-tomato-float-bar:active {
                cursor: grabbing !important;
            }
            /* 拖动时不显示脉冲动画，避免抖动 */
            #siyuan-tomato-float-bar.dragging {
                animation: none !important;
                box-shadow: 0 6px 20px rgba(0,0,0,0.3) !important;
            }
            /* 移动端历史记录对话框样式 */
            @media (max-width: 768px) {
                .tomato-history-stat-card {
                    padding: 12px !important;
                }
                .tomato-history-stat-value {
                    font-size: 24px !important;
                }
                .tomato-history-stat-label {
                    font-size: 12px !important;
                }
                .tomato-history-record-item {
                    padding: 10px 12px !important;
                    font-size: 13px !important;
                }
                .tomato-history-time {
                    font-size: 11px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function createWidget(statusBar) {
        if (container?.parentNode === statusBar) return;
        if (container?.parentNode) container.remove();

        container = document.createElement('div');
        container.id = 'siyuan-tomato-timer';
        container.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            margin-left: 12px;
            font-size: 13px;
            pointer-events: auto;
            position: relative;
        `;

        // 任务块关联图标（默认隐藏）
        const taskBlockIcon = document.createElement('span');
        taskBlockIcon.id = 'tomy-task-block-icon';
        taskBlockIcon.innerHTML = '📋️';
        taskBlockIcon.style.cssText = `
            cursor: pointer;
            font-size: 14px;
            display: none;
            position: relative;
            transition: transform 0.2s;
        `;
        taskBlockIcon.title = '查看关联任务';
        container.appendChild(taskBlockIcon);

        // 任务块信息提示框
        const taskBlockTooltip = document.createElement('div');
        taskBlockTooltip.id = 'tomy-task-block-tooltip';
        taskBlockTooltip.innerHTML = `
            <div style="padding: 8px 12px; background: var(--b3-theme-surface); border-radius: 6px;
                 box-shadow: 0 2px 8px rgba(0,0,0,0.15); font-size: 12px; width: 150px;
                 display: flex; flex-direction: column; gap: 6px;">
                <button id="tomy-tooltip-delete-btn" style="
                    padding: 2px 8px; font-size: 11px; align-self: flex-start;
                    background: var(--b3-theme-error); color: white;
                    border: none; border-radius: 3px; cursor: pointer;
                ">清除</button>
                <span id="tomy-tooltip-task-name" style="
                    word-break: break-word;
                    line-height: 1.3;
                    cursor: pointer;
                    padding: 2px 4px;
                    border-radius: 3px;
                    transition: background-color 0.2s;
                    display: inline-block;
                "></span>
            </div>
        `;
        taskBlockTooltip.style.cssText = `
            display: none;
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-bottom: 8px;
            z-index: 1000;
        `;
        container.appendChild(taskBlockTooltip);

        // 图标交互
        let tooltipTimeout = null;
        taskBlockIcon.onmouseenter = () => {
            clearTimeout(tooltipTimeout);
            updateTaskBlockTooltip();
            setupWidgetTaskLinkListener(); // 设置事件委托，和历史记录一致
            taskBlockTooltip.style.display = 'block';
        };
        taskBlockIcon.onmouseleave = () => {
            tooltipTimeout = setTimeout(() => {
                taskBlockTooltip.style.display = 'none';
            }, 300);
        };
        taskBlockTooltip.onmouseenter = () => {
            clearTimeout(tooltipTimeout);
        };
        taskBlockTooltip.onmouseleave = () => {
            taskBlockTooltip.style.display = 'none';
        };

        // 删除按钮事件
        const deleteBtn = taskBlockTooltip.querySelector('#tomy-tooltip-delete-btn');
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            // 先清除当前记录中的关联
            await clearCurrentRecordAssociation();
            // 清除任务块关联
            currentTaskBlockId = null;
            currentTaskBlockName = null;
            clearTaskBlockHighlight();
            stopHighlightKeepAlive(); // 停止保持高亮的定时器
            taskBlockTooltip.style.display = 'none';
            taskBlockIcon.style.display = 'none';
            // 更新显示
            updateDisplay();
        };

        timeDisplay = document.createElement('span');
        timeDisplay.style.cssText = `position: relative; cursor: default; user-select: none;`;

        // 🔧 新增：电脑端鼠标悬停显示今日完成情况
        if (!isMobileDevice()) {

            // 创建悬浮窗元素
            const createTooltip = () => {
                const tooltip = document.createElement('div');
                tooltip.id = 'tomy-tomato-tooltip';
                tooltip.style.cssText = `
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: var(--b3-theme-background, #fff);
                    border: 1px solid var(--b3-theme-surface-light, #e0e0e0);
                    border-radius: 6px;
                    padding: 8px 12px;
                    font-size: 12px;
                    color: var(--b3-theme-on-background, #333);
                    white-space: nowrap;
                    max-width: 150px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    z-index: 1000;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    margin-bottom: 8px;
                `;
                return tooltip;
            };

            // 计算今日已完成专注时间（分钟）- 复用统计图表的逻辑
            const getTodayCompletedMinutes = async () => {
                try {
                    const records = await loadHistoryRecords();
                    const today = formatDateKey(new Date());
                    const todayRecords = records.filter(r => {
                        const recordDate = r.date || formatDateKey(r.start);
                        return recordDate === today;
                    });

                    // 倒计时模式（排除休息）
                    const tomatoRecords = todayRecords.filter(r =>
                        r.mode === 'countdown' && r.durationSec >= 60
                    );
                    const tomatoMinutes = tomatoRecords.reduce((sum, r) => sum + r.durationMin, 0);

                    // 正计时模式
                    const stopwatchRecords = todayRecords.filter(r => r.mode === 'stopwatch');
                    const stopwatchMinutes = stopwatchRecords.reduce((sum, r) => sum + r.durationMin, 0);

                    return tomatoMinutes + stopwatchMinutes;
                } catch (e) {
                    Logger.warn('获取今日番茄钟记录失败:', e);
                    return 0;
                }
            };

            // 更新悬浮窗内容
            const updateTooltipContent = async (tooltip) => {
                const completedMinutes = await getTodayCompletedMinutes();
                const targetMinutes = userSettings.dailyFocusTargetMinutes || 180;
                const completedHours = (completedMinutes / 60).toFixed(1);
                const targetHours = (targetMinutes / 60).toFixed(1);
                tooltip.innerHTML = `已专注${completedHours}小时/目标${targetHours}小时`;
            };

            // 🔧 修复：悬浮提示框逻辑优化
            // 计时进行中，由于时间每秒更新，可能会导致 timeDisplay 重绘或事件失效
            // 将 tooltip 附加到 document.body 而不是 timeDisplay 内部，避免被父元素更新影响
            
            let tooltipTimeout;

            timeDisplay.onmouseenter = async (e) => {
                if (tooltipTimeout) clearTimeout(tooltipTimeout);

                let tooltipEl = document.getElementById('tomy-tomato-tooltip');
                if (!tooltipEl) {
                    tooltipEl = createTooltip();
                    // 🔧 修复：将 tooltip 挂载到 body 上，避免被状态栏重绘影响
                    document.body.appendChild(tooltipEl);
                }
                
                await updateTooltipContent(tooltipEl);
                
                // 🔧 修复：根据鼠标位置或元素位置定位 tooltip
                const rect = timeDisplay.getBoundingClientRect();
                tooltipEl.style.position = 'fixed';
                tooltipEl.style.bottom = (window.innerHeight - rect.top - 4) + 'px'; // 减小间距，让提示框更靠近底部状态栏
                tooltipEl.style.left = (rect.left + rect.width / 2) + 'px';
                tooltipEl.style.transform = 'translateX(-50%)';
                tooltipEl.style.zIndex = '2147483647';
                
                tooltipEl.style.opacity = '1';
                tooltipEl.style.visibility = 'visible';
            };

            timeDisplay.onmouseleave = () => {
                const tooltipEl = document.getElementById('tomy-tomato-tooltip');
                if (tooltipEl) {
                    tooltipTimeout = setTimeout(() => {
                        tooltipEl.style.opacity = '0';
                        tooltipEl.style.visibility = 'hidden';
                        setTimeout(() => {
                            if (tooltipEl.parentNode && tooltipEl.style.opacity === '0') {
                                tooltipEl.remove();
                            }
                        }, 200);
                    }, 100); // 给一点延迟，防止快速划过时闪烁
                }
            };
        }

        controlButton = document.createElement('button');
        controlButton.innerHTML = '▶️';
        controlButton.style.cssText = `
            width: 24px; height: 24px; padding: 0; margin: 0; border: none !important;
            background: transparent !important; color: var(--b3-theme-on-surface);
            font-size: 14px; cursor: pointer; display: flex; align-items: center;
            justify-content: center; -webkit-appearance: none; appearance: none;
            outline: none; box-shadow: none; user-select: none;
        `;

        controlButton.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isRunning) {
                pauseTimer().catch(Logger.error);
            } else {
                startTimer().catch(Logger.error);
            }
        };

        let isRightClick = false, longPressTimer = null;
        EventManager.add(container, 'mousedown', (e) => {
            if (e.button !== 2) return;
            isRightClick = true;
            longPressTimer = setTimeout(() => {
                resetCurrentMode();
                isRightClick = false;
            }, 500);
        });

        EventManager.add(container, 'mouseup', (e) => {
            if (!isRightClick) return;
            clearTimeout(longPressTimer);
            if (e.button === 2) {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY);
            }
            isRightClick = false;
        });

        EventManager.add(container, 'contextmenu', (e) => {
            if (isRightClick) e.preventDefault();
        });

        container.appendChild(timeDisplay);
        container.appendChild(controlButton);
        statusBar.appendChild(container);
        updateDisplay();
    }

    // 更新任务块提示框内容 - 完全按照历史记录的逻辑实现
    function updateTaskBlockTooltip() {
        const tooltip = document.getElementById('tomy-task-block-tooltip');
        const taskName = document.getElementById('tomy-tooltip-task-name');
        
        // 使用全局变量或局部变量
        const blockId = window.currentTaskBlockId || currentTaskBlockId;
        const blockName = window.currentTaskBlockName || currentTaskBlockName;
        
        Logger.info('🔍 updateTaskBlockTooltip: blockId =', blockId, ', blockName =', blockName);
        
        if (tooltip && taskName && blockName) {
            // 使用 data-block-id 属性存储块ID，和历史记录完全一致
            taskName.setAttribute('data-block-id', blockId);
            taskName.className = 'tomato-task-link'; // 使用和历史记录相同的类名
            taskName.textContent = '📋️ ' + blockName;
            taskName.title = '点击跳转到任务块位置';

            // 添加悬浮效果样式
            taskName.onmouseenter = () => {
                taskName.style.backgroundColor = 'var(--b3-theme-surface-light)';
                taskName.style.textDecoration = 'underline';
            };
            taskName.onmouseleave = () => {
                taskName.style.backgroundColor = 'transparent';
                taskName.style.textDecoration = 'none';
            };
        } else {
            Logger.warn('🔍 updateTaskBlockTooltip: tooltip 或 taskName 不存在，或 blockName 为空');
        }
    }
    
    // 悬浮窗任务块点击事件 - 完全复制历史记录的 setupTaskLinkListeners 模式
    function setupWidgetTaskLinkListener() {
        // 使用容器元素（和历史记录一样）
        const container = document.getElementById('siyuan-tomato-timer');
        if (!container) return;

        // 移除旧的事件监听器，避免重复
        EventManager.removeByContext('widget-task-link');

        // 完全复制历史记录的事件委托逻辑
        EventManager.add(container, 'click', (e) => {
            const link = e.target.closest('[data-block-id]');
            if (link) {
                // 🔧 修复：阻止默认行为和事件冒泡，防止触发聚焦
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                // 🔧 移动端禁用任务块跳转功能（用户脚本无法使用 openBlock API，且可能导致死机）
                // ⚠️ 改进：只针对明确的移动端设备（Android/iOS/HarmonyOS）禁用，避免误伤触屏电脑
                const ua = navigator.userAgent;
                const isExplicitMobile = /Android|iPhone|iPad|iPod/i.test(ua);
                const isHarmonyMobile = /HarmonyOS/i.test(ua) && isMobileDevice();
                
                if (isExplicitMobile || isHarmonyMobile) {
                    Logger.info('🖱️ 移动端悬浮窗点击任务链接，但用户脚本无法使用 openBlock API，且可能导致死机，跳过跳转');
                    return;
                }

                const blockId = link.getAttribute('data-block-id');
                if (blockId) {
                    Logger.info('🖱️ 悬浮窗点击任务链接, blockId:', blockId);
                    // 完全复用历史记录的 navigateToBlock 函数
                    navigateToBlock(blockId);
                } else {
                    Logger.warn('🖱️ 悬浮窗点击任务链接，但 blockId 为空');
                }
            }
        }, {}, 'widget-task-link');

        Logger.info('✅ 悬浮窗任务链接事件委托已设置');
    }

    // 更新任务块图标显示状态
    function updateTaskBlockIcon() {
        const icon = document.getElementById('tomy-task-block-icon');
        if (icon) {
            icon.style.display = currentTaskBlockId ? 'inline' : 'none';
        }
    }
    
    // ========== 数据库点击追踪 ==========
    // 记录用户最后点击的数据库单元格
    let lastClickedDatabaseCell = null;
    let lastRightClickedDatabaseCell = null;
    
    // 监听数据库单元格的左键点击事件（简化版）
    EventManager.addDocumentClick((e) => {
        const cell = e.target.closest('.av__cell');
        if (cell) {
            const row = cell.closest('[data-row-id]');
            if (row) {
                lastClickedDatabaseCell = {
                    rowId: row.dataset.rowId,
                    timestamp: Date.now()
                };
            }
        }
    }, true); // 使用捕获阶段确保能捕获到
    
    // 🔧 关键修复：在多个容器上监听 contextmenu 事件
    // 兼容表格、画廊、看板三种视图
    function setupDatabaseContextmenuListener() {
        // 查找 block-ref 的通用函数
        const findBlockRefFromEvent = (target, av, event) => {
            let blockRef = null;

            // 方式1：直接从点击目标向上查找
            blockRef = target.closest('[data-type="block-ref"]');
            
            // 方式2：如果没找到，尝试在表格视图的 .av__row 中查找
            if (!blockRef) {
                const row = target.closest('.av__row');
                if (row) {
                    blockRef = row.querySelector('[data-type="block-ref"]');
                }
            }

            // 方式3：如果没找到，尝试在画廊视图的 .av__gallery-item 中查找
            if (!blockRef) {
                const galleryItem = target.closest('.av__gallery-item');
                if (galleryItem) {
                    blockRef = galleryItem.querySelector('[data-type="block-ref"]');
                }
            }

            // 方式4：如果没找到，尝试在看板视图的 .av__kanban-item 中查找
            if (!blockRef) {
                const kanbanItem = target.closest('.av__kanban-item');
                if (kanbanItem) {
                    blockRef = kanbanItem.querySelector('[data-type="block-ref"]');
                }
            }

            // 方式5：如果仍然没找到，尝试在 av 容器中找到最近的 block-ref（基于点击位置）
            if (!blockRef && av && event) {
                const allBlockRefs = av.querySelectorAll('[data-type="block-ref"]');
                for (const ref of allBlockRefs) {
                    const rect = ref.getBoundingClientRect();
                    // 检查点击位置是否在该 block-ref 的范围内
                    if (event.clientX >= rect.left && event.clientX <= rect.right &&
                        event.clientY >= rect.top && event.clientY <= rect.bottom) {
                        blockRef = ref;
                        break;
                    }
                }
            }
 
            return blockRef;
        };

        // 更新 lastRightClickedDatabaseCell 的通用函数
        const updateDatabaseCellInfo = (target, eventType = 'click', event = null) => {
            const av = target.closest('.av');
            if (!av) return;

            const avId = av.dataset.avId;
            const blockRef = findBlockRefFromEvent(target, av, event);

            if (!blockRef || !blockRef.dataset?.id) {
                lastRightClickedDatabaseCell = null;
                return;
            }

            const foundBlockId = blockRef.dataset.id;
            const taskName = blockRef.textContent?.trim();

            // 获取行的 rowId（表格视图）
            const row = target.closest('.av__row');
            const rowId = row?.dataset?.rowId;

            // 记录信息
            lastRightClickedDatabaseCell = {
                rowId: rowId,
                blockId: foundBlockId,
                avId: avId,
                taskName: taskName || null,
                timestamp: Date.now()
            };
            lastClickedDatabaseCell = lastRightClickedDatabaseCell;

            Logger.info(`🍅 数据库单元格${eventType}事件: blockId=${foundBlockId}, taskName=${taskName}`);
        };

        const contextmenuHandler = (e) => {
            updateDatabaseCellInfo(e.target, 'contextmenu', e);

            // 延迟触发菜单检测
            setTimeout(() => {
                const menuContainer = document.querySelector('#commonMenu');
                const menuItems = menuContainer?.querySelector('.b3-menu__items');
                const openByBtn = menuItems?.querySelector('button[data-id="openBy"]');
                const unbindBlockBtn = menuItems?.querySelector('button[data-id="unbindBlock"]');
                const existingMenu = menuItems?.querySelector('.tomato-start-from-db');

                if (menuContainer && menuItems && openByBtn && unbindBlockBtn) {
                    if (existingMenu) {
                        document.getElementById('tomato-db-submenu')?.remove();
                        existingMenu.remove();
                    }
                    handleDatabaseMenu(menuItems, openByBtn);
                }
            }, 50);
        };
        
        // 🔧 新增：移动端点击事件监听器
        // 移动端没有 contextmenu 事件，需要通过点击来记录选中的数据库单元格
        const clickHandler = (e) => {
            // 排除菜单点击
            if (e.target.closest('#commonMenu')) return;
            
            // 更新数据库单元格信息
            updateDatabaseCellInfo(e.target, 'click', e);
        };

        // 在多个容器上添加监听器
        const containers = [
            document,
            document.querySelector('.protyle-wysiwyg'),
            document.querySelector('.protyle-content'),
            document.querySelector('#commonMenu'),
            document.querySelector('.av'),
            document.querySelector('.av__body')
        ].filter(Boolean);
        
        containers.forEach(container => {
            try {
                container.addEventListener('contextmenu', contextmenuHandler, true);
                // 🔧 添加点击事件监听（用于移动端）
                container.addEventListener('click', clickHandler, true);
            } catch (e) {
                Logger.error('❌ 添加事件监听器失败:', e);
            }
        });
    }
    
    setupDatabaseContextmenuListener();
    
    // ========== 任务块菜单功能 ==========
    
    // 等待元素出现
    function whenElementExist(selector, node) {
        return new Promise(resolve => {
            const check = () => {
                const el = typeof selector === 'function' ? selector() : (node || document).querySelector(selector);
                el ? resolve(el) : requestAnimationFrame(check);
            };
            check();
        });
    }

    // 获取选中的块
    // ✅ 修复版本：获取选中的块 - 增强单个父任务的支持
    function getSelectedBlocks(isTitleMenu) {
        if (isTitleMenu) {
            const docTitleEl = document.querySelector('.protyle-title');
            const docId = docTitleEl?.dataset?.nodeId;
            const docTitle = docTitleEl?.querySelector('.protyle-title__input')?.textContent;
            return [{
                dataset: { nodeId: docId },
                textContent: docTitle,
            }];
        } else {
            const blocks = document.querySelectorAll('.protyle-wysiwyg--select');
            Logger.info('🔍 getSelectedBlocks: 找到的选中块数量:', blocks.length);
            
            return [...blocks].map(block => {
                Logger.info('🔍 getSelectedBlocks: 处理选中块，类型:', block.className, 'data-node-id:', block.dataset?.nodeId);
                
                // 如果已经是.li元素，直接返回
                if (block.matches('.li')) {
                    Logger.info('✅ getSelectedBlocks: block本身就是.li');
                    return block;
                }
                
                // 🔧 修复：尝试多种方式找到.li元素
                
                // 方式1：查找包含选中样式的.li元素
                const selectedLi = block.querySelector('.li.protyle-wysiwyg--select');
                if (selectedLi) {
                    Logger.info('✅ getSelectedBlocks: 找到包含选中样式的.li');
                    return selectedLi;
                }
                
                // 方式2：如果.block是.list容器，尝试获取第一个.li子元素
                if (block.matches('.list')) {
                    const firstLi = block.querySelector(':scope > .li[data-node-id]');
                    if (firstLi) {
                        Logger.info('✅ getSelectedBlocks: 从.list获取第一个.li子元素');
                        return firstLi;
                    }
                }
                
                // 方式3：向上查找最近的.li[data-node-id]祖先
                const parentLi = block.closest('.li[data-node-id]');
                if (parentLi) {
                    Logger.info('✅ getSelectedBlocks: 向上找到.li祖先');
                    return parentLi;
                }
                
                // 方式4：如果.block本身有data-node-id且是.li，尝试获取自身
                if (block.dataset?.nodeId && (block.matches('[data-type="NodeListItem"]') || block.classList.contains('li'))) {
                    Logger.info('✅ getSelectedBlocks: block本身就是.li元素');
                    return block;
                }
                
                // 方式5：向上遍历DOM树，找到第一个.li[data-node-id]祖先
                let ancestor = block.parentElement;
                let depth = 0;
                while (ancestor && depth < 10) {  // 限制遍历深度
                    if (ancestor.classList.contains('li') && ancestor.dataset?.nodeId) {
                        Logger.info('✅ getSelectedBlocks: 向上遍历找到.li元素，深度:', depth);
                        return ancestor;
                    }
                    ancestor = ancestor.parentElement;
                    depth++;
                }
                
                Logger.info('⚠️ getSelectedBlocks: 所有方式都失败，返回原block');
                // 其他情况直接返回
                return block;
            });
        }
    }

    // 高亮显示当前计时关联的任务块
    // ✅ 修复：添加 quiet 参数以减少日志输出（保持高亮时不需要日志）
    // 🔧 扩展：支持数据库块引用高亮
    // 🔧 移动端禁用：避免高亮CSS干扰悬浮条拖动
    function highlightTaskBlock(blockId, quiet = false) {
        // 移动端禁用高亮，避免影响悬浮条触摸事件
        if (isMobileDevice()) {
            return;
        }
        
        if (!blockId) {
            if (!quiet) Logger.info('🔍 高亮任务块: 未提供 blockId');
            return;
        }

        if (!quiet) Logger.info('🔍 尝试高亮任务块:', blockId);

        // 移除之前的高亮（同时清除任务块和数据库行高亮）
        document.querySelectorAll('.tomato-task-highlight').forEach(el => {
            el.classList.remove('tomato-task-highlight');
        });
        document.querySelectorAll('.tomato-db-row-highlight').forEach(el => {
            el.classList.remove('tomato-db-row-highlight');
        });

        // 优先在编辑器区域内查找，排除面包屑
        // 面包屑的父容器是 .protyle-breadcrumb，需要排除
        const editorArea = document.querySelector('.protyle-wysiwyg, .protyle-content');
        
        if (editorArea) {
            // 在编辑器区域内查找.li元素（任务块）
            const liElement = editorArea.querySelector(`.li[data-node-id="${blockId}"]`);
            
            if (liElement) {
                liElement.classList.add('tomato-task-highlight');
                if (!quiet) Logger.info('✅ 任务块(.li)高亮已添加:', blockId);
                
                // 滚动到任务块（保持高亮时不需要滚动）
                if (!quiet) {
                    try {
                        liElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } catch (e) {
                        // 忽略滚动错误
                    }
                }
                return;
            }
            
            // 如果没找到.li，查找.p元素
            const pElement = editorArea.querySelector(`.p[data-node-id="${blockId}"]`);
            
            if (pElement) {
                pElement.classList.add('tomato-task-highlight');
                if (!quiet) Logger.info('✅ 任务段落(.p)高亮已添加:', blockId);
                
                // 滚动到任务段落（保持高亮时不需要滚动）
                if (!quiet) {
                    try {
                        pElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } catch (e) {
                        // 忽略滚动错误
                    }
                }
                return;
            }
        }
        
        // 备选方案：全局查找但排除面包屑
        const allElements = document.querySelectorAll(`[data-node-id="${blockId}"]`);
        
        for (const el of allElements) {
            // 排除面包屑区域
            if (el.closest('.protyle-breadcrumb')) continue;
            
            el.classList.add('tomato-task-highlight');
            if (!quiet) Logger.info('✅ 任务块高亮已添加:', blockId);
            
            // 滚动到任务块（保持高亮时不需要滚动）
            if (!quiet) {
                try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (e) {
                    // 忽略滚动错误
                }
            }
            break;
        }

        // 🔧 新增：支持数据库块引用高亮
        // 当传入的 blockId 是数据库单元格中块引用的 ID 时
        // 需要查找该引用并高亮整个单元格
        if (!document.querySelector('.tomato-task-highlight')) {
            if (!quiet) Logger.info('🔍 未找到直接元素，尝试数据库块引用方式:', blockId);

            // 查找数据库单元格中的块引用
            const blockRef = document.querySelector(`.av__cell [data-type="block-ref"][data-id="${blockId}"]`);

            if (blockRef) {
                if (!quiet) Logger.info('✅ 找到数据库块引用:', blockRef);

                // 获取单元格容器
                const cellContainer = blockRef.closest('.av__cell');
                if (cellContainer) {
                    cellContainer.classList.add('tomato-task-highlight');
                    if (!quiet) Logger.info('✅ 数据库单元格高亮已添加');

                    // 滚动到单元格（保持高亮时不需要滚动）
                    if (!quiet) {
                        try {
                            cellContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        } catch (e) {
                            // 忽略滚动错误
                        }
                    }
                    return;
                }
            }

            // 如果是标题块引用
            const titleBlockRef = document.querySelector(`[data-type="block-ref"][data-id="${blockId}"]`);
            if (titleBlockRef) {
                if (!quiet) Logger.info('✅ 找到标题块引用:', titleBlockRef);

                // 尝试高亮引用本身或其父容器
                titleBlockRef.classList.add('tomato-task-highlight');
                if (!quiet) Logger.info('✅ 标题块引用高亮已添加');
                return;
            }
        }

        if (!quiet && !document.querySelector('.tomato-task-highlight')) {
            Logger.info('⚠️ 未能高亮任务块，可能原因：');
            Logger.info('  - 块在其他文档中，需要跳转后才能高亮');
            Logger.info('  - 块类型不支持高亮');
        }
    }

    // 启动保持高亮的定时器
    function startHighlightKeepAlive() {
        // 清除之前的定时器
        if (taskBlockHighlightInterval) {
            clearInterval(taskBlockHighlightInterval);
        }

        // 🔧 性能优化：改为 2000ms 间隔，只在高亮丢失时重新应用
        taskBlockHighlightInterval = setInterval(() => {
            // 如果没有任务块ID，停止定时器
            if (!currentTaskBlockId) {
                stopHighlightKeepAlive();
                return;
            }

            // 检测任务块元素是否还存在
            const blockElement = findBlockElement(currentTaskBlockId);
            if (!blockElement) {
                stopHighlightKeepAlive();
                return;
            }

            // 🔧 性能优化：只在高亮丢失时重新应用
            if (!blockElement.classList.contains('tomato-task-highlight')) {
                highlightTaskBlock(currentTaskBlockId, true);
            }
        }, 2000);  // 🔧 性能优化：从 500ms 改为 2000ms
    }

    // 停止保持高亮的定时器
    function stopHighlightKeepAlive() {
        if (taskBlockHighlightInterval) {
            clearInterval(taskBlockHighlightInterval);
            taskBlockHighlightInterval = null;
        }
    }

    // 清除任务块高亮
    function clearTaskBlockHighlight() {
        document.querySelectorAll('.tomato-task-highlight').forEach(el => {
            el.classList.remove('tomato-task-highlight');
        });
        // 同时清除数据库行高亮
        document.querySelectorAll('.tomato-db-row-highlight').forEach(el => {
            el.classList.remove('tomato-db-row-highlight');
        });
    }

    /**
     * 高亮数据库中的特定行
     * @param {string} blockId - 要高亮的块的ID
     * @param {number} maxRetries - 最大重试次数
     * @param {number} retryInterval - 重试间隔（毫秒）
     * @returns {boolean} 是否成功高亮
     */
    // ========== 数据库行高亮函数 ==========
    // 高亮整个单元格，而不是只高亮文字部分
    // 🔧 移动端禁用：避免高亮CSS干扰悬浮条拖动
    function highlightDatabaseRow(blockId, maxRetries = 3, retryInterval = 200) {
        // 移动端禁用高亮，避免影响悬浮条触摸事件
        if (isMobileDevice()) {
            return false;
        }
        
        if (!blockId) {
            Logger.info('⚠️ highlightDatabaseRow: blockId 为空，跳过高亮');
            return false;
        }

        Logger.info('🔍 highlightDatabaseRow 开始查找:', blockId);

        // 清除之前的高亮
        document.querySelectorAll('.tomato-db-row-highlight').forEach(el => {
            el.classList.remove('tomato-db-row-highlight');
        });

        const tryHighlight = (attempt = 1) => {
            Logger.info(`🔍 第 ${attempt} 次尝试查找 block-ref`);
            
            // 查找 block-ref 元素
            const blockRef = document.querySelector(`[data-type="block-ref"][data-id="${blockId}"]`);
            
            if (!blockRef) {
                Logger.info(`🔍 第 ${attempt} 次尝试：未找到 block-ref`);
                if (attempt < maxRetries) {
                    setTimeout(() => tryHighlight(attempt + 1), retryInterval);
                } else {
                    Logger.warn('⚠️ 达到最大重试次数，未找到 block-ref');
                }
                return false;
            }

            Logger.info('✅ 找到 block-ref');

            // 向上遍历 DOM 树，找到合适的高亮容器
            let highlightTarget = null;
            let currentElement = blockRef.parentElement;
            let depth = 0;
            
            // 向上遍历最多 5 层，找到合适的容器
            while (currentElement && depth < 5) {
                const className = currentElement.className || '';
                
                // 优先级1：.av__cell（表格视图的单元格）
                if (className.includes('av__cell')) {
                    highlightTarget = currentElement;
                    Logger.info('✅ 找到 .av__cell');
                    break;
                }
                
                // 优先级2：.av__row（表格视图的行）
                if (className.includes('av__row')) {
                    if (!highlightTarget) {
                        highlightTarget = currentElement;
                        Logger.info('✅ 找到 .av__row 作为后备');
                    }
                }
                
                // 优先级3：.av__gallery-item（画廊视图的卡片）
                if (className.includes('av__gallery-item')) {
                    if (!highlightTarget) {
                        highlightTarget = currentElement;
                        Logger.info('✅ 找到 .av__gallery-item');
                    }
                }
                
                // 优先级4：.av__kanban-item（看板视图的卡片）
                if (className.includes('av__kanban-item')) {
                    if (!highlightTarget) {
                        highlightTarget = currentElement;
                        Logger.info('✅ 找到 .av__kanban-item');
                    }
                }
                
                currentElement = currentElement.parentElement;
                depth++;
            }

            // 如果找到了容器，高亮它
            if (highlightTarget) {
                highlightTarget.classList.add('tomato-db-row-highlight');
                Logger.info(`✅ 高亮容器: ${highlightTarget.className}`);
            } else {
                // 最后的后备：高亮 block-ref 本身
                blockRef.classList.add('tomato-db-row-highlight');
                Logger.info('✅ 高亮 block-ref 本身');
            }

            // 滚动到可见区域
            try {
                const scrollTarget = highlightTarget || blockRef;
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e) {
                // 忽略滚动错误
            }

            return true;
        };

        return tryHighlight();
    }

    // 滚动到任务块位置
    function scrollToTaskBlock(blockId) {
        Logger.warn('[番茄钟] scrollToTaskBlock 被调用, blockId:', blockId);

        if (!blockId) {
            Logger.warn('[番茄钟] 滚动失败: 未提供 blockId');
            return;
        }

        // 检查当前是否有任务块关联
        if (!currentTaskBlockId) {
            Logger.warn('[番茄钟] 滚动失败: 当前没有关联的任务块');
            alert('当前没有关联的任务块，请先通过菜单关联一个任务块');
            return;
        }

        Logger.warn('[番茄钟] 准备跳转到块:', blockId);

        // 方法1：尝试查找 DOM 中的 block-ref 元素并点击
        const blockRef = document.querySelector(`[data-type="block-ref"][data-id="${blockId}"]`);
        if (blockRef) {
            Logger.warn('[番茄钟] ✅ 找到 block-ref 元素，模拟点击');
            blockRef.click();
            return;
        }

        // 方法2：尝试查找任何包含该 ID 的块元素并点击
        const blockElement = document.querySelector(`[data-node-id="${blockId}"]`);
        if (blockElement) {
            Logger.warn('[番茄钟] ✅ 找到块元素，滚动并高亮');
            blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            blockElement.classList.add('tomato-task-highlight');
            setTimeout(() => {
                blockElement.classList.remove('tomato-task-highlight');
            }, 2000);
            return;
        }

        if (__canUseOfficialOpenBlock()) {
            __openBlockByOfficialApi(blockId);
            return;
        }

        // 方法3：使用 URL scheme（移动端兼容）
        try {
            const siyuanUrl = `siyuan://blocks/${blockId}`;
            Logger.warn('[番茄钟] 尝试 URL scheme 跳转:', siyuanUrl);
            
            // 🔧 修复：移动端必须保存状态后再跳转
            if (isRunning) {
                Logger.info('💾 移动端跳转前保存计时器状态...');
                saveTimerState();
            }
            
            // 使用 location.href 跳转（移动端更可靠）
            window.location.href = siyuanUrl;
            
            return;
        } catch (e) {
            Logger.warn('[番茄钟] URL scheme 跳转失败:', e);
        }

        // 方法4：使用思源 API
        if (window.siyuan?.block?.scrollToBlock) {
            try {
                window.siyuan.block.scrollToBlock(blockId);
                Logger.warn('[番茄钟] ✅ 使用 siyuan.block.scrollToBlock 跳转成功');
                return;
            } catch (e) {
                Logger.error('[番茄钟] ❌ scrollToBlock API 失败:', e);
            }
        } else {
            Logger.warn('[番茄钟] scrollToBlock API 不可用');
        }

        Logger.warn('[番茄钟] ❌ 无法找到块元素:', blockId);
        alert(`无法找到任务块。

可能的原因：
1. 任务块不在当前打开的文档中
2. 任务块已被删除
3. 需要先打开包含任务块的文档

任务块ID: ${blockId}`);
    }

    // ✅ 修复版本：更新任务块的番茄时间属性 - 增加详细的错误处理
    async function updateTaskBlockTomatoTime(blockId, durationSeconds) {
        // 🔧 修复：参数改为秒数，以便更精确地处理小于1分钟的记录
        if (!blockId || !durationSeconds || durationSeconds <= 0) {
            Logger.info('🔍 更新任务块自定义属性: 参数无效', { blockId, durationSeconds });
            return;
        }
        
        // 检查是否启用任务块番茄时间功能
        if (userSettings.taskBlockTomatoTime?.enabled === false) {
            Logger.info('🔍 任务块番茄时间功能已禁用，跳过更新');
            return;
        }

        const durationMinutes = durationSeconds / 60;
        Logger.info('🔍 更新任务块自定义属性:', {
            blockId,
            durationSeconds,
            durationMinutes: Number(durationMinutes.toFixed(2))
        });
        
        // 获取配置
        const config = userSettings.taskBlockTomatoTime || {};
        const enableHourAttr = config.enableHourAttr !== false;
        const hourAttrName = config.hourAttrName || 'custom-tomato-time';
        const enableMinuteAttr = config.enableMinuteAttr === true;
        const minuteAttrName = config.minuteAttrName || 'custom-tomato-minutes';
        
        Logger.info('🔍 属性配置:', { enableHourAttr, hourAttrName, enableMinuteAttr, minuteAttrName });
        
        try {
            // 获取当前属性值
            const getRes = await postJSON('/api/attr/getBlockAttrs', { id: blockId });

            if (!getRes.ok) {
                Logger.warn('⚠️ 获取任务块属性失败，跳过更新:', blockId, '状态:', getRes.status);
                return;
            }
            const getResult = getRes.data;

            // 检查响应格式
            if (!getResult || !getResult.data) {
                Logger.error('❌ 获取属性响应格式错误:', getResult);
                return;
            }

            // 构建要更新的属性
            const setAttrs = {};
            let updateCount = 0;

            // v8.6 修复：休息/正计时休息模式下不更新自定义属性
            // 🔧 修复：使用 timerMode 而不是 syncState.mode，因为 timerMode 是实际的当前模式
            const currentMode = timerMode;
            if (currentMode === 'break' || currentMode === 'stopwatch-break') {
                Logger.info('🔄 休息模式，不更新自定义属性');
            } else {
                // 小时格式属性（如果启用）- 使用精确的小数
                if (enableHourAttr) {
                    const currentHourValue = parseFloat(getResult.data?.[hourAttrName]) || 0;
                    const newHourValue = currentHourValue + (durationMinutes / 60);
                    setAttrs[hourAttrName] = newHourValue.toFixed(2);
                    updateCount++;
                }

                // 分钟格式属性（如果启用）- 🔧 修复：使用小数分钟值精确记录
                if (enableMinuteAttr) {
                    const currentMinuteValue = parseFloat(getResult.data?.[minuteAttrName]) || 0;
                    // 直接累加小数分钟值，保持精度
                    const newMinuteValue = currentMinuteValue + durationMinutes;
                    // 保留2位小数
                    setAttrs[minuteAttrName] = newMinuteValue.toFixed(2);
                    updateCount++;
                }
            }

            // 如果没有要更新的属性，直接返回
            if (updateCount === 0) {
                Logger.info('🔍 没有要更新的属性');
                return;
            }

            const setRes = await postJSON('/api/attr/setBlockAttrs', { id: blockId, attrs: setAttrs });

            if (setRes.ok) {
                const setResult = setRes.data;
                if (setResult.code === 0) {
                    Logger.info(`✅ 任务块 ${blockId} 番茄时间已更新`);
                    Logger.info(`   - ${hourAttrName}: ${setAttrs[hourAttrName]}小时`);
                    if (enableMinuteAttr) {
                        Logger.info(`   - ${minuteAttrName}: ${setAttrs[minuteAttrName]}分钟`);
                    }
                } else {
                    Logger.warn('⚠️ 设置属性API返回错误:', setResult);
                }
            } else {
                Logger.warn('⚠️ 设置任务块属性失败:', blockId, '状态:', setRes.status);
            }
            
        } catch (error) {
            Logger.error('❌ 更新任务块番茄时间失败:', { blockId, error: error?.message || error });
        }
    }

    // ✅ 新增：获取任务块元素的辅助函数 - 修复单个父任务的选择问题
    // 🔧 扩展：支持标题块、段落块、列表块等多种块类型
    // 🔧 新增：支持文档标题块（传入的是普通对象而非DOM元素）
    function getTaskBlockLi(block) {
        if (!block) {
            Logger.info('⚠️ getTaskBlockLi: block为空');
            return null;
        }

        Logger.info('🔍 getTaskBlockLi 开始处理');
        Logger.info('🔍 输入block类型:', block?.className);
        Logger.info('🔍 输入block的data-type:', block?.dataset?.type);
        Logger.info('🔍 输入block的data-node-id:', block?.dataset?.nodeId);

        // 🔧 新增：处理文档标题块的情况（block是普通对象，不是DOM元素）
        // 当右键点击文档标题时，block是一个模拟对象：{ dataset: { nodeId: docId }, textContent: docTitle }
        // 这种情况下直接返回该对象，由 startTimerFromTaskBlock 处理
        if (!block.classList && !block.matches && block.dataset && block.dataset.nodeId) {
            Logger.info('✅ 步骤0：block是文档标题的模拟对象，直接返回');
            Logger.info('✅ 步骤0：返回的data-node-id:', block?.dataset?.nodeId);
            return block;
        }

        // 🔧 扩展：如果是标题块或段落块，直接返回原块
        // 标题块：h1-h6 或 NodeHeading
        // 段落块：.p 或 NodeParagraph
        const isHeading = block.matches('[class*="h"]') || block.dataset?.type?.includes('Heading');
        const isParagraph = block.classList?.contains('p') || block.dataset?.type === 'NodeParagraph';

        if (isHeading || isParagraph) {
            Logger.info('✅ 步骤0：block是标题或段落块，直接返回');
            Logger.info('✅ 步骤0：返回的data-node-id:', block?.dataset?.nodeId);
            return block;
        }

        // 步骤1：如果本身就是.li元素，直接返回
        // 注意：必须同时检查classList和data-type，确保不是.list容器
        if (block.classList?.contains('li') || block.dataset?.type === 'NodeListItem') {
            Logger.info('✅ 步骤1：block本身就是.li元素，直接返回');
            Logger.info('✅ 步骤1：返回的data-node-id:', block?.dataset?.nodeId);
            return block;
        }

        // 🔧 关键修复：如果是.list容器，绝不能直接返回！
        // .list的data-type是"NodeList"，.li的data-type是"NodeListItem"
        if (block.classList?.contains('list') || block.dataset?.type === 'NodeList') {
            Logger.info('⚠️ 步骤1：发现block是.list容器，尝试查找内部.li');

            // 尝试获取第一个.li子元素
            const firstLi = block.querySelector(':scope > .li[data-node-id]');
            if (firstLi) {
                Logger.info('✅ 步骤1：从.list找到内部.li子元素');
                Logger.info('✅ 步骤1：返回的data-node-id:', firstLi?.dataset?.nodeId);
                return firstLi;
            }

            // 如果没找到.li子元素，不能返回.list本身！
            Logger.info('⚠️ 步骤1：在.list内未找到.li子元素，继续查找');
        }

        // 步骤2：向上查找.li祖先
        const parentLi = block.closest?.('.li[data-node-id]');
        if (parentLi) {
            Logger.info('✅ 步骤2：通过closest找到.li祖先');
            Logger.info('✅ 步骤2：返回的data-node-id:', parentLi?.dataset?.nodeId);
            return parentLi;
        }
        Logger.info('⚠️ 步骤2：未找到.li祖先');

        // 步骤3：如果.block是.list容器（上面没找到.li的情况）
        const closestList = block?.closest?.('.list[data-node-id]');
        if (closestList) {
            Logger.info('🔍 步骤3：找到.list容器，尝试获取第一个.li子元素');
            const firstLi = closestList.querySelector(':scope > .li[data-node-id]');
            if (firstLi) {
                Logger.info('✅ 步骤3：从.list获取到.li子元素');
                Logger.info('✅ 步骤3：返回的data-node-id:', firstLi?.dataset?.nodeId);
                return firstLi;
            }
        }

        // 步骤4：尝试根据data-node-id在编辑器区域内查找
        const blockNodeId = block?.dataset?.nodeId || block?.getAttribute?.('data-node-id');
        Logger.info('🔍 步骤4：尝试根据data-node-id查找:', blockNodeId);

        if (blockNodeId) {
            // 首先检查这个ID是否属于.list容器
            const potentialList = document.querySelector(`.list[data-node-id="${blockNodeId}"]`);
            if (potentialList) {
                Logger.info('⚠️ 步骤4：发现blockNodeId属于.list容器，尝试查找内部.li');
                const firstLi = potentialList.querySelector(':scope > .li[data-node-id]');
                if (firstLi) {
                    Logger.info('✅ 步骤4：从.list找到.li子元素');
                    Logger.info('✅ 步骤4：返回的data-node-id:', firstLi?.dataset?.nodeId);
                    return firstLi;
                }
            }

            // 查找.li元素
            const editorArea = document.querySelector('.protyle-wysiwyg, .protyle-content');
            if (editorArea) {
                const liWithSameId = editorArea.querySelector(`.li[data-node-id="${blockNodeId}"]`);
                if (liWithSameId) {
                    Logger.info('✅ 步骤4：在编辑器中找到.li元素');
                    Logger.info('✅ 步骤4：返回的data-node-id:', liWithSameId?.dataset?.nodeId);
                    return liWithSameId;
                }
            }
        }

        Logger.info('⚠️ 所有查找方式都失败，返回null');
        return null;
    }

    // ✅ 修复版本：从任务块开始计时 - 增强单个父任务的支持
    // 🔧 扩展：支持文档标题块、任务列表项、标题块、段落块等多种块类型
    async function startTimerFromTaskBlock(block, duration, mode = 'countdown') {
        Logger.info('='.repeat(50));
        Logger.info('🔍 startTimerFromTaskBlock 被调用');
        Logger.info('🔍 传入的block类型:', block?.className);
        Logger.info('🔍 传入的block的data-node-id:', block?.dataset?.nodeId);
        Logger.info('🔍 传入的blockouterHTML前200字符:', block?.outerHTML?.substring?.(0, 200));

        // 懒加载模式：开始计时时显示悬浮条
        if (isMobileDevice() && isMobileSupportEnabled() && MOBILE_FLOAT_BAR_LAZY_SHOW) {
            showFloatBarOnTimerStart();
        }

        // 🔧 新增：处理文档标题块的情况（block是普通对象，不是DOM元素）
        // 当右键点击文档标题时，block是一个模拟对象：{ dataset: { nodeId: docId }, textContent: docTitle }
        let taskBlock = null;
        let isDocTitleBlock = false;
        let blockName = '未知任务';
        let finalBlockId = null;

        if (!block.classList && !block.matches && block.dataset && block.dataset.nodeId) {
            // 文档标题块：直接使用模拟对象的数据
            isDocTitleBlock = true;
            taskBlock = block; // 直接使用这个对象
            finalBlockId = block.dataset.nodeId;
            blockName = block.textContent || '未知任务';

            Logger.info('🔍 检测到文档标题块');
            Logger.info('🔍 finalBlockId:', finalBlockId);
            Logger.info('🔍 blockName:', blockName);
        } else {
            // 普通块：使用辅助函数获取任务块
            taskBlock = getTaskBlockLi(block);

            Logger.info('🔍 getTaskBlockLi返回的结果:', taskBlock);
            Logger.info('🔍 taskBlock类型:', taskBlock?.className);
            Logger.info('🔍 taskBlock的data-node-id:', taskBlock?.dataset?.nodeId);
            Logger.info('🔍 taskBlock的data-type:', taskBlock?.dataset?.type);

            if (!taskBlock) {
                Logger.error('❌ 未找到任务块元素');
                return;
            }

            // 🔧 扩展：判断是否是"单个父列表"
            // 适用于：任务列表(.li[data-subtype="t"])、有序列表(.li[data-subtype="o"])、无序列表(.li[data-subtype="u"])
            // 单个父列表 = .list 内只有一个 .li 元素（没有兄弟 .li）
            // 多个父列表 = .list 内有多个 .li 元素（有兄弟 .li）
            let targetBlockId = null;
            let targetBlockElement = null;
            let isSingleParentList = false;

            const taskBlockType = taskBlock.dataset?.type;
            const taskBlockClass = taskBlock.className;

            // 获取父级 .list 容器
            const parentList = taskBlock.closest('.list[data-node-id]');

            // 检查 .li 内部是否有子列表（包括任务列表、有序列表、无序列表）
            const hasChildList = taskBlock.querySelector(':scope > .list[data-subtype]');

            // 检查同级是否有其他 .li 元素（兄弟列表项）
            let siblingLiCount = 0;
            if (parentList) {
                siblingLiCount = parentList.querySelectorAll(':scope > .li[data-node-id]').length;
            }

            Logger.info('🔍 taskBlock是否有子列表:', !!hasChildList);
            Logger.info('🔍 同级.li元素数量:', siblingLiCount);
            Logger.info('🔍 taskBlock是.li还是.list:', taskBlockClass?.includes('li') ? '.li' : (taskBlockClass?.includes('list') ? '.list' : '未知'));

            // 判断逻辑（适用于任务列表、有序列表、无序列表）：
            // 1. 单个父列表：.li + 同级只有1个.li + 没有子列表 → 使用外层 .list 的 ID
            // 2. 多个父列表：.li + 同级有多个.li → 使用 .li 本身的 ID
            // 3. 有子列表的情况：.li + 有子列表 → 使用 .li 的 ID
            if (taskBlockClass?.includes('li') && siblingLiCount <= 1 && !hasChildList) {
                // 单个父列表：找到外层的 .list 容器
                if (parentList) {
                    targetBlockId = parentList.dataset.nodeId;
                    targetBlockElement = parentList;
                    isSingleParentList = true;
                    Logger.info('✅ 单个父列表模式：使用外层.list的ID');
                    Logger.info('✅ targetBlockId:', targetBlockId);
                } else {
                    // 如果找不到外层.list，回退到使用.li的ID
                    targetBlockId = taskBlock.dataset?.nodeId;
                    targetBlockElement = taskBlock;
                    Logger.info('⚠️ 未找到外层.list，回退到使用.li的ID');
                }
            } else if (taskBlockClass?.includes('li') && (siblingLiCount > 1 || hasChildList)) {
                // 多个父列表或有子列表的情况：使用 .li 的 ID
                targetBlockId = taskBlock.dataset?.nodeId;
                targetBlockElement = taskBlock;
                Logger.info('✅ 多个父列表/有子列表模式：使用.li的ID');
            } else if (taskBlockClass?.includes('list')) {
                // taskBlock 是 .list（可能来自之前的逻辑）
                targetBlockId = taskBlock.dataset?.nodeId;
                targetBlockElement = taskBlock;
                Logger.info('✅ .list容器模式：使用.list的ID');
            } else {
                // 默认情况：使用 taskBlock 的 ID
                targetBlockId = taskBlock.dataset?.nodeId;
                targetBlockElement = taskBlock;
                Logger.info('✅ 默认模式：使用taskBlock的ID');
            }

            // 🔧 使用可选链和安全获取
            // 只有当 targetBlockId 为空时，才回退到其他来源
            finalBlockId = targetBlockId || taskBlock.dataset?.nodeId || block?.dataset?.nodeId;
            // 🔧 扩展：获取任务名称 - 支持多种块类型
            // 列表项：查找内部 .p 段落
            // 标题块：直接获取文本内容
            // 段落块：直接获取文本内容
            if (taskBlock.classList?.contains('li')) {
                // 列表项：查找内部的 .p 段落
                blockName = taskBlock.querySelector(':scope > .p')?.textContent?.trim()
                    || block?.textContent?.trim()
                    || block?.querySelector?.('.p')?.textContent?.trim()
                    || '未知任务';
            } else if (taskBlock.matches('[class*="h"], [data-type*="Heading"]')) {
                // 标题块：直接获取文本内容（标题块没有子 .p 元素）
                blockName = taskBlock.textContent?.trim() || block?.textContent?.trim() || '未知任务';
            } else if (taskBlock.classList?.contains('p') || taskBlock.dataset?.type === 'NodeParagraph') {
                // 段落块：直接获取文本内容
                blockName = taskBlock.textContent?.trim() || block?.textContent?.trim() || '未知任务';
            } else {
                // 其他类型：使用通用逻辑
                blockName = taskBlock.querySelector(':scope > .p')?.textContent?.trim()
                    || block?.textContent?.trim()
                    || block?.querySelector?.('.p')?.textContent?.trim()
                    || '未知任务';
            }
        }

        Logger.info('🔍 最终获取的finalBlockId:', finalBlockId);
        Logger.info('🔍 最终获取的blockName:', blockName);
        Logger.info('🔍 isDocTitleBlock:', isDocTitleBlock);

        // 验证finalBlockId
        if (!finalBlockId) {
            Logger.error('❌ 任务块ID为空，调试信息:');
            Logger.error('  - taskBlock:', taskBlock);
            Logger.error('  - taskBlock.className:', taskBlock?.className);
            Logger.error('  - taskBlock.dataset:', taskBlock?.dataset);
            Logger.error('  - block:', block);
            Logger.error('  - block.className:', block?.className);
            Logger.error('  - block.dataset:', block?.dataset);
            return;
        }

        // 停止当前计时
        if (isRunning) {
            await recordEndTime();
            stopTimer();
        }

        Logger.info('🔍 准备调用switchToCountdownAndStartWithTask');
        Logger.info('🔍 参数 duration:', duration, 'type:', typeof duration);
        Logger.info('🔍 参数 finalBlockId:', finalBlockId, 'type:', typeof finalBlockId);
        Logger.info('🔍 参数 blockName:', blockName, 'type:', typeof blockName);
        Logger.info('🔍 当前 global.currentTaskBlockId:', window.currentTaskBlockId);

        // 开始新的计时
        if (mode === 'stopwatch') {
            await switchToStopwatchAndStartWithTask(finalBlockId, blockName);
        } else {
            Logger.info('🔍 开始调用 switchToCountdownAndStartWithTask...');
            await switchToCountdownAndStartWithTask(duration, finalBlockId, blockName);
            Logger.info('🔍 switchToCountdownAndStartWithTask 调用完成');
            Logger.info('🔍 此时 global.currentTaskBlockId:', window.currentTaskBlockId);
        }
        
        Logger.info('✅ startTimerFromTaskBlock 执行完成');
        Logger.info('='.repeat(50));
    }

    // ========== DOM 查询缓存管理 ==========
    // 缓存频繁查询的 DOM 元素，减少重复查询开销
    const DOMCache = {
        cache: new Map(),
        timeout: 5000, // 缓存有效期（毫秒）
        
        // 设置缓存
        set(key, element) {
            this.cache.set(key, {
                element,
                timestamp: Date.now()
            });
        },
        
        // 获取缓存
        get(key) {
            const cached = this.cache.get(key);
            if (!cached) return null;
            
            // 检查是否过期
            if (Date.now() - cached.timestamp > this.timeout) {
                this.cache.delete(key);
                return null;
            }
            
            // 检查元素是否仍然在 DOM 中
            if (!document.contains(cached.element)) {
                this.cache.delete(key);
                return null;
            }
            
            return cached.element;
        },
        
        // 清除指定缓存
        delete(key) {
            this.cache.delete(key);
        },
        
        // 清除所有缓存
        clear() {
            this.cache.clear();
        },
        
        // 批量设置相关缓存（用于页面切换时）
        invalidateByPrefix(prefix) {
            for (const key of this.cache.keys()) {
                if (key.startsWith(prefix)) {
                    this.cache.delete(key);
                }
            }
        },
        
        // 缓存常用选择器结果
        cachedQuery(selector, cacheKey = selector) {
            let element = this.get(cacheKey);
            if (!element) {
                element = document.querySelector(selector);
                if (element) {
                    this.set(cacheKey, element);
                }
            }
            return element;
        },
        
        // 缓存 querySelectorAll 结果
        cachedQueryAll(selector, cacheKey = selector) {
            let elements = this.get(cacheKey);
            if (!elements) {
                elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    this.set(cacheKey, elements);
                }
            }
            return elements;
        }
    };
    
    // ========== MutationObserver 管理器 ==========
    // 合并多个 Observer 实例，优化性能
    const ObserverManager = {
        observers: new Map(),
        mergedObserver: null,
        callbacks: new Map(),
        
        // 注册观察目标
        observe(target, options, callback, id) {
            const observerId = id || `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // 存储回调函数
            this.callbacks.set(observerId, {
                callback,
                options,
                target
            });
            
            // 启动合并的 Observer
            this.startMergedObserver();
            
            return observerId;
        },
        
        // 启动统一的 MutationObserver
        startMergedObserver() {
            if (this.mergedObserver) return;
            
            this.mergedObserver = new MutationObserver((mutationsList) => {
                // 遍历所有注册的回调
                this.callbacks.forEach(({ callback, options, target }, id) => {
                    try {
                        // 根据原始配置过滤相关的 mutations
                        const relevantMutations = mutationsList.filter(mutation => {
                            // 检查 mutation.target 是否在观察范围内
                            let currentTarget = mutation.target;
                            while (currentTarget && currentTarget !== document) {
                                if (currentTarget === target) return true;
                                currentTarget = currentTarget.parentNode;
                            }
                            return false;
                        });
                        
                        if (relevantMutations.length > 0) {
                            callback(relevantMutations);
                        }
                    } catch (error) {
                        Logger.error(`Observer callback error [${id}]:`, error);
                    }
                });
            });
            
            // 观察整个文档，由回调函数自行过滤
            this.mergedObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        },
        
        // 断开并移除指定的 Observer
        disconnect(id) {
            this.callbacks.delete(id);
            
            // 如果没有剩余的回调，断开合并的 Observer
            if (this.callbacks.size === 0 && this.mergedObserver) {
                this.mergedObserver.disconnect();
                this.mergedObserver = null;
            }
        },
        
        // 断开所有 Observer
        disconnectAll() {
            if (this.mergedObserver) {
                this.mergedObserver.disconnect();
                this.mergedObserver = null;
            }
            this.callbacks.clear();
            this.observers.clear();
        },
        
        // 获取当前活跃的 Observer 数量
        getActiveCount() {
            return this.callbacks.size;
        }
    };
    
    // ========== 通用子菜单创建函数 ==========
    // 减少重复的菜单创建代码
    function createTomatoSubMenu(onItemClick) {
        const subMenu = document.createElement('div');
        subMenu.className = 'b3-menu b3-list';
        subMenu.style.cssText = `
            display: none;
            position: fixed;
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-surface-light);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 2147483647;
            font-size: 13px;
            min-width: 140px;
            max-height: 400px;
            overflow-y: auto;
            padding: 6px 0;
        `;
        
        // 添加番茄钟时长选项
        getTomatoDurations().forEach(min => {
            const item = document.createElement('button');
            item.className = 'b3-menu__item';
            item.innerHTML = `<span class="b3-menu__label">🍅 ${min}分钟</span>`;
            item.onclick = () => onItemClick(min, 'countdown');
            // 🔧 修复：添加 hover 样式
            item.onmouseenter = () => item.style.backgroundColor = 'var(--b3-menu-background-hover, var(--b3-theme-surface-light))';
            item.onmouseleave = () => item.style.backgroundColor = 'transparent';
            subMenu.appendChild(item);
        });
        
        // 添加正计时选项
        const stopwatchItem = document.createElement('button');
        stopwatchItem.className = 'b3-menu__item';
        stopwatchItem.innerHTML = `<span class="b3-menu__label">⏱️ 正计时</span>`;
        stopwatchItem.onclick = () => onItemClick(null, 'stopwatch');
        // 🔧 修复：添加 hover 样式
        stopwatchItem.onmouseenter = () => stopwatchItem.style.backgroundColor = 'var(--b3-menu-background-hover, var(--b3-theme-surface-light))';
        stopwatchItem.onmouseleave = () => stopwatchItem.style.backgroundColor = 'transparent';
        subMenu.appendChild(stopwatchItem);
        
        return subMenu;
    }

    // ========== 通用菜单显示/隐藏逻辑 ==========
    function setupSubMenuBehavior(menuItem, subMenu, onItemClick) {
        const isMobile = isMobileDevice();

        if (isMobile) {
            // 移动端：点击菜单项直接显示时间选择对话框（模态框）
            // 不再使用自定义子菜单div，因为思源移动端有自己的菜单系统
            // 移除右箭头图标，因为不是真正的二级菜单
            const rightIcon = menuItem.querySelector('svg[style*="margin-left: auto"]');
            if (rightIcon) {
                rightIcon.remove();
            }

            // 移除可能存在的旧点击事件监听器
            const newMenuItem = menuItem.cloneNode(true);
            menuItem.parentNode.replaceChild(newMenuItem, menuItem);

            // 添加新的点击事件：显示时间选择对话框
            newMenuItem.onclick = (e) => {
                e.stopPropagation();
                // 关闭思源原生菜单
                if (window.siyuan && window.siyuan.menus && window.siyuan.menus.menu) {
                    window.siyuan.menus.menu.remove();
                }
                // 清理可能存在的自定义子菜单
                document.getElementById('tomato-task-submenu')?.remove();
                document.getElementById('tomato-db-submenu')?.remove();
                // 显示时间选择对话框
                showTomatoTimeSelectionDialog(onItemClick);
            };
        } else {
            // 桌面端：鼠标悬停显示子菜单
            // 显示子菜单
            menuItem.onmouseenter = () => {
                const rect = menuItem.getBoundingClientRect();
                subMenu.style.display = 'block';
                subMenu.style.visibility = 'hidden';
                subMenu.style.left = '0px';
                subMenu.style.top = '0px';

                const menuRect = subMenu.getBoundingClientRect();

                let left = rect.right + 5;
                let top = rect.top;

                if (left + menuRect.width > window.innerWidth) {
                    left = rect.left - menuRect.width - 5;
                }
                if (left < 5) left = 5;

                if (top + menuRect.height > window.innerHeight) {
                    top = window.innerHeight - menuRect.height - 5;
                }
                if (top < 5) top = 5;

                subMenu.style.left = left + 'px';
                subMenu.style.top = top + 'px';
                subMenu.style.visibility = 'visible';
            };

            // 隐藏子菜单
            menuItem.onmouseleave = () => {
                setTimeout(() => {
                    if (!subMenu.matches(':hover')) {
                        subMenu.style.display = 'none';
                    }
                }, 100);
            };

            subMenu.onmouseleave = () => {
                subMenu.style.display = 'none';
            };
        }
    }

    // ========== 移动端时间选择对话框 ==========
    function showTomatoTimeSelectionDialog(onItemClick) {
        removeById('tomato-time-select-dialog', 'tomato-time-select-backdrop');
        ensureTomatoCommonStyles();

        // 创建遮罩层
        const backdrop = document.createElement('div');
        backdrop.id = 'tomato-time-select-backdrop';
        backdrop.className = 'tomato-backdrop';
        backdrop.style.zIndex = '2147483646';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.id = 'tomato-time-select-dialog';
        dialog.className = 'tomato-bottomsheet';
        dialog.style.maxWidth = '500px';
        dialog.style.padding = '20px';
        dialog.style.zIndex = '2147483647';

        // 标题
        const title = document.createElement('div');
        title.className = 'tomato-bottomsheet-title';
        title.textContent = '选择番茄钟时长';
        dialog.appendChild(title);

        // 番茄钟时长选项
        const optionsContainer = document.createElement('div');
        optionsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 16px;
        `;

        getTomatoDurations().forEach(min => {
            const option = document.createElement('button');
            option.style.cssText = `
                padding: 16px 8px;
                background: var(--b3-theme-surface);
                border: 2px solid var(--b3-theme-surface-light); 
                border-radius: 12px;
                color: var(--b3-theme-on-background);
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            `;
            option.innerHTML = `<span style="font-size:20px;">🍅</span><span>${min}分钟</span>`;
            // 悬停效果
            option.onmouseenter = () => {
                option.style.background = 'var(--b3-theme-surface-light)';
                option.style.borderColor = 'var(--b3-theme-primary)';
            };
            option.onmouseleave = () => {
                option.style.background = 'var(--b3-theme-surface)';
                option.style.borderColor = 'var(--b3-theme-surface-light)';
            };
            option.onclick = () => {
                closeDialog();
                onItemClick(min, 'countdown');
            };
            optionsContainer.appendChild(option);
        });

        dialog.appendChild(optionsContainer);

        // 正计时选项
        const stopwatchOption = document.createElement('button');
        stopwatchOption.style.cssText = `
            width: 100%;
            padding: 16px;
            background: var(--b3-theme-surface);
            border: 2px solid var(--b3-theme-surface-light);
            border-radius: 12px;
            color: var(--b3-theme-primary);
            font-size: 15px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        `;
        stopwatchOption.innerHTML = `<span style="font-size:20px;">⏱️</span><span>正计时（不限时）</span>`;
        // 悬停效果
        stopwatchOption.onmouseenter = () => {
            stopwatchOption.style.background = 'var(--b3-theme-surface-light)';
            stopwatchOption.style.borderColor = 'var(--b3-theme-primary)';
        };
        stopwatchOption.onmouseleave = () => {
            stopwatchOption.style.background = 'var(--b3-theme-surface)';
            stopwatchOption.style.borderColor = 'var(--b3-theme-surface-light)';
        };
        stopwatchOption.onclick = () => {
            closeDialog();
            onItemClick(null, 'stopwatch');
        };
        dialog.appendChild(stopwatchOption);

        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = `
            width: 100%;
            padding: 14px;
            margin-top: 16px;
            background: var(--b3-theme-surface-light);
            border: none;
            border-radius: 12px;
            color: var(--b3-theme-on-surface);
            font-size: 15px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = closeDialog;
        dialog.appendChild(cancelBtn);

        // 关闭对话框函数
        function closeDialog() {
            backdrop.style.opacity = '0';
            dialog.style.transform = 'translateY(100%)';
            setTimeout(() => {
                backdrop.remove();
                dialog.remove();
            }, 300);
        }

        // 点击遮罩层关闭
        backdrop.onclick = closeDialog;

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
    }
    
    // ========== 通用菜单创建函数 ==========
    function createTomatoMenuItem(menuItems, insertBefore, callback) {
        // 避免重复添加
        if (menuItems.querySelector('.tomato-menu-item')) {
            Logger.info('🍅 菜单项已存在，跳过添加');
            return null;
        }
        
        // 添加分隔线
        const divider = document.createElement('button');
        divider.className = 'b3-menu__separator';
        insertBefore.before(divider);
        
        // 添加番茄钟菜单
        const tomatoMenu = document.createElement('button');
        tomatoMenu.className = 'b3-menu__item tomato-menu-item';
        tomatoMenu.setAttribute('data-id', 'tomatoTimer');
        tomatoMenu.innerHTML = `
            <svg class="b3-menu__icon"><use xlink:href="#iconClock"></use></svg>
            <span class="b3-menu__label">🍅 番茄钟</span>
            <svg class="b3-menu__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
        `;
        divider.after(tomatoMenu);
        
        return tomatoMenu;
    }
    
    // ========== 通用编辑器元素获取 ==========
    // 缓存编辑器查询结果
    function getEditorElement() {
        return DOMCache.cachedQuery('.protyle-wysiwyg, .protyle-content', 'editor');
    }
    
    function getSelectedBlock() {
        const editor = getEditorElement();
        if (!editor) return null;
        
        return DOMCache.cachedQuery('.protyle-wysiwyg--select, .protyle-content--select', 'selectedBlock') ||
               editor.querySelector('.protyle-wysiwyg--select, .protyle-content--select');
    }
    
    function getDocTitleElement() {
        return DOMCache.cachedQuery('.protyle-title', 'docTitle');
    }

    // 添加任务块菜单功能（带二级菜单，可选择时长）
    // ========== 监听块菜单 ==========
    // 使用新的 ObserverManager 优化
    function observeBlockMenu(selector, callback) {
        let hasFlag1 = false;
        let hasFlag2 = false;
        let isTitleMenu = false;

        const observerId = ObserverManager.observe(selector, { childList: true, subtree: false }, (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if ((hasFlag1 && hasFlag2) || isTitleMenu) return;
                        
                        if (node.nodeType === 1) {
                            const cutLabel = node.querySelector('.b3-menu__label')?.textContent?.trim();
                            if (cutLabel === window.siyuan.languages.cut) hasFlag1 = true;
                            if (cutLabel === window.siyuan.languages.move) hasFlag2 = true;
                            if (node.closest('[data-name="titleMenu"]')) isTitleMenu = true;
                        }

                        if ((hasFlag1 && hasFlag2) || isTitleMenu) {
                            callback(isTitleMenu);
                            setTimeout(() => {
                                hasFlag1 = false;
                                hasFlag2 = false;
                                isTitleMenu = false;
                            }, 200);
                        }
                    });
                }
            }
        });

        return {
            disconnect: () => ObserverManager.disconnect(observerId)
        };
    }

    // ========== 添加任务块菜单功能（使用通用函数优化） ==========
    async function addTaskBlockMenuFeature() {
        Logger.info('🍅 addTaskBlockMenuFeature: 开始监听块菜单');
        
        // 监听块右键菜单
        whenElementExist('#commonMenu .b3-menu__items').then((menuItems) => {
            Logger.info('🍅 addTaskBlockMenuFeature: 检测到菜单', menuItems);
            observeBlockMenu(menuItems, async (isTitleMenu) => {
                // 检查是否是单个块
                const blocks = getSelectedBlocks(isTitleMenu);
                if (blocks.length !== 1) return;

                const block = blocks[0];
                if (!block) return;

                // 文档标题块特殊处理：直接允许显示菜单
                if (isTitleMenu) {
                    // 查找"添加到数据库"按钮
                    const addToDbBtn = menuItems.querySelector('button[data-id="addToDatabase"]');
                    if (!addToDbBtn) return;

                    // 使用通用菜单创建函数
                    const tomatoMenu = createTomatoMenuItem(menuItems, addToDbBtn);
                    if (!tomatoMenu) return;

                    // 创建任务块计时回调
                    const taskBlockCallback = async (duration, mode) => {
                        window.siyuan.menus.menu.remove();
                        document.getElementById('tomato-task-submenu')?.remove();
                        await startTimerFromTaskBlock(block, duration, mode);
                    };

                    // 创建并添加子菜单
                    const subMenu = createTomatoSubMenu(taskBlockCallback);
                    subMenu.id = 'tomato-task-submenu';
                    document.body.appendChild(subMenu);

                    // 设置子菜单行为
                    setupSubMenuBehavior(tomatoMenu, subMenu, taskBlockCallback);

                    // 主菜单关闭时清理子菜单
                    const originalRemove = window.siyuan.menus.menu.remove.bind(window.siyuan.menus.menu);
                    window.siyuan.menus.menu.remove = function() {
                        document.getElementById('tomato-task-submenu')?.remove();
                        originalRemove();
                    };

                    return;
                }

                // 普通块处理：检查是否是有效的块类型
                // 支持：任务列表项(.li)、标题块(h1-h6)、段落块(.p)
                const blockClassList = block.classList;
                if (!blockClassList) return;

                const isValidBlock =
                    blockClassList.contains('li') ||
                    block.matches('[class^="h"], [class*=" h"]') ||
                    block.dataset?.type?.includes('Heading') ||
                    blockClassList.contains('p') ||
                    block.dataset?.type === 'NodeParagraph';

                if (!isValidBlock) return;

                // 查找"添加到数据库"按钮
                const addToDbBtn = menuItems.querySelector('button[data-id="addToDatabase"]');
                if (!addToDbBtn) return;

                // 使用通用菜单创建函数
                const tomatoMenu = createTomatoMenuItem(menuItems, addToDbBtn);
                if (!tomatoMenu) return;

                // 创建任务块计时回调
                const taskBlockCallback = async (duration, mode) => {
                    window.siyuan.menus.menu.remove();
                    document.getElementById('tomato-task-submenu')?.remove();
                    await startTimerFromTaskBlock(block, duration, mode);
                };

                // 创建并添加子菜单
                const subMenu = createTomatoSubMenu(taskBlockCallback);
                subMenu.id = 'tomato-task-submenu';
                document.body.appendChild(subMenu);

                // 设置子菜单行为
                setupSubMenuBehavior(tomatoMenu, subMenu, taskBlockCallback);

                // 主菜单关闭时清理子菜单
                const originalRemove = window.siyuan.menus.menu.remove.bind(window.siyuan.menus.menu);
                window.siyuan.menus.menu.remove = function() {
                    document.getElementById('tomato-task-submenu')?.remove();
                    originalRemove();
                };
            });
        });
    }

    // ========== 数据库块菜单功能 ==========

    // ========== 获取块信息 ==========
    async function getBlockInfo(blockId) {
        if (!blockId) return null;

        try {
            const res = await postJSON('/api/block/getBlockInfo', { id: blockId });

            if (!res.ok) {
                Logger.warn('⚠️ 获取块信息失败:', blockId);
                return null;
            }

            const result = res.data;
            if (result && result.data) {
                return {
                    id: result.data.id,
                    type: result.data.type,
                    content: result.data.content || result.data.markdown || ''
                };
            }

            return null;
        } catch (error) {
            Logger.error('❌ 获取块信息出错:', error);
            return null;
        }
    }

    /**
     * 添加数据库块番茄钟菜单
     * 监听 #commonMenu 的出现，为数据库菜单添加番茄钟选项
     */
    /**
     * 添加数据库块番茄钟菜单
     * 🔧 修复：简化逻辑，只保留一个点击事件监听器
     */
    async function addDatabaseBlockMenuFeature() {
        Logger.info('🍅 addDatabaseBlockMenuFeature 初始化');
        
        // 🔧 核心修复：同时监听 click 和 touch 事件
        // 移动端可能使用 touch 事件触发菜单
        
        // 记录点击的数据库行的核心函数
        const recordDatabaseCell = (element) => {
            if (!element || element.nodeType === Node.TEXT_NODE) {
                return false;
            }
            
            // 向上查找直到找到 body 或数据库行
            let current = element;
            while (current && current !== document.body) {
                // 检查是否是数据库行
                const row = current.classList?.contains('av__row') ? current : null;
                if (!row) {
                    // 检查是否是行内的子元素
                    const closestRow = current.closest?.('.av__row');
                    if (closestRow) {
                        const blockRef = closestRow.querySelector('[data-type="block-ref"]');
                        if (blockRef && blockRef.dataset.id) {
                            const av = closestRow.closest('.av');
                            
                            // 更新全局变量
                            lastRightClickedDatabaseCell = {
                                rowId: closestRow.dataset?.rowId,
                                blockId: blockRef.dataset.id,
                                avId: av?.dataset?.avId,
                                taskName: blockRef.textContent?.trim() || null,
                                timestamp: Date.now()
                            };
                            
                            Logger.info('🍅 ✅ 点击记录:', lastRightClickedDatabaseCell.blockId);
                            
                            // 更新 currentDatabaseBlockId（用于高亮）
                            currentDatabaseBlockId = blockRef.dataset.id;
                            
                            return true;
                        }
                    }
                } else {
                    // 当前元素就是数据库行
                    const blockRef = row.querySelector('[data-type="block-ref"]');
                    if (blockRef && blockRef.dataset.id) {
                        const av = row.closest('.av');
                        
                        lastRightClickedDatabaseCell = {
                            rowId: row.dataset?.rowId,
                            blockId: blockRef.dataset.id,
                            avId: av?.dataset?.avId,
                            taskName: blockRef.textContent?.trim() || null,
                            timestamp: Date.now()
                        };
                        
                        Logger.info('🍅 ✅ 点击记录:', lastRightClickedDatabaseCell.blockId);
                        
                        currentDatabaseBlockId = blockRef.dataset.id;
                        
                        return true;
                    }
                }
                
                current = current.parentNode;
            }
            
            return false;
        };
        
        // 处理 click 事件
        const handleClick = (e) => {
            // 排除点击菜单本身的情况
            if (e.target.closest?.('.b3-menu')) {
                return;
            }
            recordDatabaseCell(e.target);
        };
        
        // 处理 touch 事件（移动端）
        const handleTouchEnd = (e) => {
            // 触摸结束时的目标元素
            if (e.changedTouches && e.changedTouches.length > 0) {
                const touch = e.changedTouches[0];
                const element = document.elementFromPoint(touch.clientX, touch.clientY);
                
                if (element && !element.closest?.('.b3-menu')) {
                    recordDatabaseCell(element);
                }
            }
        };
        
        // 使用 capture 阶段监听事件，确保在思源之前捕获
        document.addEventListener('click', handleClick, { capture: true });
        document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });

        // 监听菜单打开
        const menuObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        // 安全检查：确保 node 是元素节点且有有效的 className
                        if (node.nodeType === Node.ELEMENT_NODE && 
                            (node.id === 'commonMenu' || 
                             (typeof node.className === 'string' && node.className.includes('b3-menu')))) {
                            Logger.info('🍅 🔔 检测到菜单打开');
                            
                            // 菜单打开时也尝试从 DOM 获取（备用）
                            setTimeout(() => {
                                const avs = document.querySelectorAll('.av');
                                for (const av of avs) {
                                    const activeRow = av.querySelector('.av__row--active, .av__row[data-rv-current="true"], .av__row[data-rv-selected="true"]');
                                    if (activeRow) {
                                        const blockRef = activeRow.querySelector('[data-type="block-ref"]');
                                        if (blockRef && blockRef.dataset.id) {
                                            lastRightClickedDatabaseCell = {
                                                rowId: activeRow.dataset?.rowId,
                                                blockId: blockRef.dataset.id,
                                                avId: av.dataset.avId,
                                                taskName: blockRef.textContent?.trim() || null,
                                                timestamp: Date.now()
                                            };
                                            Logger.info('🍅 ✅ 菜单打开时更新:', lastRightClickedDatabaseCell.blockId);
                                            return;
                                        }
                                    }
                                }
                            }, 50);
                        }
                    }
                }
            }
        });
        
        menuObserver.observe(document.body, { childList: true, subtree: true });
        // 🔧 性能优化：存储 Observer 引用，用于后续清理
        mutationObservers.push(menuObserver);

        // 存储当前菜单的触发源元素
        let currentMenuTriggerElement = null;

        // 检查菜单是否已经存在，如果存在则处理
        const checkAndAddMenu = async () => {
            const menuContainer = document.querySelector('#commonMenu');
            if (!menuContainer) {
                return;
            }

            // 🔧 关键修复：尝试找到菜单的触发源
            // 移动端数据库行菜单通常是点击行上的按钮触发的
            // 我们需要找到触发菜单的那个按钮或行
            const menuButtons = menuContainer.querySelectorAll('button[data-id]');
            
            // 查找是否有删除行、编辑行等按钮，这些按钮的存在表明这是数据库行菜单
            const hasRowActions = Array.from(menuButtons).some(btn => {
                const label = btn.querySelector('.b3-menu__label')?.textContent?.toLowerCase();
                return label && (label.includes('删除') || label.includes('remove') || 
                               label.includes('编辑') || label.includes('edit') ||
                               label.includes('复制') || label.includes('copy'));
            });
            
            if (hasRowActions) {
                Logger.info('🍅 🔍 检测到数据库行菜单');
                // 尝试从最近点击的记录中获取信息
                // 这个信息应该在我们上面的全局点击监听器中已经更新了
            }

            const menuItems = menuContainer.querySelector('.b3-menu__items');
            if (!menuItems) {
                return;
            }

            // 检查番茄钟菜单是否已存在
            if (menuItems.querySelector('.tomato-start-from-db')) {
                return;
            }

            // 检查是否是数据库块菜单的特征
            // 移动端和桌面端可能有不同的菜单结构，这里使用多种方式检测
            const unbindBlockBtn = menuItems.querySelector('button[data-id="unbindBlock"]');
            const openByBtn = menuItems.querySelector('button[data-id="openBy"]');
            const avCell = menuContainer.querySelector('.av__cell');

            // 条件1：有 unbindBlock 按钮（桌面端数据库块）
            // 条件2：有 openBy 按钮且有数据库单元格特征（移动端）
            // 条件3：检查菜单项中是否有数据库相关操作
            const menuLabels = Array.from(menuItems.querySelectorAll('.b3-menu__label') || []).map(el => el.textContent?.toLowerCase() || '');
            const hasDatabaseFeature = unbindBlockBtn || (openByBtn && (avCell || menuLabels.some(l => l.includes('database') || l.includes('数据') || l.includes('打开') || l.includes('关联'))));

            if (!hasDatabaseFeature) {
                return;
            }

            Logger.info('✅ 检测到数据库菜单，添加番茄钟选项');
            await handleDatabaseMenu(menuItems, openByBtn);
        };

        // 使用 MutationObserver 监听 #commonMenu 的变化
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // 检查是否有子节点添加
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    requestAnimationFrame(checkAndAddMenu);
                    return;
                }
                // 检查是否有属性变化（菜单显示时可能改变 display 或 class 属性）
                if (mutation.type === 'attributes') {
                    requestAnimationFrame(checkAndAddMenu);
                    return;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'id']
        });
        // 🔧 性能优化：存储 Observer 引用，用于后续清理
        mutationObservers.push(observer);

        // 🔧 修复：增加检查次数和持续检查，确保页面刷新后仍能检测到菜单
        // 🔧 修复：使用单一定时器，避免多个定时器累积导致内存泄漏
        let checkCount = 0;
        const maxChecks = 100; // 增加检查次数
        const checkInterval = 100; // 检查间隔

        // 使用单一定时器，50次检查后降低频率
        const timerId = setInterval(() => {
            checkCount++;
            checkAndAddMenu();

            // 50次检查后降低检查频率（从100ms降到1s）
            if (checkCount >= 50) {
                clearInterval(timerId); // 清除原定时器
                // 创建新的低频率定时器
                const slowTimerId = setInterval(checkAndAddMenu, 1000);
                // 30秒后清除低频率定时器，避免一直运行
                setTimeout(() => {
                    clearInterval(slowTimerId);
                }, 30000);
                Logger.info('🍅 数据库菜单检测已转为低频率模式');
            }
        }, checkInterval);

        Logger.info('🍅 数据库菜单监听器已设置');
    }

    /**
     * 处理数据库菜单 - 添加番茄钟选项
     * 🔧 修复：直接查找菜单关联的数据库行
     */
    async function handleDatabaseMenu(menuItems, openByBtn) {
        // 避免重复添加
        if (menuItems.querySelector('.tomato-start-from-db')) {
            Logger.info('🍅 数据库菜单已存在，跳过添加');
            return;
        }

        Logger.info('🍅 ========== handleDatabaseMenu 开始 ==========');

        // 🔧 核心修复：确保第一次和第二次点击使用完全相同的获取逻辑
        // 在菜单打开时立即从多个来源获取并保存信息
        let cachedBlockId = null;
        let cachedTaskName = null;
        
        // 获取信息的统一函数（第一次和第二次点击都使用这个逻辑）
        const getDatabaseInfo = () => {
            // 来源1：优先使用点击事件记录的 lastRightClickedDatabaseCell
            if (lastRightClickedDatabaseCell?.blockId) {
                return {
                    blockId: lastRightClickedDatabaseCell.blockId,
                    taskName: lastRightClickedDatabaseCell.taskName || null,
                    source: 'clickRecord'
                };
            }
            
            // 来源2：从当前 DOM 状态获取（作为后备）
            const allAvs = document.querySelectorAll('.av');
            for (const av of allAvs) {
                const activeRow = av.querySelector('.av__row--active, .av__row[data-rv-current="true"], .av__row[data-rv-selected="true"]');
                if (activeRow) {
                    const blockRef = activeRow.querySelector('[data-type="block-ref"]');
                    if (blockRef && blockRef.dataset.id) {
                        return {
                            blockId: blockRef.dataset.id,
                            taskName: blockRef.textContent?.trim() || null,
                            source: 'domActive'
                        };
                    }
                }
            }
            
            return { blockId: null, taskName: null, source: 'none' };
        };
        
        // 立即获取并缓存信息（在菜单打开时）
        const initialInfo = getDatabaseInfo();
        cachedBlockId = initialInfo.blockId;
        cachedTaskName = initialInfo.taskName;
        Logger.info('🍅 🔍 handleDatabaseMenu 获取:', cachedBlockId, cachedTaskName, '来源:', initialInfo.source);

        // 创建数据库计时回调 - 确保每次执行时使用统一的获取逻辑
        const dbCallback = async (duration, mode) => {
            window.siyuan.menus.menu.remove();
            document.getElementById('tomato-db-submenu')?.remove();

            // 🔧 等待一下让菜单关闭完成
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // 🔧 关键修复：每次执行时都重新获取信息，确保一致性
            const info = getDatabaseInfo();
            
            // 优先使用实时获取的信息
            let clickedBlockId = info.blockId;
            let clickedTaskName = info.taskName;
            
            // 如果实时获取失败，使用缓存的信息
            if (!clickedBlockId && cachedBlockId) {
                clickedBlockId = cachedBlockId;
                clickedTaskName = cachedTaskName;
            }
            
            Logger.info('🍅 🍅 子菜单点击，获取结果:', clickedBlockId, clickedTaskName, '来源:', info.source);

            if (!clickedBlockId) {
                Logger.error('❌ 无法确定要计时的任务块');
                showToastDialog('提示', '无法确定要计时的任务块，请确保选中了一个有效的数据库单元格');
                return;
            }

            await startTimerFromDatabaseBlock(clickedBlockId, duration, mode, clickedTaskName);
        };

        // 记录日志
        if (cachedBlockId) {
            Logger.info('🍅 ✅ 成功获取数据库块ID:', cachedBlockId);
        } else {
            Logger.warn('🍅 ⚠️ 未获取到 blockId，无法关联到具体任务');
            Logger.info('🍅 💡 请确保选中了一个包含任务引用的数据库单元格');
        }

        // 创建番茄钟菜单按钮
        const tomatoMenu = document.createElement('button');
        tomatoMenu.className = 'b3-menu__item tomato-start-from-db';
        tomatoMenu.setAttribute('data-id', 'tomatoTimerFromDB');
        tomatoMenu.innerHTML = `
            <svg class="b3-menu__icon"><use xlink:href="#iconClock"></use></svg>
            <span class="b3-menu__label">🍅 番茄钟</span>
            <svg class="b3-menu__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
        `;

        // 在 openBy 之前插入，如果没有 openByBtn 则追加到菜单末尾
        if (openByBtn && openByBtn.parentNode) {
            openByBtn.before(tomatoMenu);
        } else {
            menuItems.appendChild(tomatoMenu);
        }

        // 创建并添加子菜单（使用通用函数）
        const subMenu = createTomatoSubMenu(dbCallback);
        subMenu.id = 'tomato-db-submenu';
        document.body.appendChild(subMenu);

        // 设置子菜单行为（使用通用函数）
        setupSubMenuBehavior(tomatoMenu, subMenu, dbCallback);

        // 主菜单关闭时清理子菜单
        const originalRemove = window.siyuan.menus.menu.remove.bind(window.siyuan.menus.menu);
        window.siyuan.menus.menu.remove = function() {
            document.getElementById('tomato-db-submenu')?.remove();
            originalRemove();
        };

        Logger.info('✅ 数据库番茄钟菜单已添加');
    }

    /**
     * 从数据库块启动番茄计时
     * 直接使用传入的 databaseBlockId 作为任务块ID
     * 使用传入的 taskName 或从 API 获取任务名称
     */
    async function startTimerFromDatabaseBlock(databaseBlockId, duration, mode = 'countdown', taskName = null) {
        Logger.info('='.repeat(50));
        Logger.info('🔍 startTimerFromDatabaseBlock 被调用');
        Logger.info('🔍 databaseBlockId:', databaseBlockId);
        Logger.info('🔍 duration:', duration);
        Logger.info('🔍 mode:', mode);
        Logger.info('🔍 taskName:', taskName);
        Logger.info('🔍 lastRightClickedDatabaseCell:', lastRightClickedDatabaseCell);
        Logger.info('🔍 currentDatabaseBlockId:', currentDatabaseBlockId);


        // 懒加载模式：开始计时时显示悬浮条
        if (isMobileDevice() && isMobileSupportEnabled() && MOBILE_FLOAT_BAR_LAZY_SHOW) {
            showFloatBarOnTimerStart();
        }
        // ✅ 关键修复：直接使用传入的 databaseBlockId 作为任务块ID
        // 不再调用 getDatabaseBlockBoundBlockId 重新查询
        let taskBlockId = databaseBlockId;
        let blockName = taskName || '数据库任务';  // ✅ 优先使用传入的 taskName
        let blockElement = null;

        // 🔧 修复：如果传入的 databaseBlockId 为空，尝试从多个来源获取
        if (!taskBlockId) {
            Logger.info('⚠️ 传入的 databaseBlockId 为空，尝试从多个来源获取');

            // 来源1：lastRightClickedDatabaseCell
            if (lastRightClickedDatabaseCell && lastRightClickedDatabaseCell.blockId) {
                taskBlockId = lastRightClickedDatabaseCell.blockId;
                Logger.info('✅ 从 lastRightClickedDatabaseCell 获取:', taskBlockId);
            }

            // 来源2：当前活动的数据库单元格
            if (!taskBlockId) {
                const activeCell = document.querySelector('.av__cell[style*="--active"], .av__cell[data-rv-current="true"]');
                if (activeCell) {
                    const blockRef = activeCell.querySelector('[data-type="block-ref"]');
                    if (blockRef && blockRef.dataset.id) {
                        taskBlockId = blockRef.dataset.id;
                        Logger.info('✅ 从 activeCell 获取:', taskBlockId);
                    }
                }
            }

            // 来源3：focus-within 单元格
            if (!taskBlockId) {
                const focusedCell = document.querySelector('.av__cell:focus-within');
                if (focusedCell) {
                    const blockRef = focusedCell.querySelector('[data-type="block-ref"]');
                    if (blockRef && blockRef.dataset.id) {
                        taskBlockId = blockRef.dataset.id;
                        Logger.info('✅ 从 focusedCell 获取:', taskBlockId);
                    }
                }
            }

            // 来源4：选中状态的单元格
            if (!taskBlockId) {
                const selectedCell = document.querySelector('.av__cell--selected, .av__cell[data-rv-selected="true"]');
                if (selectedCell) {
                    const blockRef = selectedCell.querySelector('[data-type="block-ref"]');
                    if (blockRef && blockRef.dataset.id) {
                        taskBlockId = blockRef.dataset.id;
                        Logger.info('✅ 从 selectedCell 获取:', taskBlockId);
                    }
                }
            }
        }

        // 如果 taskName 也为空，尝试获取
        if (!blockName || blockName === '数据库任务') {
            if (lastRightClickedDatabaseCell && lastRightClickedDatabaseCell.taskName) {
                blockName = lastRightClickedDatabaseCell.taskName;
                Logger.info('✅ 从 lastRightClickedDatabaseCell 获取 taskName:', blockName);
            }
        }

        // 步骤1：如果没有传入 taskName，尝试从 API 获取
        if (!taskName && taskBlockId) {
            Logger.info('🔍 未传入 taskName，尝试从 API 获取');
            const blockInfo = await getBlockInfo(taskBlockId);
            Logger.info('🔍 getBlockInfo 返回结果:', JSON.stringify(blockInfo, null, 2));
            if (blockInfo) {
                // 尝试从多个可能的字段获取名称
                blockName = blockInfo.content || blockInfo.name || blockInfo.title || '数据库任务';
                Logger.info('🔍 任务块信息:', blockInfo);

                // 尝试在当前文档中查找该块元素（使用缓存的编辑器查询）
                const editor = getEditorElement();
                if (editor) {
                    blockElement = editor.querySelector(`[data-node-id="${taskBlockId}"]`);
                    if (blockElement) {
                        Logger.info('✅ 在当前文档中找到任务块元素');
                    }
                }
            }
        }

        // 步骤2：如果仍然没有块ID，尝试获取当前选中块作为后备
        if (!taskBlockId) {
            Logger.info('⚠️ databaseBlockId 为空，尝试获取当前选中块');

            const selectedBlock = getSelectedBlock();
            if (selectedBlock && selectedBlock.dataset?.nodeId) {
                taskBlockId = selectedBlock.dataset.nodeId;
                blockElement = selectedBlock;

                // 获取选中块的名称
                const contentElement = selectedBlock.querySelector('.p, h1, h2, h3, h4, h5, h6');
                if (contentElement) {
                    blockName = contentElement.textContent?.trim() || '未知任务';
                } else {
                    blockName = selectedBlock.textContent?.trim() || '未知任务';
                }

                Logger.info('🔍 使用当前选中块:', taskBlockId, blockName);
            }
        }

        // 验证最终的块ID
        if (!taskBlockId) {
            Logger.error('❌ 无法确定目标块ID，无法开始计时');
            showToastDialog('提示', '无法确定要计时的任务块，请确保选中了一个有效的块');
            return;
        }

        // ✅ 修复：设置新的数据库行ID
        // 高亮清除由 highlightDatabaseRow 内部处理（先添加新高亮，再清除旧高亮）
        currentDatabaseBlockId = taskBlockId;
        Logger.info('🔍 设置 currentDatabaseBlockId:', currentDatabaseBlockId);

        // 步骤3：根据是否有块元素，调用相应的计时函数
        Logger.info('🔍 准备开始计时:');
        Logger.info('🔍 taskBlockId:', taskBlockId);
        Logger.info('🔍 blockName:', blockName);
        Logger.info('🔍 blockElement:', blockElement ? '存在' : '不存在');

        if (blockElement) {
            // 如果找到了块元素，使用原有的任务块计时逻辑
            await startTimerFromTaskBlock(blockElement, duration, mode);
        } else {
            // 如果没有找到块元素，创建一个模拟的块对象
            const mockBlock = {
                dataset: { nodeId: taskBlockId },
                textContent: blockName,
                classList: null,
                matches: null
            };

            await startTimerFromTaskBlock(mockBlock, duration, mode);
        }

        // ✅ 关键修复：计时开始后主动尝试高亮任务块和数据库行
        // 从数据库启动时，blockElement 可能为 null（块在其他文档中），
        // 此时 startTimerFromTaskBlock 中的 highlightTaskBlock 会失败
        // 所以这里需要额外尝试一次高亮
        setTimeout(async () => {
            Logger.info('🔍 startTimerFromDatabaseBlock 尝试高亮:');
            Logger.info('🔍 currentTaskBlockId:', currentTaskBlockId);
            Logger.info('🔍 currentDatabaseBlockId:', currentDatabaseBlockId);
            Logger.info('🔍 blockElement:', blockElement ? '存在' : '不存在');

            // 1. 如果有现成的 blockElement，直接高亮任务块
            if (blockElement) {
                highlightTaskBlock(taskBlockId);
                startHighlightKeepAlive();
                Logger.info('✅ 使用 blockElement 高亮任务块成功');
            }
            // 2. 如果没有 blockElement，尝试从当前文档查找
            else if (taskBlockId) {
                const foundElement = findBlockElement(taskBlockId);
                if (foundElement) {
                    highlightTaskBlock(taskBlockId);
                    startHighlightKeepAlive();
                    Logger.info('✅ 从文档中找到元素并高亮任务块成功');
                } else {
                    Logger.info('⚠️ 无法在当前文档中找到任务块元素，高亮跳过');
                    Logger.info('💡 如果块在其他文档中，跳转到该文档后会自动高亮');
                }
            }

            // 3. 尝试高亮数据库行（无论任务块是否找到）
            if (currentDatabaseBlockId) {
                Logger.info('🔍 尝试高亮数据库行:', currentDatabaseBlockId);
                const dbHighlightSuccess = highlightDatabaseRow(currentDatabaseBlockId);
                if (dbHighlightSuccess) {
                    Logger.info('✅ 高亮数据库行成功');
                } else {
                    Logger.info('⚠️ 高亮数据库行失败，行可能不在当前视图中');
                }
            }
        }, 100);

        Logger.info('✅ startTimerFromDatabaseBlock 执行完成');
        Logger.info('='.repeat(50));
    }
    
    // ========== 音频播放功能 ==========
    
    /**
     * 加载音频配置
     */
    function getAudioSettings() {
        return userSettings.audioSettings;
    }
    
    /**
     * 保存音频配置
     */
    async function saveAudioSettings() {
        userSettings.audioSettings = audioSettings;
        await saveUserSettings();
    }
    
    /**
     * 设置提示音文件
     * @param {string} type - 'work' 或 'break'
     * @param {string} filename - 音频文件名（不需要路径）
     */
    async function setAudioFile(type, filename) {
        // 同步最新的 userSettings
        if (userSettings.audioSettings) {
            audioSettings = userSettings.audioSettings;
        }

        if (type === 'work') {
            audioSettings.workEndSound = filename;
        } else if (type === 'break') {
            audioSettings.breakEndSound = filename;
        }

        // 同步回 userSettings
        userSettings.audioSettings = audioSettings;

        await saveAudioSettings();

        // 重新初始化音频
        await initAudio();

        Logger.info(`🍅 已设置 ${type} 提示音:`, filename);
    }
    
    /**
     * 获取提示音文件路径
     * @param {string} type - 'work' 或 'break'
     * @returns {string} 完整的音频文件路径
     */
    function getAudioPath(type) {
        const filename = type === 'work' ? audioSettings.workEndSound : audioSettings.breakEndSound;
        if (!filename) return '';
        return AUDIO_STORAGE_PATH + filename;
    }
    
    /**
     * 初始化音频对象
     */
    async function initAudio() {
        // 确保 audioSettings 引用正确（同步 userSettings 中的值）
        if (userSettings.audioSettings) {
            audioSettings = userSettings.audioSettings;
        }

        Logger.info('🍅 initAudio 当前配置:', JSON.stringify(audioSettings));

        if (!audioSettings?.enabled) {
            Logger.info('🍅 提示音已禁用');
            return;
        }

        // 初始化工作结束提示音
        const workEndPath = audioSettings?.workEndSound;
        Logger.info('🍅 工作结束提示音文件名:', workEndPath);
        if (workEndPath) {
            try {
                // 使用 getFile API 读取文件为 Blob
                let fileResponse = await fetch('/api/file/getFile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: AUDIO_STORAGE_PATH + workEndPath })
                });
                if (!fileResponse.ok) {
                    fileResponse = await fetch('/api/file/getFile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: LEGACY_AUDIO_STORAGE_PATH + workEndPath })
                    });
                }

                if (fileResponse.ok) {
                    const blob = await fileResponse.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    workEndAudio = new Audio(objectUrl);
                    workEndAudio.volume = audioSettings.volume;
                    workEndAudio.addEventListener('error', (e) => {
                        Logger.error('🍅 工作音频加载错误:', e);
                    });
                    Logger.info('🍅 工作结束提示音已加载:', workEndPath);
                } else {
                    Logger.warn('🍅 无法读取工作提示音文件:', workEndPath);
                    workEndAudio = null;
                }
            } catch (e) {
                Logger.warn('⚠️ 无法加载工作结束提示音:', e);
                workEndAudio = null;
            }
        } else {
            Logger.info('🍅 未设置工作结束提示音');
            workEndAudio = null;
        }

        // 初始化休息结束提示音
        const breakEndPath = audioSettings?.breakEndSound;
        Logger.info('🍅 休息结束提示音文件名:', breakEndPath);
        if (breakEndPath) {
            try {
                // 使用 getFile API 读取文件为 Blob
                let fileResponse = await fetch('/api/file/getFile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: AUDIO_STORAGE_PATH + breakEndPath })
                });
                if (!fileResponse.ok) {
                    fileResponse = await fetch('/api/file/getFile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: LEGACY_AUDIO_STORAGE_PATH + breakEndPath })
                    });
                }

                if (fileResponse.ok) {
                    const blob = await fileResponse.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    breakEndAudio = new Audio(objectUrl);
                    breakEndAudio.volume = audioSettings.volume;
                    breakEndAudio.addEventListener('error', (e) => {
                        Logger.error('🍅 休息音频加载错误:', e);
                    });
                    Logger.info('🍅 休息结束提示音已加载:', breakEndPath);
                } else {
                    Logger.warn('🍅 无法读取休息提示音文件:', breakEndPath);
                    breakEndAudio = null;
                }
            } catch (e) {
                Logger.warn('⚠️ 无法加载休息结束提示音:', e);
                breakEndAudio = null;
            }
        } else {
            Logger.info('🍅 未设置休息结束提示音');
            breakEndAudio = null;
        }
    }
    
    /**
     * 播放提示音
     * @param {string} type - 提示音类型: 'work-end' | 'break-end'
     */
    async function playEndSound(type) {
        Logger.info('🔔 playEndSound 被调用, type:', type);
        
        // 同步最新的音频配置
        if (userSettings.audioSettings) {
            audioSettings = userSettings.audioSettings;
        }
        
        Logger.info('🔔 audioSettings:', JSON.stringify(audioSettings));
        Logger.info('🔔 workEndAudio:', workEndAudio);
        Logger.info('🔔 breakEndAudio:', breakEndAudio);

        // 检查提示音是否启用
        if (!audioSettings || !audioSettings.enabled) {
            Logger.info('🔔 提示音已禁用，跳过播放');
            return;
        }

        let audio = type === 'work-end' ? workEndAudio : breakEndAudio;
        Logger.info('🔔 选中的 audio 对象:', audio);
        Logger.info('🔔 选中的 audio.src:', audio?.src);

        try {
            if (audio) {
                // 自定义音频文件
                Logger.info(`🔊 尝试播放自定义音频`);
                audio.currentTime = 0;
                
                // 确保音量设置正确
                audio.volume = audioSettings.volume || 0.8;
                Logger.info(`🔊 音量设置为: ${audio.volume}`);
                
                const playPromise = audio.play();

                if (playPromise !== undefined) {
                    await playPromise;
                }
                Logger.info(`✅ 播放自定义音频成功`);
            } else {
                // 没有设置自定义音频，使用浏览器内置提示音
                Logger.info(`🔔 未配置自定义音频，使用浏览器内置提示音`);
                await playBrowserBeep();
            }
        } catch (e) {
            Logger.warn(`⚠️ 播放自定义音频失败:`, e.name, e.message);
            // 降级使用浏览器内置提示音
            Logger.info(`🔔 降级使用浏览器内置提示音`);
            try {
                await playBrowserBeep();
            } catch (beepError) {
                Logger.warn('⚠️ 浏览器内置提示音也失败:', beepError);
            }
        }
    }
    
    /**
     * 播放浏览器内置提示音（使用 Web Audio API）
     */
    async function playBrowserBeep() {
        try {
            // 创建音频上下文
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                Logger.warn('⚠️ 浏览器不支持 Web Audio API');
                return;
            }
            
            const audioContext = new AudioContext();
            
            // 创建振荡器
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            // 连接节点
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // 设置音调（工作结束用高音，休息结束用低音）
            const isWorkEnd = workEndAudio !== null || (!audioSettings.workEndSound && !audioSettings.breakEndSound);
            oscillator.frequency.value = isWorkEnd ? 880 : 440; // A5 或 A4
            oscillator.type = 'sine';
            
            // 设置音量
            gainNode.gain.value = audioSettings.volume * 0.5;
            
            // 播放
            oscillator.start();
            
            // 播放 0.5 秒后停止
            setTimeout(() => {
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
                oscillator.stop(audioContext.currentTime + 0.1);
            }, 500);
            
            // 再播放一次（重复提示）
            setTimeout(() => {
                const oscillator2 = audioContext.createOscillator();
                const gainNode2 = audioContext.createGain();
                oscillator2.connect(gainNode2);
                gainNode2.connect(audioContext.destination);
                oscillator2.frequency.value = isWorkEnd ? 880 : 440;
                oscillator2.type = 'sine';
                gainNode2.gain.value = audioSettings.volume * 0.5;
                oscillator2.start();
                setTimeout(() => {
                    gainNode2.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
                    oscillator2.stop(audioContext.currentTime + 0.1);
                }, 500);
            }, 600);
            
            Logger.info('✅ 浏览器内置提示音播放成功');
        } catch (e) {
            Logger.warn('⚠️ 播放浏览器内置提示音失败:', e);
        }
    }
    
    /**
     * 停止所有提示音
     */
    function stopAllAudio() {
        if (workEndAudio) {
            workEndAudio.pause();
            workEndAudio.currentTime = 0;
        }
        if (breakEndAudio) {
            breakEndAudio.pause();
            breakEndAudio.currentTime = 0;
        }
    }
    
    /**
     * 🔧 性能优化：完全清理音频资源（用于页面卸载）
     */
    function cleanupAudioResources() {
        if (workEndAudio) {
            workEndAudio.pause();
            workEndAudio.src = '';
            workEndAudio = null;
        }
        if (breakEndAudio) {
            breakEndAudio.pause();
            breakEndAudio.src = '';
            breakEndAudio = null;
        }
    }

    /**
     * 显示设置对话框（带分页）
     */
    function showSettingsDialog() {
        // 确保配置已加载
        if (!audioSettings) {
            audioSettings = userSettings.audioSettings;
        }
        if (!userSettings.taskBlockTomatoTime) {
            userSettings.taskBlockTomatoTime = {
                enabled: true,
                enableHourAttr: true,
                hourAttrName: 'custom-tomato-time',
                enableMinuteAttr: false,
                minuteAttrName: 'custom-tomato-minutes'
            };
        }

        // 清理可能存在的旧对话框
        document.getElementById('tomato-settings-dialog')?.remove();
        document.getElementById('tomato-settings-backdrop')?.remove();

        const isMobile = isMobileDevice();

        const backdrop = document.createElement('div');
        backdrop.id = 'tomato-settings-backdrop';
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.3); z-index: 2147483647;
        `;

        const dialog = document.createElement('div');
        dialog.id = 'tomato-settings-dialog';
        if (isMobile) {
            dialog.style.cssText = `
                position: fixed; left: 0; right: 0; bottom: 0;
                background: var(--b3-theme-background); border-radius: 16px 16px 0 0;
                box-shadow: 0 -4px 20px rgba(0,0,0,0.25); z-index: 2147483648;
                padding: 0; width: 100%; max-height: 80vh;
                display: flex; flex-direction: column; pointer-events: auto;
                color: var(--b3-theme-on-background);
                animation: tomatoSlideUp 0.3s ease;
            `;
        } else {
            dialog.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: var(--b3-theme-background); border: 1px solid var(--b3-theme-surface-light);
                border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483648;
                padding: 0; width: 90vw; max-width: 450px; max-height: 80vh;
                display: flex; flex-direction: column; pointer-events: auto;
                color: var(--b3-theme-on-background);
            `;
        }

        // 分页标签
        const tabContainer = document.createElement('div');
        tabContainer.style.cssText = `
            display: flex; border-bottom: 1px solid var(--b3-theme-surface-light);
            padding: 12px 16px 0 16px;
        `;

        const createTab = (id, label, icon) => {
            const tab = document.createElement('button');
            tab.dataset.tab = id;
            tab.innerHTML = `
                <span style="font-size: 16px; line-height: 1;">${icon}</span>
                <span style="font-size: 12px; line-height: 1.1; white-space: nowrap;">${label}</span>
            `;
            tab.style.cssText = `
                flex: 1; padding: 10px; background: transparent; border: none;
                border-bottom: 2px solid transparent; cursor: pointer;
                color: var(--b3-theme-on-surface);
                transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 4px;
            `;
            return tab;
        };

        const mainTab = createTab('main', '主设置', '⚙️');
        const syncTab = createTab('sync', '同步', '☁️');
        const audioTab = createTab('audio', '音频', '🔊');
        const appearanceTab = createTab('appearance', '外观', '✨');
        const taskBlockTab = createTab('taskblock', '任务块', '📋');

        tabContainer.appendChild(mainTab);
        tabContainer.appendChild(syncTab);
        tabContainer.appendChild(audioTab);
        tabContainer.appendChild(appearanceTab);
        tabContainer.appendChild(taskBlockTab);
        dialog.appendChild(tabContainer);

        // 内容容器
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
            flex: 1; overflow-y: auto; padding: 16px;
        `;
        dialog.appendChild(contentContainer);

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border: none; border-radius: 0; cursor: pointer;
            font-size: 14px; font-weight: normal;
            border-top: 1px solid var(--b3-theme-surface-light);
        `;
        closeBtn.onclick = () => {
            dialog.remove();
            backdrop.remove();
        };
        dialog.appendChild(closeBtn);

        // 切换分页
        const switchTab = (tabName) => {
            // 更新标签样式
            [mainTab, audioTab, taskBlockTab, syncTab, appearanceTab].forEach(tab => {
                if (tab.dataset.tab === tabName) {
                    tab.style.borderBottomColor = 'var(--b3-theme-primary)';
                    tab.style.color = 'var(--b3-theme-primary)';
                    tab.style.fontWeight = 'bold';
                } else {
                    tab.style.borderBottomColor = 'transparent';
                    tab.style.color = 'var(--b3-theme-on-surface)';
                    tab.style.fontWeight = 'normal';
                }
            });

            // 清空内容
            contentContainer.innerHTML = '';

            if (tabName === 'main') {
                renderMainSettings(contentContainer);
            } else if (tabName === 'audio') {
                renderAudioSettings(contentContainer);
            } else if (tabName === 'taskblock') {
                renderTaskBlockSettings(contentContainer);
            } else if (tabName === 'appearance') {
                renderAppearanceSettings(contentContainer);
            } else {
                renderSyncSettings(contentContainer);
            }
        };

        // 默认显示主设置
        mainTab.onclick = () => switchTab('main');
        audioTab.onclick = () => switchTab('audio');
        taskBlockTab.onclick = () => switchTab('taskblock');
        appearanceTab.onclick = () => switchTab('appearance');
        syncTab.onclick = () => switchTab('sync');
        switchTab('main');

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        // 点击背景关闭
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                dialog.remove();
                backdrop.remove();
            }
        };
    }

    function renderMainSettings(container) {
        try { ensureUserSettings(); } catch (e) {}

        const makeSection = (title) => {
            const section = document.createElement('div');
            section.style.cssText = `
                padding: 12px; background: var(--b3-theme-surface-light);
                border-radius: 6px; margin-bottom: 12px;
            `;
            const label = document.createElement('div');
            label.textContent = title;
            label.style.cssText = 'font-size: 14px; margin-bottom: 8px; font-weight: 600;';
            section.appendChild(label);
            container.appendChild(section);
            return section;
        };

        const durationsSection = makeSection('番茄钟时长与休息间隔（分钟）');
        const tomatoInput = document.createElement('input');
        tomatoInput.type = 'text';
        tomatoInput.placeholder = '番茄时长列表，例如：5,15,30,60';
        tomatoInput.value = getTomatoDurations().join(',');
        tomatoInput.style.cssText = 'width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); margin-bottom: 8px;';
        tomatoInput.onchange = async (e) => {
            userSettings.main.tomatoDurations = normalizeMinuteList(e.target.value, DEFAULT_TOMATO_DURATIONS);
            await saveUserSettings();
        };
        durationsSection.appendChild(tomatoInput);

        const breakInput = document.createElement('input');
        breakInput.type = 'text';
        breakInput.placeholder = '休息间隔列表，例如：5,10,15,30';
        breakInput.value = getBreakDurations().join(',');
        breakInput.style.cssText = 'width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);';
        breakInput.onchange = async (e) => {
            userSettings.main.breakDurations = normalizeMinuteList(e.target.value, DEFAULT_BREAK_DURATIONS);
            await saveUserSettings();
        };
        durationsSection.appendChild(breakInput);

        const togglesSection = makeSection('开关');
        const mkToggleRow = (text, checked, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding: 10px 0;';
            const label = document.createElement('span');
            label.textContent = text;
            label.style.cssText = 'font-size: 14px;';
            const sw = document.createElement('input');
            sw.type = 'checkbox';
            sw.checked = !!checked;
            sw.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
            sw.onchange = onChange;
            row.appendChild(label);
            row.appendChild(sw);
            togglesSection.appendChild(row);
            return sw;
        };

        mkToggleRow('调试模式（输出日志）', isDebugMode(), async (e) => {
            userSettings.main.debugMode = e.target.checked;
            try { Logger.setDebugEnabled(isDebugMode()); } catch (e) {}
            await saveUserSettings();
        });

        mkToggleRow('启用移动端支持', isMobileSupportEnabled(), async (e) => {
            userSettings.main.enableMobileSupport = e.target.checked;
            await saveUserSettings();
            try { Logger.setDebugEnabled(isDebugMode()); } catch (e) {}
            try {
                if (!isMobileSupportEnabled()) {
                    try { cleanupFloatBarEvents(); } catch (e) {}
                    try { document.getElementById('siyuan-tomato-float-bar')?.remove(); } catch (e) {}
                    try { document.getElementById('tomato-breadcrumb-btn')?.remove(); } catch (e) {}
                } else {
                    try { debouncedInject(); } catch (e) {}
                }
            } catch (e) {}
        });
    }

    /**
     * 渲染音频设置页面
     */
    function renderAudioSettings(container) {
        // 启用提示音开关
        const enableContainer = document.createElement('div');
        enableContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const enableLabel = document.createElement('span');
        enableLabel.textContent = '启用提示音';
        enableLabel.style.cssText = 'font-size: 14px;';
        const enableSwitch = document.createElement('input');
        enableSwitch.type = 'checkbox';
        enableSwitch.checked = audioSettings.enabled;
        enableSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        enableSwitch.onchange = async (e) => {
            audioSettings.enabled = e.target.checked;
            await saveAudioSettings();
            initAudio();
        };
        enableContainer.appendChild(enableLabel);
        enableContainer.appendChild(enableSwitch);
        container.appendChild(enableContainer);

        // 音量控制
        const volumeContainer = document.createElement('div');
        volumeContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const volumeLabel = document.createElement('div');
        volumeLabel.textContent = `音量: ${Math.round(audioSettings.volume * 100)}%`;
        volumeLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = '0';
        volumeSlider.max = '100';
        volumeSlider.value = Math.round(audioSettings.volume * 100);
        volumeSlider.style.cssText = 'width: 100%; cursor: pointer;';
        volumeSlider.oninput = (e) => {
            volumeLabel.textContent = `音量: ${e.target.value}%`;
        };
        volumeSlider.onchange = async (e) => {
            audioSettings.volume = parseInt(e.target.value) / 100;
            await saveAudioSettings();
            initAudio();
        };
        volumeContainer.appendChild(volumeLabel);
        volumeContainer.appendChild(volumeSlider);
        container.appendChild(volumeContainer);

        // 工作结束提示音
        const workSoundContainer = document.createElement('div');
        workSoundContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const workSoundLabel = document.createElement('div');
        workSoundLabel.textContent = '工作结束提示音';
        workSoundLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        const workSoundInput = document.createElement('input');
        workSoundInput.type = 'text';
        workSoundInput.placeholder = '输入音频文件名，如 work.mp3';
        workSoundInput.value = audioSettings.workEndSound || '';
        workSoundInput.style.cssText = `
            width: 100%; padding: 8px; border: 1px solid var(--b3-theme-surface);
            border-radius: 4px; font-size: 13px; margin-bottom: 8px;
            background: var(--b3-theme-background); color: var(--b3-theme-on-background);
        `;
        const workSoundBtns = document.createElement('div');
        workSoundBtns.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';
        const workTestBtn = document.createElement('button');
        workTestBtn.textContent = '🔊 测试';
        workTestBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-primary);
            color: white; border: none; border-radius: 4px; cursor: pointer;
        `;
        workTestBtn.onclick = () => playEndSound('work-end');
        const workClearBtn = document.createElement('button');
        workClearBtn.textContent = '清除';
        workClearBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-surface); border-radius: 4px; cursor: pointer;
        `;
        workClearBtn.onclick = async () => {
            workSoundInput.value = '';
            await setAudioFile('work', '');
        };
        workSoundBtns.appendChild(workTestBtn);
        workSoundBtns.appendChild(workClearBtn);
        workSoundContainer.appendChild(workSoundLabel);
        workSoundContainer.appendChild(workSoundInput);
        workSoundContainer.appendChild(workSoundBtns);

        // 文件上传区域
        const workUploadContainer = document.createElement('div');
        workUploadContainer.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        const workFileInput = document.createElement('input');
        workFileInput.type = 'file';
        workFileInput.accept = 'audio/*';
        workFileInput.style.cssText = 'display: none;';
        const workUploadBtn = document.createElement('button');
        workUploadBtn.textContent = '📤 上传音频文件';
        workUploadBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-primary);
            color: white; border: none; border-radius: 4px; cursor: pointer;
        `;
        const workUploadStatus = document.createElement('span');
        workUploadStatus.style.cssText = 'font-size: 11px; color: var(--b3-theme-on-surface-light);';

        workUploadBtn.onclick = () => workFileInput.click();

        workFileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            workUploadStatus.textContent = '上传中...';
            const filename = file.name;

            try {
                try {
                        await __tomatoEnsureDir(AUDIO_STORAGE_PATH);
                } catch (mkdirErr) {}

                const formData = new FormData();
                formData.append('path', AUDIO_STORAGE_PATH + filename);
                formData.append('isDir', 'false');
                formData.append('file', file);

                const response = await fetch('/api/file/putFile', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (result.code === 0) {
                    workUploadStatus.textContent = '✅ 上传成功';

                    const fileResponse = await fetch('/api/file/getFile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: AUDIO_STORAGE_PATH + filename })
                    });

                    if (fileResponse.ok) {
                        const blob = await fileResponse.blob();
                        const objectUrl = URL.createObjectURL(blob);

                        const newAudio = new Audio(objectUrl);
                        newAudio.volume = audioSettings?.volume || 0.8;
                        newAudio.addEventListener('error', (e) => {
                            Logger.error('🍅 音频播放错误:', e);
                            workUploadStatus.textContent = '⚠️ 播放失败';
                        });

                        workEndAudio = newAudio;
                        Logger.info('🍅 workEndAudio 已更新:', workEndAudio.src);

                        if (!audioSettings) {
                            audioSettings = userSettings.audioSettings || {
                                workEndSound: '',
                                breakEndSound: '',
                                volume: 0.8,
                                enabled: true
                            };
                        }
                        audioSettings.workEndSound = filename;
                        userSettings.audioSettings = audioSettings;
                        await saveUserSettings();
                        workSoundInput.value = filename;

                        setTimeout(() => {
                            playEndSound('work-end').catch(() => {});
                        }, 500);

                        setTimeout(() => {
                            workUploadStatus.textContent = '';
                        }, 3000);
                    } else {
                        workUploadStatus.textContent = '⚠️ 读取失败';
                    }
                } else {
                    workUploadStatus.textContent = '❌ 上传失败';
                }
            } catch (error) {
                workUploadStatus.textContent = '❌ 上传失败';
                Logger.error('上传音频文件失败:', error);
            }
        };

        workUploadContainer.appendChild(workUploadBtn);
        workUploadContainer.appendChild(workFileInput);
        workUploadContainer.appendChild(workUploadStatus);
        workSoundContainer.appendChild(workUploadContainer);

        const workUploadHint = document.createElement('div');
        workUploadHint.innerHTML = `💡 音频将保存到: ${AUDIO_STORAGE_PATH}<br>💡 支持格式: MP3, WAV, OGG, AAC, M4A, FLAC`;
        workUploadHint.style.cssText = 'font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; line-height: 1.5;';
        workSoundContainer.appendChild(workUploadHint);

        container.appendChild(workSoundContainer);

        // 休息结束提示音
        const breakSoundContainer = document.createElement('div');
        breakSoundContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const breakSoundLabel = document.createElement('div');
        breakSoundLabel.textContent = '休息结束提示音';
        breakSoundLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        const breakSoundInput = document.createElement('input');
        breakSoundInput.type = 'text';
        breakSoundInput.placeholder = '输入音频文件名，如 break.mp3';
        breakSoundInput.value = audioSettings.breakEndSound || '';
        breakSoundInput.style.cssText = `
            width: 100%; padding: 8px; border: 1px solid var(--b3-theme-surface);
            border-radius: 4px; font-size: 13px; margin-bottom: 8px;
            background: var(--b3-theme-background); color: var(--b3-theme-on-background);
        `;
        const breakSoundBtns = document.createElement('div');
        breakSoundBtns.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';
        const breakTestBtn = document.createElement('button');
        breakTestBtn.textContent = '🔊 测试';
        breakTestBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-primary);
            color: white; border: none; border-radius: 4px; cursor: pointer;
        `;
        breakTestBtn.onclick = () => playEndSound('break-end');
        const breakClearBtn = document.createElement('button');
        breakClearBtn.textContent = '清除';
        breakClearBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-surface); border-radius: 4px; cursor: pointer;
        `;
        breakClearBtn.onclick = async () => {
            breakSoundInput.value = '';
            await setAudioFile('break', '');
        };
        breakSoundBtns.appendChild(breakTestBtn);
        breakSoundBtns.appendChild(breakClearBtn);
        breakSoundContainer.appendChild(breakSoundLabel);
        breakSoundContainer.appendChild(breakSoundInput);
        breakSoundContainer.appendChild(breakSoundBtns);

        // 文件上传区域
        const breakUploadContainer = document.createElement('div');
        breakUploadContainer.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        const breakFileInput = document.createElement('input');
        breakFileInput.type = 'file';
        breakFileInput.accept = 'audio/*';
        breakFileInput.style.cssText = 'display: none;';
        const breakUploadBtn = document.createElement('button');
        breakUploadBtn.textContent = '📤 上传音频文件';
        breakUploadBtn.style.cssText = `
            flex: 1; padding: 8px; background: var(--b3-theme-primary);
            color: white; border: none; border-radius: 4px; cursor: pointer;
        `;
        const breakUploadStatus = document.createElement('span');
        breakUploadStatus.style.cssText = 'font-size: 11px; color: var(--b3-theme-on-surface-light);';

        breakUploadBtn.onclick = () => breakFileInput.click();

        breakFileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            breakUploadStatus.textContent = '上传中...';
            const filename = file.name;

            try {
                try {
                        await __tomatoEnsureDir(AUDIO_STORAGE_PATH);
                } catch (mkdirErr) {}

                const formData = new FormData();
                formData.append('path', AUDIO_STORAGE_PATH + filename);
                formData.append('isDir', 'false');
                formData.append('file', file);

                const response = await fetch('/api/file/putFile', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (result.code === 0) {
                    breakUploadStatus.textContent = '✅ 上传成功';

                    const fileResponse = await fetch('/api/file/getFile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: AUDIO_STORAGE_PATH + filename })
                    });

                    if (fileResponse.ok) {
                        const blob = await fileResponse.blob();
                        const objectUrl = URL.createObjectURL(blob);

                        const newAudio = new Audio(objectUrl);
                        newAudio.volume = audioSettings?.volume || 0.8;
                        newAudio.addEventListener('error', (e) => {
                            Logger.error('🍅 音频播放错误:', e);
                            breakUploadStatus.textContent = '⚠️ 播放失败';
                        });

                        breakEndAudio = newAudio;
                        Logger.info('🍅 breakEndAudio 已更新:', breakEndAudio.src);

                        if (!audioSettings) {
                            audioSettings = userSettings.audioSettings || {
                                workEndSound: '',
                                breakEndSound: '',
                                volume: 0.8,
                                enabled: true
                            };
                        }
                        audioSettings.breakEndSound = filename;
                        userSettings.audioSettings = audioSettings;
                        await saveUserSettings();
                        breakSoundInput.value = filename;

                        setTimeout(() => {
                            playEndSound('break-end').catch(() => {});
                        }, 500);

                        setTimeout(() => {
                            breakUploadStatus.textContent = '';
                        }, 3000);
                    } else {
                        breakUploadStatus.textContent = '⚠️ 读取失败';
                    }
                } else {
                    breakUploadStatus.textContent = '❌ 上传失败';
                }
            } catch (error) {
                breakUploadStatus.textContent = '❌ 上传失败';
                Logger.error('上传音频文件失败:', error);
            }
        };

        breakUploadContainer.appendChild(breakUploadBtn);
        breakUploadContainer.appendChild(breakFileInput);
        breakUploadContainer.appendChild(breakUploadStatus);
        breakSoundContainer.appendChild(breakUploadContainer);

        const breakUploadHint = document.createElement('div');
        breakUploadHint.innerHTML = `💡 音频将保存到: ${AUDIO_STORAGE_PATH}<br>💡 支持格式: MP3, WAV, OGG, AAC, M4A, FLAC`;
        breakUploadHint.style.cssText = 'font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; line-height: 1.5;';
        breakSoundContainer.appendChild(breakUploadHint);

        container.appendChild(breakSoundContainer);

        // 输入框失焦时保存
        workSoundInput.onchange = async () => await setAudioFile('work', workSoundInput.value);
        breakSoundInput.onchange = async () => await setAudioFile('break', breakSoundInput.value);
    }

    /**
     * 渲染任务块设置页面
     */
    function renderTaskBlockSettings(container) {
        const taskBlockConfig = userSettings.taskBlockTomatoTime || {
            enabled: true,
            hourAttrName: 'custom-tomato-time',
            enableMinuteAttr: false,
            minuteAttrName: 'custom-tomato-minutes'
        };

        // 启用开关
        const enableContainer = document.createElement('div');
        enableContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const enableLabel = document.createElement('span');
        enableLabel.textContent = '启用任务块番茄时间累加';
        enableLabel.style.cssText = 'font-size: 14px;';
        const enableSwitch = document.createElement('input');
        enableSwitch.type = 'checkbox';
        enableSwitch.checked = taskBlockConfig.enabled !== false;
        enableSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        enableSwitch.onchange = async (e) => {
            taskBlockConfig.enabled = e.target.checked;
            userSettings.taskBlockTomatoTime = taskBlockConfig;
            await saveUserSettings();
        };
        enableContainer.appendChild(enableLabel);
        enableContainer.appendChild(enableSwitch);
        container.appendChild(enableContainer);

        // 小时格式开关
        const hourEnableContainer = document.createElement('div');
        hourEnableContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const hourEnableLabel = document.createElement('span');
        hourEnableLabel.textContent = '启用小时格式';
        hourEnableLabel.style.cssText = 'font-size: 14px;';
        const hourEnableSwitch = document.createElement('input');
        hourEnableSwitch.type = 'checkbox';
        hourEnableSwitch.checked = taskBlockConfig.enableHourAttr !== false;
        hourEnableSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        hourEnableSwitch.onchange = async (e) => {
            taskBlockConfig.enableHourAttr = e.target.checked;
            userSettings.taskBlockTomatoTime = taskBlockConfig;
            await saveUserSettings();
            showSettingsDialog();
        };
        hourEnableContainer.appendChild(hourEnableLabel);
        hourEnableContainer.appendChild(hourEnableSwitch);
        container.appendChild(hourEnableContainer);

        // 小时格式属性名称（仅在启用时显示）
        if (taskBlockConfig.enableHourAttr !== false) {
            const hourAttrContainer = document.createElement('div');
            hourAttrContainer.style.cssText = `
                padding: 12px; background: var(--b3-theme-surface-light);
                border-radius: 6px; margin-bottom: 12px; margin-left: 12px;
            `;
            const hourAttrLabel = document.createElement('div');
            hourAttrLabel.textContent = '小时格式属性名称';
            hourAttrLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
            const hourAttrInput = document.createElement('input');
            hourAttrInput.type = 'text';
            hourAttrInput.value = taskBlockConfig.hourAttrName || 'custom-tomato-time';
            hourAttrInput.style.cssText = `
                width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--b3-theme-surface);
                border-radius: 4px; font-size: 13px;
                background: var(--b3-theme-background); color: var(--b3-theme-on-background);
            `;
            hourAttrInput.onchange = async () => {
                taskBlockConfig.hourAttrName = hourAttrInput.value.trim() || 'custom-tomato-time';
                userSettings.taskBlockTomatoTime = taskBlockConfig;
                await saveUserSettings();
            };
            hourAttrContainer.appendChild(hourAttrLabel);
            hourAttrContainer.appendChild(hourAttrInput);
            container.appendChild(hourAttrContainer);
        }

        // 分钟格式开关
        const minuteEnableContainer = document.createElement('div');
        minuteEnableContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const minuteEnableLabel = document.createElement('span');
        minuteEnableLabel.textContent = '启用分钟格式';
        minuteEnableLabel.style.cssText = 'font-size: 14px;';
        const minuteEnableSwitch = document.createElement('input');
        minuteEnableSwitch.type = 'checkbox';
        minuteEnableSwitch.checked = taskBlockConfig.enableMinuteAttr === true;
        minuteEnableSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        minuteEnableSwitch.onchange = async (e) => {
            taskBlockConfig.enableMinuteAttr = e.target.checked;
            userSettings.taskBlockTomatoTime = taskBlockConfig;
            await saveUserSettings();
            showSettingsDialog();
        };
        minuteEnableContainer.appendChild(minuteEnableLabel);
        minuteEnableContainer.appendChild(minuteEnableSwitch);
        container.appendChild(minuteEnableContainer);

        // 分钟格式属性名称（仅在启用时显示）
        if (taskBlockConfig.enableMinuteAttr) {
            const minuteAttrContainer = document.createElement('div');
            minuteAttrContainer.style.cssText = `
                padding: 12px; background: var(--b3-theme-surface-light);
                border-radius: 6px; margin-bottom: 12px;
            `;
            const minuteAttrLabel = document.createElement('div');
            minuteAttrLabel.textContent = '分钟格式属性名称';
            minuteAttrLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
            const minuteAttrInput = document.createElement('input');
            minuteAttrInput.type = 'text';
            minuteAttrInput.value = taskBlockConfig.minuteAttrName || 'custom-tomato-minutes';
            minuteAttrInput.style.cssText = `
                width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--b3-theme-surface);
                border-radius: 4px; font-size: 13px;
                background: var(--b3-theme-background); color: var(--b3-theme-on-background);
            `;
            minuteAttrInput.onchange = async () => {
                taskBlockConfig.minuteAttrName = minuteAttrInput.value.trim() || 'custom-tomato-minutes';
                userSettings.taskBlockTomatoTime = taskBlockConfig;
                await saveUserSettings();
            };
            minuteAttrContainer.appendChild(minuteAttrLabel);
            minuteAttrContainer.appendChild(minuteAttrInput);
            container.appendChild(minuteAttrContainer);
        }
    }

    /**
     * 渲染外观设置页面
     */
    function renderAppearanceSettings(container) {
        const appearance = userSettings.appearance || {
            theme: 'classic',
            customColors: null, // 自定义颜色 {start, end, glow}
            enableNeonEffect: true,
            enableBreathing: true,
            enableSmoothAnimation: true,
            neonIntensity: 0.8,
            autoSwitchTheme: false,
            showIndicator: true,
            enableStopwatchBar: true,
            breathingMinOpacity: 0.5,
            breathingMaxOpacity: 1
        };
        const currentTheme = getCurrentTheme();
        const themeConfig = getThemeConfig(currentTheme);
        const isMobile = isMobileDevice();

        // 标题
        const title = document.createElement('div');
        title.innerHTML = '<strong>✨ 霓虹发光进度条</strong>';
        title.style.cssText = 'margin-bottom: 12px; font-size: 15px;';
        container.appendChild(title);

        // 说明
        const desc = document.createElement('div');
        desc.style.cssText = `
            margin-bottom: 16px; padding: 12px;
            background: var(--b3-theme-surface-light);
            border-radius: 6px; font-size: 12px; line-height: 1.6;
            color: var(--b3-theme-on-surface-light);
        `;
        desc.innerHTML = `
            酷炫的霓虹发光效果，适合夜间使用。提供两种预设配色和自定义颜色：<br>
            • <strong>经典霓虹粉紫</strong> - 浪漫温柔的霓虹粉紫渐变<br>
            • <strong>未来科技蓝绿</strong> - 科技感十足的蓝绿冷色调<br>
            • <strong>自定义颜色</strong> - 设置你自己的专属配色
        `;
        container.appendChild(desc);

        // 主题选择
        const themeLabel = document.createElement('div');
        themeLabel.textContent = '主题风格';
        themeLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px; font-weight: 500;';
        container.appendChild(themeLabel);

        const themeCardsContainer = document.createElement('div');
        themeCardsContainer.className = 'tomato-theme-cards';
        container.appendChild(themeCardsContainer);

        let customCard = null;
        function updateThemeCardSelection() {
            const appearanceNow = userSettings.appearance || appearance;
            const hasCustom = appearanceNow.customColors !== null || appearanceNow.theme === 'custom';
            const presetTheme = appearanceNow.theme;

            for (const card of themeCardsContainer.querySelectorAll('.tomato-theme-card')) {
                const theme = card.dataset.theme || '';
                const active = theme === 'custom' ? hasCustom : (!hasCustom && theme === presetTheme);
                if (active) {
                    card.classList.add('tomato-theme-card--active');
                } else {
                    card.classList.remove('tomato-theme-card--active');
                }
            }

            if (customCard) {
                const preview = customCard.querySelector('.tomato-theme-preview');
                const start = (hasCustom && appearanceNow.customColors?.start) ? appearanceNow.customColors.start : '#ff6b9d';
                const end = (hasCustom && appearanceNow.customColors?.end) ? appearanceNow.customColors.end : '#c44569';
                if (preview) preview.style.background = `linear-gradient(135deg, ${start}, ${end})`;
            }
        }

        // 预设主题卡片
        Object.entries(NEON_THEMES).forEach(([key, config]) => {
            const card = document.createElement('div');
            card.className = 'tomato-theme-card';
            card.dataset.theme = key;
            card.innerHTML = `
                <div class="tomato-theme-preview" style="background: linear-gradient(135deg, ${config.gradientStart}, ${config.gradientEnd});"></div>
                <div class="tomato-theme-info">
                    <span class="tomato-theme-name">${config.name}</span>
                    <span class="tomato-theme-desc">${config.description}</span>
                </div>
            `;
            card.onclick = async () => {
                appearance.theme = key;
                appearance.customColors = null; // 清除自定义颜色
                userSettings.appearance = appearance;
                await saveUserSettings();
                NeonStyleManager.refresh(); // 立即应用设置
                addNeonStyles();
                updateThemeCardSelection();
                showToastDialog('🍅 主题已切换', `已切换到「${config.name}」主题`, 'success');
            };
            themeCardsContainer.appendChild(card);
        });

        // 自定义颜色卡片
        const hasCustomColors = appearance.customColors !== null || appearance.theme === 'custom';
        customCard = document.createElement('div');
        customCard.dataset.theme = 'custom';
        customCard.className = `tomato-theme-card ${hasCustomColors ? 'tomato-theme-card--active' : ''}`;
        customCard.innerHTML = `
            <div class="tomato-theme-preview" style="background: linear-gradient(135deg, ${hasCustomColors && appearance.customColors ? appearance.customColors.start : '#ff6b9d'}, ${hasCustomColors && appearance.customColors ? appearance.customColors.end : '#c44569'});"></div>
            <div class="tomato-theme-info">
                <span class="tomato-theme-name">自定义颜色</span>
                <span class="tomato-theme-desc">设置专属配色方案</span>
            </div>
        `;
        customCard.onclick = async () => {
            // 切换到自定义颜色主题
            appearance.theme = 'custom';
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh();
            addNeonStyles();
            updateThemeCardSelection();
            showToastDialog('🍅 已选择', '请在下方设置自定义颜色', 'success');
            
            // 聚焦到自定义颜色输入框
            setTimeout(() => {
                const startInput = container.querySelector('#custom-color-start');
                if (startInput) startInput.focus();
            }, 100);
        };
        themeCardsContainer.appendChild(customCard);
        updateThemeCardSelection();

        // 自定义颜色设置
        const customColorContainer = document.createElement('div');
        customColorContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const customColorLabel = document.createElement('div');
        customColorLabel.textContent = '自定义颜色设置';
        customColorLabel.style.cssText = 'font-size: 14px; margin-bottom: 12px;';
        customColorContainer.appendChild(customColorLabel);

        // 起始颜色
        const startRow = document.createElement('div');
        startRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
        const startLabel = document.createElement('span');
        startLabel.textContent = '起始颜色:';
        startLabel.style.cssText = 'font-size: 13px; width: 70px;';
        const startTextInput = document.createElement('input');
        startTextInput.type = 'text';
        startTextInput.value = hasCustomColors ? appearance.customColors.start : '#ff6b9d';
        startTextInput.style.cssText = 'flex: 1; padding: 4px 8px; border: 1px solid var(--b3-theme-surface); border-radius: 4px; font-size: 12px; font-family: monospace;';
        startRow.appendChild(startLabel);
        let startPicker = null;
        let startInput = null;
        if (isMobile) {
            startPicker = createMobileColorPickerButton('起始颜色', startTextInput.value, (c) => { startTextInput.value = c; }, { defaultColor: '#FF6B9D', showHexText: false });
            startRow.appendChild(startPicker.element);
        } else {
            startInput = document.createElement('input');
            startInput.type = 'color';
            startInput.id = 'custom-color-start';
            startInput.value = startTextInput.value;
            startInput.style.cssText = 'width: 40px; height: 30px; cursor: pointer; border: none; padding: 0;';
            startRow.appendChild(startInput);
        }
        startRow.appendChild(startTextInput);
        customColorContainer.appendChild(startRow);

        // 结束颜色
        const endRow = document.createElement('div');
        endRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
        const endLabel = document.createElement('span');
        endLabel.textContent = '结束颜色:';
        endLabel.style.cssText = 'font-size: 13px; width: 70px;';
        const endTextInput = document.createElement('input');
        endTextInput.type = 'text';
        endTextInput.value = hasCustomColors ? appearance.customColors.end : '#c44569';
        endTextInput.style.cssText = 'flex: 1; padding: 4px 8px; border: 1px solid var(--b3-theme-surface); border-radius: 4px; font-size: 12px; font-family: monospace;';
        endRow.appendChild(endLabel);
        let endPicker = null;
        let endInput = null;
        if (isMobile) {
            endPicker = createMobileColorPickerButton('结束颜色', endTextInput.value, (c) => { endTextInput.value = c; }, { defaultColor: '#FF6B9D', showHexText: false });
            endRow.appendChild(endPicker.element);
        } else {
            endInput = document.createElement('input');
            endInput.type = 'color';
            endInput.id = 'custom-color-end';
            endInput.value = endTextInput.value;
            endInput.style.cssText = 'width: 40px; height: 30px; cursor: pointer; border: none; padding: 0;';
            endRow.appendChild(endInput);
        }
        endRow.appendChild(endTextInput);
        customColorContainer.appendChild(endRow);

        // 发光颜色
        const glowRow = document.createElement('div');
        glowRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px;';
        const glowLabel = document.createElement('span');
        glowLabel.textContent = '发光颜色:';
        glowLabel.style.cssText = 'font-size: 13px; width: 70px;';
        const glowTextInput = document.createElement('input');
        glowTextInput.type = 'text';
        glowTextInput.value = hasCustomColors ? appearance.customColors.glow : '#ff6b9d';
        glowTextInput.style.cssText = 'flex: 1; padding: 4px 8px; border: 1px solid var(--b3-theme-surface); border-radius: 4px; font-size: 12px; font-family: monospace;';
        glowRow.appendChild(glowLabel);
        let glowPicker = null;
        let glowInput = null;
        if (isMobile) {
            glowPicker = createMobileColorPickerButton('发光颜色', glowTextInput.value, (c) => { glowTextInput.value = c; }, { defaultColor: '#FF6B9D', showHexText: false });
            glowRow.appendChild(glowPicker.element);
        } else {
            glowInput = document.createElement('input');
            glowInput.type = 'color';
            glowInput.id = 'custom-color-glow';
            glowInput.value = glowTextInput.value;
            glowInput.style.cssText = 'width: 40px; height: 30px; cursor: pointer; border: none; padding: 0;';
            glowRow.appendChild(glowInput);
        }
        glowRow.appendChild(glowTextInput);
        customColorContainer.appendChild(glowRow);

        // 保存自定义颜色按钮
        const saveCustomBtn = document.createElement('button');
        saveCustomBtn.textContent = '💾 保存自定义颜色';
        saveCustomBtn.style.cssText = `
            width: 100%; padding: 8px; margin-top: 8px;
            background: var(--b3-theme-primary); color: white;
            border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
        `;
        saveCustomBtn.onclick = async () => {
            const customStart = startTextInput.value.trim();
            const customEnd = endTextInput.value.trim();
            const customGlow = glowTextInput.value.trim();

            // 验证颜色格式
            const colorRegex = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
            if (!colorRegex.test(customStart) || !colorRegex.test(customEnd) || !colorRegex.test(customGlow)) {
                showToastDialog('格式错误', '请输入有效的十六进制颜色值（如 #ff6b9d）', 'error');
                return;
            }

            appearance.theme = 'custom';
            appearance.customColors = {
                start: customStart,
                end: customEnd,
                glow: customGlow
            };
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
            addNeonStyles();
            updateThemeCardSelection();
            showToastDialog('保存成功', '自定义颜色已应用', 'success');
        };
        customColorContainer.appendChild(saveCustomBtn);

        // 颜色输入同步
        const syncColorInputs = (colorInput, textInput) => {
            colorInput.oninput = () => { textInput.value = colorInput.value; };
            textInput.oninput = () => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(textInput.value)) {
                    colorInput.value = textInput.value;
                }
            };
        };
        if (!isMobile) {
            syncColorInputs(startInput, startTextInput);
            syncColorInputs(endInput, endTextInput);
            syncColorInputs(glowInput, glowTextInput);
        } else {
            startTextInput.oninput = () => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(startTextInput.value)) startPicker?.setColor(startTextInput.value);
            };
            endTextInput.oninput = () => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(endTextInput.value)) endPicker?.setColor(endTextInput.value);
            };
            glowTextInput.oninput = () => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(glowTextInput.value)) glowPicker?.setColor(glowTextInput.value);
            };
        }

        container.appendChild(customColorContainer);

        // 功能开关
        const featuresTitle = document.createElement('div');
        featuresTitle.innerHTML = '<strong style="font-size: 15px;">🎛️ 功能开关</strong>';
        featuresTitle.style.cssText = 'margin: 20px 0 12px;';
        container.appendChild(featuresTitle);

        // 霓虹发光开关
        const neonContainer = document.createElement('div');
        neonContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const neonLabel = document.createElement('span');
        neonLabel.textContent = '启用霓虹发光效果';
        neonLabel.style.cssText = 'font-size: 14px;';
        const neonSwitch = document.createElement('input');
        neonSwitch.type = 'checkbox';
        neonSwitch.checked = appearance.enableNeonEffect !== false;
        neonSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        neonSwitch.onchange = async (e) => {
            appearance.enableNeonEffect = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        neonContainer.appendChild(neonLabel);
        neonContainer.appendChild(neonSwitch);
        container.appendChild(neonContainer);

        // 呼吸动画开关
        const breathingContainer = document.createElement('div');
        breathingContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const breathingLabel = document.createElement('span');
        breathingLabel.innerHTML = '启用呼吸动画 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(计时运行时才呼吸)</span>';
        breathingLabel.style.cssText = 'font-size: 14px;';
        const breathingSwitch = document.createElement('input');
        breathingSwitch.type = 'checkbox';
        breathingSwitch.checked = appearance.enableBreathing !== false;
        breathingSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        breathingSwitch.onchange = async (e) => {
            appearance.enableBreathing = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        breathingContainer.appendChild(breathingLabel);
        breathingContainer.appendChild(breathingSwitch);
        container.appendChild(breathingContainer);

        // 呼吸速度选择
        const breathingSpeedContainer = document.createElement('div');
        breathingSpeedContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
            opacity: ${appearance.enableBreathing !== false ? '1' : '0.5'};
            pointer-events: ${appearance.enableBreathing !== false ? 'auto' : 'none'};
        `;
        const breathingSpeedLabel = document.createElement('div');
        breathingSpeedLabel.innerHTML = '呼吸速度 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(呼吸明暗变化的速度)</span>';
        breathingSpeedLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        breathingSpeedContainer.appendChild(breathingSpeedLabel);
        
        const speedOptions = [
            { value: 'slow', label: '慢 (4秒)', duration: '4s' },
            { value: 'normal', label: '正常 (3秒)', duration: '3s' },
            { value: 'fast', label: '快 (2秒)', duration: '2s' }
        ];
        
        speedOptions.forEach(opt => {
            const radioLabel = document.createElement('label');
            radioLabel.style.cssText = `
                display: inline-flex; align-items: center; margin-right: 12px; cursor: pointer;
                padding: 6px 12px; border-radius: 4px; font-size: 13px;
                border: 1px solid ${(appearance.breathingSpeed || 'normal') === opt.value ? 'var(--b3-theme-primary)' : 'var(--b3-theme-surfaceVariant)'};
                background: ${(appearance.breathingSpeed || 'normal') === opt.value ? 'var(--b3-theme-surface-light)' : 'var(--b3-theme-background)'};
                transition: all 0.2s ease;
            `;
            radioLabel.onmouseenter = () => {
                radioLabel.style.borderColor = 'var(--b3-theme-primary)';
            };
            radioLabel.onmouseleave = () => {
                radioLabel.style.borderColor = (appearance.breathingSpeed || 'normal') === opt.value 
                    ? 'var(--b3-theme-primary)' 
                    : 'var(--b3-theme-surfaceVariant)';
            };
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'breathing-speed';
            radio.value = opt.value;
            radio.checked = (appearance.breathingSpeed || 'normal') === opt.value;
            radio.style.cssText = 'display: none;'; // 隐藏原生单选框，使用label作为选择器
            
            radio.onchange = async (e) => {
                if (e.target.checked) {
                    appearance.breathingSpeed = opt.value;
                    userSettings.appearance = appearance;
                    await saveUserSettings();
                    NeonStyleManager.refresh();
                    showToastDialog('🍅 已设置', `呼吸速度: ${opt.label}`, 'success');
                }
            };
            
            radioLabel.appendChild(radio);
            radioLabel.appendChild(document.createTextNode(opt.label));
            breathingSpeedContainer.appendChild(radioLabel);
        });
        container.appendChild(breathingSpeedContainer);

        const breathingOpacityContainer = document.createElement('div');
        breathingOpacityContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
            opacity: ${appearance.enableBreathing !== false ? '1' : '0.5'};
            pointer-events: ${appearance.enableBreathing !== false ? 'auto' : 'none'};
        `;
        const breathingOpacityTitle = document.createElement('div');
        breathingOpacityTitle.innerHTML = '呼吸透明度 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(控制呼吸明暗范围)</span>';
        breathingOpacityTitle.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        breathingOpacityContainer.appendChild(breathingOpacityTitle);

        const minRow = document.createElement('div');
        minRow.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';
        const minLabel = document.createElement('div');
        minLabel.style.cssText = 'width: 64px; font-size: 13px; opacity: 0.85;';
        minLabel.textContent = '最低';
        const minValue = document.createElement('div');
        minValue.style.cssText = 'width: 44px; font-size: 12px; opacity: 0.75; text-align: right;';
        const minSlider = document.createElement('input');
        minSlider.type = 'range';
        minSlider.min = '5';
        minSlider.max = '100';
        minSlider.step = '1';
        minSlider.value = String(Math.round((Number(appearance.breathingMinOpacity ?? 0.5)) * 100));
        minSlider.style.cssText = 'flex: 1; cursor: pointer;';
        minRow.appendChild(minLabel);
        minRow.appendChild(minSlider);
        minRow.appendChild(minValue);
        breathingOpacityContainer.appendChild(minRow);

        const maxRow = document.createElement('div');
        maxRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        const maxLabel = document.createElement('div');
        maxLabel.style.cssText = minLabel.style.cssText;
        maxLabel.textContent = '最高';
        const maxValue = document.createElement('div');
        maxValue.style.cssText = minValue.style.cssText;
        const maxSlider = document.createElement('input');
        maxSlider.type = 'range';
        maxSlider.min = '5';
        maxSlider.max = '100';
        maxSlider.step = '1';
        maxSlider.value = String(Math.round((Number(appearance.breathingMaxOpacity ?? 1)) * 100));
        maxSlider.style.cssText = minSlider.style.cssText;
        maxRow.appendChild(maxLabel);
        maxRow.appendChild(maxSlider);
        maxRow.appendChild(maxValue);
        breathingOpacityContainer.appendChild(maxRow);

        const updateBreathingOpacityLabels = () => {
            minValue.textContent = `${minSlider.value}%`;
            maxValue.textContent = `${maxSlider.value}%`;
        };
        updateBreathingOpacityLabels();

        const commitBreathingOpacity = async () => {
            let minP = parseInt(minSlider.value, 10) / 100;
            let maxP = parseInt(maxSlider.value, 10) / 100;
            if (!Number.isFinite(minP)) minP = 0.5;
            if (!Number.isFinite(maxP)) maxP = 1;
            if (minP > maxP) {
                const t = minP;
                minP = maxP;
                maxP = t;
                minSlider.value = String(Math.round(minP * 100));
                maxSlider.value = String(Math.round(maxP * 100));
                updateBreathingOpacityLabels();
            }
            appearance.breathingMinOpacity = minP;
            appearance.breathingMaxOpacity = maxP;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh();
        };

        minSlider.oninput = () => {
            updateBreathingOpacityLabels();
        };
        maxSlider.oninput = () => {
            updateBreathingOpacityLabels();
        };
        minSlider.onchange = commitBreathingOpacity;
        maxSlider.onchange = commitBreathingOpacity;
        container.appendChild(breathingOpacityContainer);

        // 指示器开关
        const indicatorContainer = document.createElement('div');
        indicatorContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const indicatorLabel = document.createElement('span');
        indicatorLabel.innerHTML = '显示进度指示器 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(进度条顶端的三角形箭头)</span>';
        indicatorLabel.style.cssText = 'font-size: 14px;';
        const indicatorSwitch = document.createElement('input');
        indicatorSwitch.type = 'checkbox';
        indicatorSwitch.checked = appearance.showIndicator !== false;
        indicatorSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        indicatorSwitch.onchange = async (e) => {
            appearance.showIndicator = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        indicatorContainer.appendChild(indicatorLabel);
        indicatorContainer.appendChild(indicatorSwitch);
        container.appendChild(indicatorContainer);

        // 平滑动画开关
        const smoothContainer = document.createElement('div');
        smoothContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const smoothLabel = document.createElement('span');
        smoothLabel.innerHTML = '启用平滑动画 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(关闭可减少性能消耗)</span>';
        smoothLabel.style.cssText = 'font-size: 14px;';
        const smoothSwitch = document.createElement('input');
        smoothSwitch.type = 'checkbox';
        smoothSwitch.checked = appearance.enableSmoothAnimation !== false;
        smoothSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        smoothSwitch.onchange = async (e) => {
            appearance.enableSmoothAnimation = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        smoothContainer.appendChild(smoothLabel);
        smoothContainer.appendChild(smoothSwitch);
        container.appendChild(smoothContainer);

        // 自动切换主题开关
        const autoSwitchContainer = document.createElement('div');
        autoSwitchContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const autoSwitchLabel = document.createElement('span');
        autoSwitchLabel.innerHTML = '根据时间自动切换主题 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(6-12点粉色、12-18点蓝色、18-22点粉色、22-6点深蓝)</span>';
        autoSwitchLabel.style.cssText = 'font-size: 14px;';
        const autoSwitchSwitch = document.createElement('input');
        autoSwitchSwitch.type = 'checkbox';
        autoSwitchSwitch.checked = appearance.autoSwitchTheme === true;
        autoSwitchSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        autoSwitchSwitch.onchange = async (e) => {
            appearance.autoSwitchTheme = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        autoSwitchContainer.appendChild(autoSwitchLabel);
        autoSwitchContainer.appendChild(autoSwitchSwitch);
        container.appendChild(autoSwitchContainer);

        // 正计时进度条开关
        const stopwatchBarContainer = document.createElement('div');
        stopwatchBarContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const stopwatchBarLabel = document.createElement('span');
        stopwatchBarLabel.innerHTML = '正计时进度条 <span style="font-size: 11px; color: var(--b3-theme-on-surface-light);">(默认绿色，进行时呼吸)</span>';
        stopwatchBarLabel.style.cssText = 'font-size: 14px;';
        const stopwatchBarSwitch = document.createElement('input');
        stopwatchBarSwitch.type = 'checkbox';
        stopwatchBarSwitch.checked = appearance.enableStopwatchBar !== false;
        stopwatchBarSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        stopwatchBarSwitch.onchange = async (e) => {
            appearance.enableStopwatchBar = e.target.checked;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        stopwatchBarContainer.appendChild(stopwatchBarLabel);
        stopwatchBarContainer.appendChild(stopwatchBarSwitch);
        container.appendChild(stopwatchBarContainer);

        // 霓虹强度调节
        const intensityTitle = document.createElement('div');
        intensityTitle.innerHTML = '<strong style="font-size: 15px;">💡 效果强度</strong>';
        intensityTitle.style.cssText = 'margin: 20px 0 12px;';
        container.appendChild(intensityTitle);

        const intensityContainer = document.createElement('div');
        intensityContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const intensityLabel = document.createElement('div');
        intensityLabel.textContent = `霓虹发光强度: ${Math.round((appearance.neonIntensity || 0.8) * 100)}%`;
        intensityLabel.style.cssText = 'font-size: 14px; margin-bottom: 8px;';
        const intensitySlider = document.createElement('input');
        intensitySlider.type = 'range';
        intensitySlider.min = '20';
        intensitySlider.max = '100';
        intensitySlider.value = Math.round((appearance.neonIntensity || 0.8) * 100);
        intensitySlider.style.cssText = 'width: 100%; cursor: pointer;';
        intensitySlider.oninput = (e) => {
            intensityLabel.textContent = `霓虹发光强度: ${e.target.value}%`;
        };
        intensitySlider.onchange = async (e) => {
            appearance.neonIntensity = parseInt(e.target.value) / 100;
            userSettings.appearance = appearance;
            await saveUserSettings();
            NeonStyleManager.refresh(); // 立即应用设置
        };
        intensityContainer.appendChild(intensityLabel);
        intensityContainer.appendChild(intensitySlider);
        container.appendChild(intensityContainer);

        // 效果预览
        const previewTitle = document.createElement('div');
        previewTitle.innerHTML = '<strong style="font-size: 15px;">👀 效果预览</strong>';
        previewTitle.style.cssText = 'margin: 20px 0 12px;';
        container.appendChild(previewTitle);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'tomato-preview-container';
        // 获取当前呼吸设置
        const isBreathing = appearance.enableBreathing !== false;
        previewContainer.innerHTML = `
            <div class="tomato-preview-progress">
                <div class="tomato-preview-bar ${isBreathing ? 'tomato-preview--breathing' : ''}" style="width: 60%;"></div>
                <div class="tomato-preview-indicator ${isBreathing ? 'breathing' : ''}"></div>
            </div>
        `;
        container.appendChild(previewContainer);
    }

    /**
     * 渲染同步设置页面
     */
    function renderSyncSettings(container) {
        // 同步说明
        const intro = document.createElement('div');
        intro.style.cssText = `
            margin-bottom: 16px; padding: 12px;
            background: var(--b3-theme-surface-light);
            border-radius: 6px; font-size: 12px; line-height: 1.6;
        `;
        intro.innerHTML = `
            <strong>☁️ 多端同步说明</strong><br>
            • 开启后，计时状态可在多个设备间自动同步<br>
            • 状态保存到云端，刷新页面或切换设备可继续计时<br>
            • 序列号用于冲突解决，保证数据一致性
        `;
        container.appendChild(intro);

        const syncEnableContainer = document.createElement('div');
        syncEnableContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const syncEnableLabel = document.createElement('span');
        syncEnableLabel.textContent = '启用多端同步';
        syncEnableLabel.style.cssText = 'font-size: 14px;';
        const syncEnableSwitch = document.createElement('input');
        syncEnableSwitch.type = 'checkbox';
        syncEnableSwitch.checked = isSyncEnabled();
        syncEnableSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        syncEnableContainer.appendChild(syncEnableLabel);
        syncEnableContainer.appendChild(syncEnableSwitch);
        container.appendChild(syncEnableContainer);

        // 同步状态显示（只读）
        const syncStatusContainer = document.createElement('div');
        syncStatusContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const syncStatusLabel = document.createElement('span');
        syncStatusLabel.textContent = '同步功能状态';
        syncStatusLabel.style.cssText = 'font-size: 14px;';
        const syncStatusValue = document.createElement('span');
        const refreshSyncStatus = () => {
            const enabled = isSyncEnabled();
            syncStatusValue.textContent = enabled ? '✅ 已开启' : '❌ 未开启';
            syncStatusValue.style.cssText = `font-size: 14px; color: ${enabled ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface-light)'};`;
        };
        refreshSyncStatus();
        syncStatusContainer.appendChild(syncStatusLabel);
        syncStatusContainer.appendChild(syncStatusValue);
        container.appendChild(syncStatusContainer);

        syncEnableSwitch.onchange = async (e) => {
            userSettings.sync.enabled = e.target.checked;
            await saveUserSettings();
            refreshSyncStatus();
            try {
                if (isSyncEnabled()) {
                    if (SyncManager && SyncManager.startPolling) {
                        SyncManager.startPolling();
                        SyncManager.poll(true);
                    }
                } else {
                    if (SyncManager && SyncManager.stopPolling) {
                        SyncManager.stopPolling();
                    }
                }
            } catch (e) {}
        };

        // 当前状态
        const statusContainer = document.createElement('div');
        statusContainer.style.cssText = `
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        
        let currentStatus = '空闲';
        if (syncState.status === 'RUNNING') {
            currentStatus = '运行中';
        } else if (syncState.status === 'PAUSED') {
            currentStatus = '已暂停';
        } else if (syncState.status === 'COMPLETED') {
            currentStatus = '已完成';
        }
        
        statusContainer.innerHTML = `
            <div style="font-size: 14px; margin-bottom: 8px;"><strong>当前状态</strong></div>
            <div style="font-size: 13px; color: var(--b3-theme-on-surface);">
                模式: ${syncState.mode === 'countdown' ? '倒计时' : syncState.mode === 'stopwatch' ? '正计时' : '休息'}\<br>
                状态: ${currentStatus}\<br>
                序列号: ${syncState.sequenceId || 0}\<br>
                设备ID: ${SYNC_DEVICE_ID}
            </div>
        `;
        container.appendChild(statusContainer);

        // 自动触发同步开关
        const autoSyncContainer = document.createElement('div');
        autoSyncContainer.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px; background: var(--b3-theme-surface-light);
            border-radius: 6px; margin-bottom: 12px;
        `;
        const autoSyncLabel = document.createElement('span');
        autoSyncLabel.textContent = '状态切换自动触发思源同步';
        autoSyncLabel.style.cssText = 'font-size: 14px;';
        
        const autoSyncSwitch = document.createElement('input');
        autoSyncSwitch.type = 'checkbox';
        // 确保 userSettings.sync 存在
        if (!userSettings.sync) userSettings.sync = { autoTriggerSiyuanSync: true };
        
        autoSyncSwitch.checked = userSettings.sync.autoTriggerSiyuanSync !== false;
        autoSyncSwitch.style.cssText = 'width: 20px; height: 20px; cursor: pointer;';
        autoSyncSwitch.onchange = async (e) => {
            userSettings.sync.autoTriggerSiyuanSync = e.target.checked;
            await saveUserSettings();
            Logger.info('🔄 设置更新: autoTriggerSiyuanSync =', userSettings.sync.autoTriggerSiyuanSync);
        };
        
        autoSyncContainer.appendChild(autoSyncLabel);
        autoSyncContainer.appendChild(autoSyncSwitch);
        container.appendChild(autoSyncContainer);

        // 手动同步按钮
        const syncBtn = document.createElement('button');
        syncBtn.innerHTML = '🔄 立即同步';
        syncBtn.style.cssText = `
            width: 100%; padding: 10px; margin-top: 12px;
            background: var(--b3-theme-primary); color: white;
            border: none; border-radius: 6px; cursor: pointer;
            font-size: 13px;
        `;
        syncBtn.onclick = async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = '同步中...';
            try {
                if (window.tomatoSync && window.tomatoSync.forceSync) {
                    await window.tomatoSync.forceSync();
                    showToastDialog('同步成功', '状态已更新', 'success');
                }
            } catch (e) {
                showToastDialog('同步失败', e.message, 'error');
            }
            syncBtn.disabled = false;
            syncBtn.textContent = '🔄 立即同步';
        };
        container.appendChild(syncBtn);

        // 暂停记录（如果有）
        if (syncState.pausedIntervals && syncState.pausedIntervals.length > 0) {
            const pausedContainer = document.createElement('div');
            pausedContainer.style.cssText = `
                padding: 12px; background: var(--b3-theme-surface-light);
                border-radius: 6px; margin-top: 12px; font-size: 12px;
            `;
            pausedContainer.innerHTML = `
                <div style="margin-bottom: 8px;"><strong>暂停记录</strong></div>
                <div style="color: var(--b3-theme-on-surface);">
                    暂停次数: ${syncState.pausedIntervals.length}次
                </div>
            `;
            container.appendChild(pausedContainer);
        }
    }

    /**
     * 在移动端面包屑栏右上角添加番茄按钮
     */
    function addMobileBreadcrumbButton() {
        if (!isMobileDevice() || !isMobileSupportEnabled()) return;

        // 检查是否已存在按钮
        if (document.getElementById('tomato-breadcrumb-btn')) {
            return;
        }

        // 等待面包屑栏渲染
        const tryAddButton = () => {
            const breadcrumb = document.querySelector('.protyle-breadcrumb');
            if (!breadcrumb) {
                // 如果面包屑还没出现，设置定时器重试
                setTimeout(tryAddButton, 500);
                return;
            }

            // 检查按钮是否已存在
            if (document.getElementById('tomato-breadcrumb-btn')) {
                return;
            }

            // 创建番茄按钮
            const tomatoBtn = document.createElement('button');
            tomatoBtn.id = 'tomato-breadcrumb-btn';
            tomatoBtn.innerHTML = '🍅';
            tomatoBtn.title = '打开番茄钟';
            tomatoBtn.style.cssText = `
                width: 28px;
                height: 28px;
                padding: 0;
                margin: 0 4px;
                background: transparent;
                color: var(--b3-theme-on-surface, inherit);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                transition: all 0.2s;
                z-index: 10;
            `;

            tomatoBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                Logger.info('🍅 面包屑按钮被点击');

                // 获取悬浮条元素
                const floatBar = document.getElementById('siyuan-tomato-float-bar');

                // 检查悬浮条是否当前可见
                const isFloatBarVisible = floatBar && floatBar.style.display !== 'none' && floatBar.style.opacity !== '0';

                if (isFloatBarVisible) {
                    // 🔧 v9.0 修复：使用菜单的关闭逻辑
                    // 如果悬浮条可见，则关闭它（应用菜单的关闭逻辑）
                    cleanupFloatBarEvents();
                    floatBar.remove();
                    isUsingFloatBar = false;
                    // 清空引用
                    timeDisplay = null;
                    controlButton = null;
                    // 标记用户主动关闭
                    floatBarHiddenByUser = true;
                    Logger.info('🍅 悬浮条已关闭');
                } else {
                    // 🔧 v9.0 修复：显示前先清除关闭标记
                    floatBarHiddenByUser = false;
                    
                    // 如果悬浮条不可见，则显示它
                    // 如果计时器还没初始化，先初始化
                    if (!isUsingFloatBar) {
                        // 创建悬浮条
                        addFloatBarStyle();
                        if (createDraggableFloatBar()) {
                            isUsingFloatBar = true;
                            Logger.info('🍅 已创建悬浮条');
                        }
                    }

                    // 显示悬浮条
                    showFloatBar();
                    Logger.info('🍅 显示悬浮条');
                }
            };

            // 添加到面包屑栏的末尾（右上角位置）
            breadcrumb.appendChild(tomatoBtn);
            Logger.info('🍅 面包屑按钮已添加');
        };

        // 延迟执行，等待面包屑栏渲染
        setTimeout(tryAddButton, 1000);
    }

    /**
     * 在面包屑按钮之后监听面包屑栏变化，及时添加按钮
     */
    function observeBreadcrumbForMobile() {
        if (!isMobileDevice() || !isMobileSupportEnabled()) return;

        // 先尝试添加一次
        addMobileBreadcrumbButton();

        // 使用 MutationObserver 监听面包屑栏变化
        const observer = new MutationObserver(() => {
            addMobileBreadcrumbButton();
        });

        // 监听整个文档的子节点变化
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 🔧 性能优化：存储 Observer 引用，用于后续清理
        mutationObservers.push(observer);
        // 保存观察者引用，避免被垃圾回收
        window.tomatoBreadcrumbObserver = observer;
    }

    async function initialize() {
        Logger.info('🍅 番茄钟 v9.1 初始化...');
        
        // v8.6 修复：使用 syncState 替代 localStorage 状态恢复
        let stateRestored = false;
        
        await ensureTomatoStorageMigration();
        await loadUserSettings();
        try {
            if (SETTINGS_FILE_PATH === NEW_SETTINGS_FILE_PATH) {
                const s = await __tomatoGetFileText(NEW_SETTINGS_FILE_PATH);
                if (!s.exists) await saveUserSettings();
            }
            if (HISTORY_FILE_PATH === NEW_HISTORY_FILE_PATH) {
                const h = await __tomatoGetFileText(NEW_HISTORY_FILE_PATH);
                if (!h.exists) await __tomatoPutFileText(NEW_HISTORY_FILE_PATH, '[]');
            }
        } catch (e) {}
        // 确保 audioSettings 对象存在（兼容旧配置）
        if (!userSettings.audioSettings) {
            userSettings.audioSettings = {
                workEndSound: '',
                breakEndSound: '',
                volume: 0.8,
                enabled: true
            };
        }
        // 确保 taskBlockTomatoTime 对象存在（兼容旧配置）
        if (!userSettings.taskBlockTomatoTime) {
            userSettings.taskBlockTomatoTime = {
                enabled: true,
                enableHourAttr: true,
                hourAttrName: 'custom-tomato-time',
                enableMinuteAttr: false,
                minuteAttrName: 'custom-tomato-minutes'
            };
        }
        // 确保 audioSettings 引用 userSettings 中的配置
        audioSettings = userSettings.audioSettings;
        Logger.info('🍅 audioSettings 初始化:', JSON.stringify(audioSettings));
        await loadFocusTimeSettings();
        try {
            if (FOCUS_TIME_SETTINGS_PATH === NEW_FOCUS_TIME_SETTINGS_PATH) {
                const f = await __tomatoGetFileText(NEW_FOCUS_TIME_SETTINGS_PATH);
                if (!f.exists) await saveFocusTimeSettings();
            }
        } catch (e) {}
        const records = await loadHistoryRecords();
        Logger.info('🍅 历史记录条数:', records.length);
        window.showPage = showPage;
        
        // ========== 多端同步：初始化同步管理器 ==========
        if (isSyncEnabled()) {
            let lastSyncedRemainingSeconds = null;

            const handleStateChange = (newState) => {
                const now = Date.now();

                const MIN_STATE_UPDATE_INTERVAL = 500;
                if (handleStateChange._lastTime && now - handleStateChange._lastTime < MIN_STATE_UPDATE_INTERVAL) {
                    Logger.debug('🔄 handleStateChange: 状态更新过于频繁，跳过');
                    return;
                }
                handleStateChange._lastTime = now;

                // 🔧 修复：如果是本地设备发起的更新，跳过状态重置（避免显示跳动）
                if (newState.lastModifiedDevice === SYNC_DEVICE_ID && isRunning) {
                    Logger.debug('🔄 handleStateChange: 本地设备发起的更新且正在运行，跳过');
                    syncState = newState;
                    return;
                }

                const isLocalStateInitial = !syncState?.startTime && syncState?.status === 'IDLE';

                Logger.info('🔄 SyncManager 回调：接收到云端状态更新', {
                    isLocalStateInitial: isLocalStateInitial,
                    localStatus: syncState?.status,
                    localStartTime: syncState?.startTime,
                    remoteStatus: newState.status,
                    remoteStartTime: newState.startTime,
                    remoteSequenceId: newState.sequenceId
                });

                if (isLocalStateInitial && newState.status === 'IDLE') {
                    Logger.info('🔄 SyncManager: 首次初始化且云端为空闲，跳过更新');
                    syncState = newState;
                    return;
                }

                if (isLocalStateInitial && newState.startTime && newState.status !== 'IDLE') {
                    Logger.info('🔄 SyncManager: 恢复云端状态');
                    syncState = newState;
                    updateFromSyncState();

                    if (syncState.status === 'RUNNING') {
                        isRunning = true;
                        isTimerPaused = false;
                    } else if (syncState.status === 'PAUSED') {
                        isRunning = false;
                        isTimerPaused = true;
                        if (timerMode !== 'stopwatch' && timerMode !== 'stopwatch-break') {
                            pausedRemainingSeconds = remainingSeconds;
                        }
                    }

                    if (syncState.startTime) startTime = syncState.startTime;
                    if (syncState.mode) timerMode = syncState.mode;
                    if (syncState.duration) currentDuration = Math.round(syncState.duration / 60);

                    // 🔧 v9.0 修复：恢复本地时间戳变量，以便重置时能保存记录
                    if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                        const savedStopwatchStartTime = syncState.stopwatchStartTimeMs || syncState.startTime;
                        if (savedStopwatchStartTime) {
                            stopwatchStartTimeMs = savedStopwatchStartTime;
                            stopwatchStartTimestamp = new Date(savedStopwatchStartTime).toISOString();

                            if (syncState.pausedElapsedSeconds !== null && syncState.pausedElapsedSeconds !== undefined) {
                                elapsedSeconds = syncState.pausedElapsedSeconds;
                                pausedRemainingSeconds = elapsedSeconds;
                            } else {
                                if (syncState.pausedIntervals && syncState.pausedIntervals.length > 0) {
                                    let totalPausedTime = 0;
                                    for (const interval of syncState.pausedIntervals) {
                                        totalPausedTime += (interval.end - interval.start);
                                    }
                                    const now = Date.now();
                                    const elapsedSinceStart = now - stopwatchStartTimeMs;
                                    const actualElapsedMs = elapsedSinceStart - totalPausedTime;
                                    elapsedSeconds = Math.min(Math.floor(actualElapsedMs / 1000), 8 * 3600);
                                } else {
                                    const now = Date.now();
                                    const elapsedMs = now - stopwatchStartTimeMs;
                                    elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), 8 * 3600);
                                }
                                pausedRemainingSeconds = elapsedSeconds;
                            }
                        }
                    } else {
                        // 🔧 v9.0 修复：倒计时模式也恢复时间戳
                        if (syncState.startTime) {
                            currentStartTimestamp = new Date(syncState.startTime).toISOString();
                            currentStartTimeMs = syncState.startTime;
                        }
                        if (syncState.status === 'PAUSED') {
                            pausedRemainingSeconds = remainingSeconds;
                        } else {
                            pausedRemainingSeconds = null;
                        }
                    }

                    if (timeDisplay) updateDisplay(true);
                    if (controlButton) {
                        controlButton.innerHTML = isRunning ? '⏸️' : '▶️';
                    }

                    if (isRunning && !timerId) {
                        Logger.info('🔄 SyncManager: 启动本地定时器');
                        startLocalTimerLoop();
                    }

                    return;
                }

                const localIsRunning = isRunning && startTime > 0;
                const remoteIsRunning = newState.status === 'RUNNING' && newState.startTime > 0;

                if (localIsRunning && remoteIsRunning) {
                    // 🔧 v9.0 修复：如果远端开始时间不同，说明是重置后重新开始，需要同步新的开始时间
                    if (syncState.startTime !== newState.startTime) {
                        Logger.info('🔄 SyncManager: 远端重新开始计时，同步新的开始时间');
                        Logger.info('🔄 旧开始时间:', syncState.startTime, '新开始时间:', newState.startTime);
                        
                        // 停止本地计时器
                        if (timerId) {
                            clearInterval(timerId);
                            timerId = null;
                        }
                        
                        syncState = newState;
                        updateFromSyncState();
                        
                        // 更新本地开始时间
                        if (syncState.startTime) startTime = syncState.startTime;
                        if (syncState.mode) timerMode = syncState.mode;
                        if (syncState.duration) currentDuration = Math.round(syncState.duration / 60);
                        
                        // 正计时模式恢复时间戳
                        if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                            const savedStopwatchStartTime = syncState.stopwatchStartTimeMs || syncState.startTime;
                            if (savedStopwatchStartTime) {
                                stopwatchStartTimeMs = savedStopwatchStartTime;
                                stopwatchStartTimestamp = new Date(savedStopwatchStartTime).toISOString();
                            }
                        } else {
                            // 倒计时模式恢复时间戳
                            if (syncState.startTime) {
                                currentStartTimestamp = new Date(syncState.startTime).toISOString();
                                currentStartTimeMs = syncState.startTime;
                            }
                        }
                        
                        // 重启本地计时器
                        isRunning = true;
                        isTimerPaused = false;
                        if (controlButton) controlButton.innerHTML = '⏸️';
                        if (timeDisplay) updateDisplay(true);
                        
                        if (!timerId) {
                            startLocalTimerLoop();
                        }
                        
                        Logger.info('🔄 SyncManager: 已同步新的开始时间并重启计时器');
                        return;
                    }
                    
                    // 相同开始时间，忽略
                    Logger.debug('🔄 SyncManager: 本地和云端都在运行同一个计时器，忽略云端进度更新');
                    syncState = newState;
                    return;
                }

                if (newState.status === 'PAUSED' && newState.sequenceId !== syncState?.sequenceId) {
                    Logger.info('🔄 SyncManager: 远端已暂停（新的状态），同步暂停状态');

                    if (timerId) {
                        clearInterval(timerId);
                        timerId = null;
                    }

                    syncState = newState;
                    updateFromSyncState();

                    isRunning = false;
                    isTimerPaused = true;

                    if (timerMode === 'countdown' || timerMode === 'break') {
                        if (!syncState.startTime || syncState.startTime === 0) {
                            if (startTime > 0) {
                                syncState.startTime = startTime;
                            }
                        }
                    }

                    Logger.info('🔄 SyncManager 设置后: isRunning =', isRunning, ', isTimerPaused =', isTimerPaused, ', startTime =', syncState.startTime);

                    if (syncState.mode && syncState.mode !== timerMode) {
                        Logger.info('🔄 SyncManager: 检测到模式变化，从', timerMode, '切换到', syncState.mode);
                        timerMode = syncState.mode;
                    }

                    if (syncState.duration) currentDuration = Math.round(syncState.duration / 60);

                    if (syncState.currentPauseStart) {
                        currentPauseStart = syncState.currentPauseStart;
                    }

                    if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                        const savedStartTime = syncState.stopwatchStartTimeMs || syncState.startTime;
                        if (savedStartTime) {
                            stopwatchStartTimeMs = savedStartTime;
                            startTime = savedStartTime;
                        }

                        if (syncState.pausedElapsedSeconds !== null && syncState.pausedElapsedSeconds !== undefined) {
                            elapsedSeconds = syncState.pausedElapsedSeconds;
                            pausedRemainingSeconds = elapsedSeconds;
                        } else {
                            const elapsedMs = now - stopwatchStartTimeMs;
                            elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), 8 * 3600);
                            pausedRemainingSeconds = elapsedSeconds;
                        }
                    } else {
                        pausedRemainingSeconds = remainingSeconds;
                    }

                    if (controlButton) controlButton.innerHTML = '▶️';
                    if (timeDisplay) updateDisplay(true);

                    Logger.info('🔄 SyncManager: 已同步暂停状态');
                    return;
                }

                if (isTimerPaused && newState.status === 'PAUSED' &&
                    syncState.status === 'PAUSED' &&
                    newState.sequenceId === syncState.sequenceId) {
                    Logger.debug('🔄 SyncManager: 本地已暂停且状态相同，跳过');
                    syncState = newState;
                    return;
                }

                // 🔧 v9.0 修复：处理远端重置（IDLE状态）- 仅当本地正在运行时才处理
                // 注意：不能影响初始化时的状态恢复流程
                if (newState.status === 'IDLE' && (isRunning || isTimerPaused)) {
                    // 只有当远端 sequenceId 更高，或者本地状态不是 IDLE 时才处理
                    if (newState.sequenceId >= (syncState?.sequenceId || 0) || syncState?.status !== 'IDLE') {
                        Logger.info('🔄 SyncManager: 远端已重置，同步停止状态');
                        
                        // 停止本地计时器
                        if (timerId) {
                            clearInterval(timerId);
                            timerId = null;
                        }
                        
                        syncState = newState;
                        
                        // 🔧 修复：重置本地所有计时状态
                        isRunning = false;
                        isTimerPaused = false;
                        startTime = 0;
                        pausedRemainingSeconds = null;
                        currentStartTimestamp = null;
                        currentStartTimeMs = 0;
                        
                        // 🔧 修复：重置正计时相关的所有状态变量
                        if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                            elapsedSeconds = 0;
                            stopwatchDisplayOffset = 0;
                            stopwatchStartTimeMs = 0;
                            stopwatchStartTimestamp = null;
                            stopwatchPausedIntervals = [];
                            currentPauseStart = null;
                        }
                        
                        // 恢复默认显示
                        if (timerMode === 'countdown' || timerMode === 'break') {
                            remainingSeconds = currentDuration * 60;
                        }
                        
                        // 更新任务关联（如果云端清除了）
                        if (!newState.taskBlockId) {
                            currentTaskBlockId = null;
                            currentTaskBlockName = null;
                        }
                        if (!newState.databaseBlockId) {
                            currentDatabaseBlockId = null;
                        }
                        
                        // 更新UI
                        if (controlButton) controlButton.innerHTML = '▶️';
                        if (timeDisplay) updateDisplay();
                        updateTaskBlockIcon();
                        hideProgressBar();
                        
                        Logger.info('🔄 SyncManager: 已同步重置状态');
                        return;
                    }
                }

                if (newState.status === 'RUNNING' && isTimerPaused) {
                    Logger.info('🔄 SyncManager: 远端恢复运行，同步状态');

                    syncState = newState;
                    updateFromSyncState();

                    isRunning = true;
                    isTimerPaused = false;

                    if (syncState.startTime) startTime = syncState.startTime;

                    if (syncState.mode && syncState.mode !== timerMode) {
                        Logger.info('🔄 SyncManager: 检测到模式变化，从', timerMode, '切换到', syncState.mode);
                        timerMode = syncState.mode;
                    }

                    if (syncState.duration) currentDuration = Math.round(syncState.duration / 60);

                    pausedRemainingSeconds = null;

                    if (controlButton) controlButton.innerHTML = '⏸️';
                    if (timeDisplay) updateDisplay(true);

                    if (!timerId) {
                        // 🔧 性能优化：确保清理旧定时器
                        startLocalTimerLoop();
                    }

                    return;
                }

                const previousRemainingSeconds = remainingSeconds;
                const previousMode = timerMode;
                syncState = newState;
                updateFromSyncState();

                if (syncState.mode && syncState.mode !== previousMode) {
                    Logger.info('🔄 SyncManager: 检测到模式变化，从', previousMode, '切换到', syncState.mode);
                    timerMode = syncState.mode;
                }

                if (remainingSeconds !== previousRemainingSeconds || timerMode !== previousMode) {
                    if (timeDisplay) updateDisplay(true);
                    if (controlButton) {
                        controlButton.innerHTML = isRunning ? '⏸️' : '▶️';
                    }
                }

                if (!isRunning && timerId) {
                    clearInterval(timerId);
                    timerId = null;
                }
            };
            
            const initResult = await SyncManager.init(syncState, handleStateChange);
            Logger.info('🔄 SyncManager 初始化完成', {
                restored: initResult.restored,
                status: initResult.state.status,
                startTime: initResult.state.startTime,
                sequenceId: initResult.state.sequenceId
            });
            
            try {
                await SyncManager.poll();
                Logger.info('🔄 SyncManager: 已执行首次轮询');
            } catch (e) {
                Logger.warn('🔄 SyncManager: 首次轮询失败', e.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const currentSyncState = SyncManager.getState();
            
            if (currentSyncState && (currentSyncState.status === 'RUNNING' || currentSyncState.status === 'PAUSED')) {
                if (currentSyncState.status === 'RUNNING') {
                    Logger.info('🔄 SyncManager: 检测到云端计时器运行中');
                    
                    // 🔧 修复：正计时模式使用 elapsed 判断，最长 8 小时；倒计时使用 remaining 判断
                    const isStopwatchMode = currentSyncState.mode === 'stopwatch' || currentSyncState.mode === 'stopwatch-break';
                    const cloudRemaining = StateCalculator.calculateRemaining(currentSyncState);
                    const cloudElapsed = StateCalculator.calculateElapsed(currentSyncState);
                    const MAX_STOPWATCH_SECONDS = 8 * 3600; // 8 小时
                    
                    Logger.info('🔄 云端剩余时间:', cloudRemaining, '秒, 已过时间:', cloudElapsed, '秒, 模式:', currentSyncState.mode);
                    
                    // 🔧 修复：正计时模式只有超过 8 小时才算完成
                    const isExpired = isStopwatchMode ? (cloudElapsed >= MAX_STOPWATCH_SECONDS) : (cloudRemaining <= 0);
                    
                    if (isExpired) {
                        if (currentSyncState.status === 'RUNNING') {
                            Logger.info('🔄 云端计时正常运行后到期，标记为完成');
                            currentSyncState.status = 'COMPLETED';
                            // 🔧 修复：正计时模式使用实际 elapsed 时间作为 duration
                            currentSyncState.duration = isStopwatchMode ? Math.min(cloudElapsed, MAX_STOPWATCH_SECONDS) : (currentSyncState.duration || 1800);
                            
                            const recordData = {
                                start: new Date(currentSyncState.startTime).toISOString(),
                                end: new Date(currentSyncState.startTime + currentSyncState.duration * 1000).toISOString(),
                                durationMin: Math.round(currentSyncState.duration / 60),
                                durationSec: currentSyncState.duration,
                                mode: currentSyncState.mode || 'countdown',
                                timestamp: Date.now(),
                                date: formatDateKey(new Date()),
                                dateTime: new Date().toLocaleString('zh-CN'),
                                timePeriod: getTimePeriod(new Date(currentSyncState.startTime).getHours()),
                                taskBlockId: currentSyncState.taskBlockId || null,
                                taskBlockName: currentSyncState.taskBlockName || null,
                                databaseBlockId: currentSyncState.databaseBlockId || null
                            };
                            
                            try {
                                const records = await loadHistoryRecords();
                                records.push(recordData);
                                await saveHistoryRecords(records);
                                Logger.info('✅ 历史记录已保存（正常运行到期）');
                            } catch (e) {
                                Logger.error('❌ 保存历史记录失败:', e);
                            }
                            
                            await SyncManager.updateLocal(currentSyncState, true);
                            
                            syncState = currentSyncState;
                            isRunning = false;
                            remainingSeconds = 0;
                            
                            if (timeDisplay) updateDisplay(true);
                            if (controlButton) {
                                controlButton.innerHTML = '▶️';
                            }
                            
                            setTimeout(() => {
                                showToastDialog('🍅 时间到！', '该休息一下了～', 'tomato-end', currentSyncState.taskBlockId, currentSyncState.taskBlockName);
                            }, 500);
                        } else {
                            Logger.info('🔄 云端计时暂停状态过期，重置为空闲状态（不生成历史记录）');
                            currentSyncState.status = 'IDLE';
                            currentSyncState.startTime = null;
                            currentSyncState.pausedIntervals = [];
                            currentSyncState.currentPauseStart = null;
                            currentSyncState.pausedElapsedSeconds = null;
                            
                            await SyncManager.updateLocal(currentSyncState, true);
                            
                            syncState = currentSyncState;
                            isRunning = false;
                            isTimerPaused = false;
                            remainingSeconds = currentSyncState.duration || 1800;
                            elapsedSeconds = 0;
                            
                            if (timeDisplay) updateDisplay(true);
                            if (controlButton) {
                                controlButton.innerHTML = '▶️';
                            }
                        }
                    } else {
                        Logger.info('🔄 SyncManager: 恢复云端运行状态');
                        syncState = currentSyncState;
                        updateFromSyncState();
                        
                        isRunning = true;
                        isTimerPaused = false;
                        
                        if (syncState.startTime) {
                            startTime = syncState.startTime;
                        }
                        
                        if (syncState.mode) {
                            timerMode = syncState.mode;
                        }
                        if (syncState.duration) {
                            currentDuration = Math.round(syncState.duration / 60);
                        }
                        
                        if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                            const savedStopwatchStartTime = syncState.stopwatchStartTimeMs || syncState.startTime;
                            if (savedStopwatchStartTime) {
                                stopwatchStartTimeMs = savedStopwatchStartTime;
                                
                                if (syncState.pausedElapsedSeconds !== null && syncState.pausedElapsedSeconds !== undefined) {
                                    elapsedSeconds = syncState.pausedElapsedSeconds;
                                } else {
                                    const now = Date.now();
                                    const elapsedMs = now - stopwatchStartTimeMs;
                                    elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), 8 * 3600);
                                }
                                pausedRemainingSeconds = null;
                            }
                        } else {
                            pausedRemainingSeconds = null;
                        }
                        
                        if (timeDisplay) updateDisplay(true);
                        if (controlButton) {
                            controlButton.innerHTML = '⏸️';
                        }
                        
                        if (!timerId && isRunning && startTime > 0) {
                            Logger.info('🔄 SyncManager: 启动本地定时器（自动恢复计时）');
                            startLocalTimerLoop();
                        }
                    }
                }
                
                if (currentSyncState.status === 'PAUSED') {
                    Logger.info('🔄 SyncManager: 检测到云端计时器处于暂停状态');
                    
                    syncState = currentSyncState;
                    updateFromSyncState();
                    
                    isRunning = false;
                    isTimerPaused = true;
                    
                    pausedRemainingSeconds = remainingSeconds;
                    
                    if (syncState.mode) {
                        timerMode = syncState.mode;
                    }
                    if (syncState.duration) {
                        currentDuration = Math.round(syncState.duration / 60);
                    }

                    if (syncState.currentPauseStart) {
                        currentPauseStart = syncState.currentPauseStart;
                    }

                    if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                        const savedStopwatchStartTime = syncState.stopwatchStartTimeMs || syncState.startTime;
                        if (savedStopwatchStartTime) {
                            stopwatchStartTimeMs = savedStopwatchStartTime;
                            startTime = savedStopwatchStartTime;
                            
                            if (syncState.pausedElapsedSeconds !== null && syncState.pausedElapsedSeconds !== undefined) {
                                elapsedSeconds = syncState.pausedElapsedSeconds;
                                pausedRemainingSeconds = elapsedSeconds;
                            } else {
                                const elapsedMs = Date.now() - stopwatchStartTimeMs;
                                elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), 8 * 3600);
                                pausedRemainingSeconds = elapsedSeconds;
                            }
                        }
                    }
                    
                    if (timerId) {
                        clearInterval(timerId);
                        timerId = null;
                    }
                    
                    if (timeDisplay) updateDisplay(true);
                    if (controlButton) {
                        controlButton.innerHTML = '▶️';
                    }
                }
            } else {
                Logger.info('🔄 SyncManager: 云端无有效状态或状态为空闲');
            }
            
            window.tomatoSync = {
                getState: () => SyncManager.getState(),
                getSequenceId: () => SyncManager.getSequenceId(),
                isRunning: () => SyncManager.isRunning(),
                isPaused: () => SyncManager.isPaused(),
                deviceId: SYNC_DEVICE_ID,
                calculateRemaining: (state) => StateCalculator.calculateRemaining(state),
                forceSync: async () => {
                    Logger.info('🔄 手动触发同步...');
                    await SyncManager.poll();
                    return SyncManager.getState();
                },
                getPausedIntervals: () => syncState?.pausedIntervals || [],
                getCurrentPauseDuration: () => StateCalculator.calculateCurrentPauseDuration(syncState)
            };
            Logger.info('🔄 SyncManager: 已初始化，设备ID:', SYNC_DEVICE_ID);
        }
        
        // 暴露音频配置函数到全局（方便用户在控制台配置）
        window.tomatoAudio = {
            // 获取当前音频配置
            getSettings: () => audioSettings,

            // 设置工作结束提示音文件
            setWorkSound: (filename) => setAudioFile('work', filename),

            // 设置休息结束提示音文件
            setBreakSound: (filename) => setAudioFile('break', filename),

            // 设置音量 (0-1)
            setVolume: async (vol) => {
                audioSettings.volume = Math.max(0, Math.min(1, vol));
                await saveAudioSettings();
                initAudio();
            },

            // 启用/禁用提示音
            enable: async (enabled) => {
                audioSettings.enabled = enabled;
                await saveAudioSettings();
                initAudio();
            },

            // 获取音频文件路径
            getAudioPath: (type) => getAudioPath(type),

            // 音频存储目录
            storagePath: AUDIO_STORAGE_PATH,

            // 测试播放
            testPlay: (type) => playEndSound(type),

            // 获取计时器状态（调试用）
            getTimerState: () => ({
                isRunning,
                timerMode,
                currentDuration,
                remainingSeconds,
                startTime,
                workEndAudioLoaded: !!workEndAudio,
                breakEndAudioLoaded: !!breakEndAudio,
                // 同步状态
                syncState: (isSyncEnabled() && SyncManager && SyncManager.getState) ? SyncManager.getState() : null,
                sequenceId: (isSyncEnabled() && SyncManager && SyncManager.getSequenceId) ? SyncManager.getSequenceId() : null
            })
        };

        // 初始化提示音
        await initAudio();
        Logger.info('🍅 初始化完成，workEndAudio:', !!workEndAudio, 'breakEndAudio:', !!breakEndAudio);

        // 如果状态已恢复，更新显示
        if (stateRestored) {
            Logger.info('💾 状态已恢复，跳过初始化显示设置');
        }

        // 添加高亮样式（无论是否添加到数据库）
        if (!document.getElementById('tomato-task-highlight-style')) {
            const style = document.createElement('style');
            style.id = 'tomato-task-highlight-style';
            style.textContent = `
                .tomato-task-highlight {
                    background-color: rgba(30, 136, 229, 0.15) !important;
                    border-left: 3px solid var(--b3-theme-primary, #1E88E5) !important;
                    padding-left: 8px !important;
                    transition: all 0.3s ease;
                }
                .tomato-db-row-highlight {
                    background-color: rgba(30, 136, 229, 0.15) !important;
                    border-left: 3px solid var(--b3-theme-primary, #1E88E5) !important;
                    transition: all 0.3s ease;
                }
                .tomato-task-link {
                    cursor: pointer;
                    transition: text-decoration 0.2s;
                }
                .tomato-task-link:hover {
                    text-decoration: underline !important;
                }
            `;
            document.head.appendChild(style);
        }

        // 添加霓虹发光效果样式
        addNeonStyles();
        // 确保CSS变量已设置（支持动画中的变量引用）
        NeonStyleManager.updateCSSVariables(getCurrentTheme());
        ensureTimelineSettings();
        startTimelineLoop();
        if (userSettings.timeline?.enabled) {
            updateTimelineBar();
        }

        // 添加任务块菜单功能
        await addTaskBlockMenuFeature();

        // 添加数据库块菜单功能
        await addDatabaseBlockMenuFeature();
        
        // 🔧 修复：移动端初始化完成后，如果有正在运行的计时，显示悬浮窗
        if (isMobileDevice() && isMobileSupportEnabled() && MOBILE_FLOAT_BAR_LAZY_SHOW) {
            const hasUnfinishedTimer = isRunning || isTimerPaused || 
                (syncState && syncState.status === 'RUNNING') || 
                (syncState && syncState.status === 'PAUSED');
            
            Logger.info('🍅 initialize() 完成，检查是否需要显示悬浮窗:', {
                isRunning, isTimerPaused, 
                syncStatus: syncState?.status,
                hasUnfinishedTimer
            });
            
            if (hasUnfinishedTimer) {
                Logger.info('🍅 移动端初始化时检测到未完成计时，显示悬浮窗');
                if (!isUsingFloatBar) {
                    addFloatBarStyle();
                    if (createDraggableFloatBar()) {
                        isUsingFloatBar = true;
                        showFloatBar();
                    }
                } else {
                    showFloatBar();
                }
            }
        }
    }
    
    // 设置变更后的刷新函数
    window.refreshHistoryAfterSettingsChange = async () => {
        // 如果历史对话框已打开，直接刷新它
        const dialog = document.getElementById('tomy-tomato-history-dialog');
        const backdrop = document.getElementById('tomy-tomato-history-backdrop');
        if (dialog && backdrop) {
            const currentPage = historyState.currentPage;
            dialog.remove();
            backdrop.remove();
            showHistoryDialog(currentPage);
        }
    };
    
    const inject = () => {
        if (__tomatoDestroyed) return;
        // 检查是否在移动端且移动端支持已禁用（使用8.2版本逻辑）
        if (!isMobileSupportEnabled() && isMobileOrHarmony()) {
            Logger.info('🍅 番茄钟 v9.1：检测到移动端且移动端支持已禁用，已停止运行');
            return;
        }

        // 移动端使用可拖动悬浮条
        if (isMobileDevice() && isMobileSupportEnabled()) {
            // 添加悬浮条样式
            addFloatBarStyle();
            
            // 根据配置决定是否立即显示悬浮条
            if (MOBILE_FLOAT_BAR_LAZY_SHOW) {
                // 懒加载模式
                Logger.info('🍅 番茄钟 v9.1：移动端悬浮条懒加载模式');
                
                // v8.6 修复：初始化完成后检查是否有未完成计时
                const initPromise = initialize();
                
                // 在面包屑栏添加番茄按钮
                observeBreadcrumbForMobile();
                
                // v8.6 修复：初始化完成后检查状态，决定是否显示悬浮条
                initPromise.then(() => {
                    // 🔧 修复：添加延迟确保同步状态已完全加载
                    setTimeout(() => {
                        Logger.info('🍅 inject() 中的 initPromise.then() 执行，floatBarHiddenByUser:', floatBarHiddenByUser, 'isUsingFloatBar:', isUsingFloatBar, 'isRunning:', isRunning, 'isTimerPaused:', isTimerPaused);
                        Logger.info('🍅 syncState:', syncState?.status, syncState?.mode);
                        
                        // v8.6 修复：如果用户主动隐藏了悬浮窗，不再自动显示
                        if (floatBarHiddenByUser) {
                            Logger.info('🍅 用户已主动隐藏悬浮窗，初始化完成时不自动显示');
                            return;
                        }
                        
                        // 🔧 修复：优先使用 syncState 判断，更可靠
                        const hasUnfinishedTimer = isRunning || isTimerPaused || 
                            (syncState && syncState.status === 'RUNNING') || 
                            (syncState && syncState.status === 'PAUSED');

                        if (hasUnfinishedTimer) {
                            Logger.info('🍅 移动端检测到未完成计时，立即显示悬浮条');
                            if (!isUsingFloatBar) {
                                addFloatBarStyle();
                                if (createDraggableFloatBar()) {
                                    isUsingFloatBar = true;
                                    showFloatBar();
                                }
                            } else {
                                showFloatBar();
                            }
                        } else {
                            Logger.info('🍅 移动端无未完成计时，不显示悬浮条');
                        }
                    }, 1000);  // 延迟1秒确保同步状态已加载
                });
                
                return;
            }
            
            // 立即创建悬浮条
            if (createDraggableFloatBar()) {
                isUsingFloatBar = true;
                initialize();
            }
            return;
        }

        // 桌面端使用原有底栏逻辑
        let statusBar = document.querySelector('.layout__dock--bottom .b3-toolbar');
        if (!statusBar) {
            const bars = document.querySelectorAll('.status:not(.fn__hidden)');
            statusBar = bars.length ? bars[bars.length - 1] : null;
        }
        if (statusBar && !statusBar.querySelector('#siyuan-tomato-timer')) {
            createWidget(statusBar);
            initialize();
        }
    };

    // 🔧 性能优化：防抖 inject，避免频繁 DOM 变动导致多次执行
    let injectTimeout = null;
    let injectInitTimeout = null;
    const debouncedInject = () => {
        if (__tomatoDestroyed) return;
        if (injectTimeout) clearTimeout(injectTimeout);
        injectTimeout = setTimeout(inject, 500);
    };

    const cleanupTomato = () => {
        __tomatoDestroyed = true;
        try { if (injectTimeout) clearTimeout(injectTimeout); } catch (e) {}
        try { injectTimeout = null; } catch (e) {}
        try { if (injectInitTimeout) clearTimeout(injectInitTimeout); } catch (e) {}
        try { injectInitTimeout = null; } catch (e) {}
        try { if (timerId) clearInterval(timerId); } catch (e) {}
        try { timerId = null; } catch (e) {}
        try { isRunning = false; } catch (e) {}
        try { isTimerPaused = false; } catch (e) {}
        try { startTime = 0; } catch (e) {}
        try { remainingSeconds = 0; } catch (e) {}
        try { elapsedSeconds = 0; } catch (e) {}
        try { stopwatchStartTimeMs = 0; } catch (e) {}
        try { stopwatchPausedIntervals = []; } catch (e) {}
        try { currentPauseStart = null; } catch (e) {}
        try { floatBarHiddenByUser = true; } catch (e) {}
        try { isUsingFloatBar = false; } catch (e) {}
        try { if (syncState) { syncState.status = 'IDLE'; syncState.startTime = null; syncState.stopwatchStartTimeMs = null; } } catch (e) {}
        try { EventManager.removeAll(); } catch (e) {}

        try { stopAllAudio(); } catch (e) {}
        try { cleanupAudioResources(); } catch (e) {}
        try { cleanupFloatBarEvents(); } catch (e) {}

        try { document.getElementById('tomato-common-style')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-neon-style')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-task-highlight-style')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-color-picker-backdrop')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-color-picker-dialog')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-timeline-settings-backdrop')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-timeline-settings-dialog')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-timeline-date-overlay')?.remove(); } catch (e) {}
        try { document.getElementById('tomy-tomato-icon-click-layer')?.remove(); } catch (e) {}
        try { document.getElementById('tomy-tomato-tooltip')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-time-select-backdrop')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-time-select-dialog')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-settings-backdrop')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-settings-dialog')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-breadcrumb-btn')?.remove(); } catch (e) {}
        try { document.getElementById('tomy-tomato-context-menu')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-task-submenu')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-db-submenu')?.remove(); } catch (e) {}
        try { document.getElementById('siyuan-tomato-timer')?.remove(); } catch (e) {}
        try { document.getElementById('siyuan-tomato-float-bar')?.remove(); } catch (e) {}
        try { removeById('tomy-tomato-toast', 'tomy-tomato-backdrop'); } catch (e) {}
        try { document.getElementById('tomy-tomato-history-dialog')?.remove(); } catch (e) {}
        try { document.getElementById('tomy-tomato-history-backdrop')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-float-bar-style')?.remove(); } catch (e) {}
        try { progressBar?.remove(); } catch (e) {}
        try { progressIndicator?.remove(); } catch (e) {}
        try { stopTimelineLoop(); } catch (e) {}
        try { document.getElementById('tomato-timeline-bar')?.remove(); } catch (e) {}
        try { document.getElementById('tomato-timeline-tooltip')?.remove(); } catch (e) {}

        try {
            for (const observer of mutationObservers) {
                try { observer.disconnect(); } catch (e) {}
            }
            mutationObservers.length = 0;
        } catch (e) {}

        try {
            if (SyncManager && typeof SyncManager.destroy === 'function') SyncManager.destroy();
        } catch (e) {}

        try { delete window.showPage; } catch (e) {}
        try { delete window.refreshHistoryAfterSettingsChange; } catch (e) {}
        try { delete window.tomatoSync; } catch (e) {}
        try { delete window.tomatoAudio; } catch (e) {}
        try { delete window.tomatoBreadcrumbObserver; } catch (e) {}
        try { delete globalThis.__dockTomato; } catch (e) {}

        try { delete globalThis.__TomatoTimerCleanup; } catch (e) {}
        try { delete globalThis.__TomatoTimerUninstallCleanup; } catch (e) {}
        try { delete globalThis.__TomatoTimerLoaded; } catch (e) {}
    };

    globalThis.__TomatoTimerCleanup = cleanupTomato;
    globalThis.__TomatoTimerUninstallCleanup = cleanupTomatoFilesOnUninstall;

    // 🔧 性能优化：保存 inject Observer 引用，用于后续清理
    const injectObserver = new MutationObserver(debouncedInject);
    const startInjectObserve = () => {
        const target = document.body || document.documentElement;
        if (!target) return false;
        injectObserver.observe(target, { childList: true, subtree: true });
        return true;
    };
    if (!startInjectObserve()) {
        document.addEventListener('DOMContentLoaded', () => {
            try { startInjectObserve(); } catch (e) {}
        }, { once: true });
    }
    mutationObservers.push(injectObserver);
    injectInitTimeout = setTimeout(inject, 1000);

    EventManager.addWindowBeforeUnload(async () => {
        // 页面关闭时保存状态到云端
        if (isRunning || isTimerPaused) {
            Logger.info('💾 页面即将刷新/跳转，保存计时器状态到云端...', {
                isRunning: isRunning,
                isTimerPaused: isTimerPaused
            });
            
            // 同步状态到云端
            if (isSyncEnabled() && typeof SyncManager !== 'undefined' && SyncManager) {
                try {
                    syncState.status = isRunning ? 'RUNNING' : 'PAUSED';
                    syncState.startTime = startTime;
                    syncState.mode = timerMode;
                    syncState.duration = currentDuration * 60;
                    syncState.taskBlockId = currentTaskBlockId;
                    syncState.taskBlockName = currentTaskBlockName;
                    syncState.databaseBlockId = currentDatabaseBlockId;
                    
                    if (timerMode === 'stopwatch' || timerMode === 'stopwatch-break') {
                        syncState.stopwatchStartTimeMs = stopwatchStartTimeMs;
                        syncState.startTime = stopwatchStartTimeMs;
                    }
                    
                    if (isTimerPaused) {
                        syncState.currentPauseStart = syncState.currentPauseStart || Date.now();
                    }
                    
                    await SyncManager.updateLocal(syncState, true);
                    Logger.info('💾 状态已同步到云端', { 
                        status: syncState.status,
                        timerMode: syncState.mode,
                        stopwatchStartTimeMs: syncState.stopwatchStartTimeMs
                    });
                } catch (e) {
                    Logger.warn('⚠️ 同步状态到云端失败:', e.message);
                }
            }
        } else {
            Logger.info('🍅 计时器未运行，直接清理');
        }
        cleanupTomato();
        Logger.info('🍅 番茄钟已清理完成');
    });

    Logger.info('🍅 思源笔记番茄钟 v1.0 已加载');
})();
