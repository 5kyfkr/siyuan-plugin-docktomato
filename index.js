const { Plugin, Setting, openTab, openMobileFileById, platformUtils } = require("siyuan");
let tomatoStatsCore = null;

const PLUGIN_ID = "siyuan-plugin-docktomato";
const TOMATO_SCRIPT_PATH = `/data/plugins/${PLUGIN_ID}/tomato.js`;
const TOMATO_STATS_SCRIPT_PATH = `/data/plugins/${PLUGIN_ID}/kernel.js`;
const PLUGIN_STORAGE_DIR = "/data/storage/petal/siyuan-plugin-docktomato";
const TOMATO_HISTORY_INDEX_PATH = `${PLUGIN_STORAGE_DIR}/history/history-index.json`;
const LEGACY_STORAGE_DIR = "/data/storage";
const LEGACY_AUDIO_DIR = "/data/storage/tomato-audio/";
const PLUGIN_AUDIO_DIR = `${PLUGIN_STORAGE_DIR}/tomato-audio/`;
const REMINDER_DOCK_TYPE = "::tomato-reminder";
const MAIN_SETTINGS_PATH = `${PLUGIN_STORAGE_DIR}/tomato-main-settings.json`;
const MOBILE_RUNTIME_CONTAINERS = new Set(["android", "ios", "harmony"]);
const TOMATO_STATS_STARTUP_TIMEOUT_MS = 3000;
const HISTORY_WRITE_LEASE_MS = 15000;
const HISTORY_WRITE_WAIT_MS = 30000;
const HISTORY_WRITE_RPC_TIMEOUT_MS = 5000;
let tomatoStatsStartupGeneration = 0;

const DEFAULT_MAIN_SETTINGS = {
    remindersEnabled: true,
};

const sanitizeMainSettings = (raw) => {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const payload = source.data && typeof source.data === "object" && !Array.isArray(source.data)
        ? source.data
        : source;
    const next = { ...DEFAULT_MAIN_SETTINGS };
    if (typeof payload.remindersEnabled === "boolean") next.remindersEnabled = payload.remindersEnabled;
    if (payload.reminderDockEnabled === false) next.remindersEnabled = false;
    return next;
};

const getSiyuanRuntimeBackend = () => {
    try {
        const container = globalThis?.siyuan?.config?.system?.container;
        if (typeof container === "string" && container.trim()) return container.trim().toLowerCase();
    } catch (e) {}
    try {
        const container = window?.siyuan?.config?.system?.container;
        if (typeof container === "string" && container.trim()) return container.trim().toLowerCase();
    } catch (e) {}
    try {
        const os = globalThis?.siyuan?.config?.system?.os;
        if (typeof os === "string" && os.trim()) return os.trim().toLowerCase();
    } catch (e) {}
    try {
        const os = window?.siyuan?.config?.system?.os;
        if (typeof os === "string" && os.trim()) return os.trim().toLowerCase();
    } catch (e) {}
    return "";
};

const isSiyuanConfigMobile = () => {
    try {
        if (globalThis?.siyuan?.config?.isMobile === true) return true;
    } catch (e) {}
    try {
        if (window?.siyuan?.config?.isMobile === true) return true;
    } catch (e) {}
    return false;
};

const hasOfficialMobileRuntimeSignal = () => {
    try {
        if (isSiyuanConfigMobile()) return true;
    } catch (e) {}
    try {
        const backend = getSiyuanRuntimeBackend();
        if (MOBILE_RUNTIME_CONTAINERS.has(backend)) return true;
    } catch (e) {}
    try {
        if (globalThis?.JSAndroid) return true;
    } catch (e) {}
    try {
        if (globalThis?.JSHarmony) return true;
    } catch (e) {}
    try {
        const hasIosBridge = !!globalThis?.webkit?.messageHandlers;
        if (!hasIosBridge) return false;
        const ua = String(navigator?.userAgent || "");
        const maxTouchPoints = Number(navigator?.maxTouchPoints) || 0;
        if (/iPhone|iPad|iPod/i.test(ua)) return true;
        if (maxTouchPoints > 0) return true;
        return true;
    } catch (e) {}
    return false;
};

const isMobileBrowserViewport = () => {
    try {
        if (navigator?.userAgentData?.mobile === true) return true;
    } catch (e) {}
    try {
        const ua = String(navigator?.userAgent || "");
        if (/Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua)) return true;
    } catch (e) {}
    return false;
};

const isNativeMobileRuntimeClient = () => hasOfficialMobileRuntimeSignal();

const isRuntimeMobileClient = () => {
    if (hasOfficialMobileRuntimeSignal()) return true;
    return isMobileBrowserViewport();
};

const getReminderDockMeta = () => {
    try {
        if (!globalThis.__dockTomatoReminderDockMeta || typeof globalThis.__dockTomatoReminderDockMeta !== "object") {
            globalThis.__dockTomatoReminderDockMeta = {};
        }
    } catch (e) {
        globalThis.__dockTomatoReminderDockMeta = {};
    }
    return globalThis.__dockTomatoReminderDockMeta;
};

const findDockTabPath = (node, type, path = []) => {
    if (!node) return null;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const found = findDockTabPath(node[i], type, path.concat(i));
            if (found) return found;
        }
        return null;
    }
    if (typeof node === "object") {
        try {
            if (node.type === type) return { path, tab: node };
        } catch (e) {}
        for (const key of Object.keys(node)) {
            const found = findDockTabPath(node[key], type, path.concat(key));
            if (found) return found;
        }
    }
    return null;
};

const getDockPlacementFromHit = (hit) => {
    try {
        const path = hit?.path;
        if (!Array.isArray(path)) return null;
        const area = path.includes("left") ? "left" : path.includes("right") ? "right" : path.includes("bottom") ? "bottom" : null;
        if (!area) return null;

        const dataIdx = path.lastIndexOf("data");
        const groupIndex = dataIdx >= 0 ? path[dataIdx + 1] : null;
        const index = dataIdx >= 0 ? path[dataIdx + 2] : null;
        if (!Number.isFinite(groupIndex) || !Number.isFinite(index)) return null;

        let position = "RightBottom";
        if (area === "left") position = groupIndex === 0 ? "LeftTop" : "LeftBottom";
        if (area === "right") position = groupIndex === 0 ? "RightTop" : "RightBottom";
        if (area === "bottom") position = groupIndex === 0 ? "BottomLeft" : "BottomRight";

        return { position, index };
    } catch (e) {}
    return null;
};

const inferDockPlacementFromLocalStorage = (type) => {
    try {
        if (!globalThis?.localStorage?.length) return null;
        const maxKeys = Math.min(200, globalThis.localStorage.length);
        for (let i = 0; i < maxKeys; i++) {
            const k = globalThis.localStorage.key(i);
            if (!k) continue;
            const raw = globalThis.localStorage.getItem(k);
            if (!raw || raw.indexOf(type) === -1) continue;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                continue;
            }
            const candidate = parsed?.uiLayout || parsed;
            const hit = findDockTabPath(candidate, type);
            if (!hit) continue;
            const placement = getDockPlacementFromHit(hit);
            if (placement) return placement;
        }
    } catch (e) {}
    return null;
};

const getDockPlacementFromCurrentUiLayout = (type) => {
    try {
        const uiLayout = globalThis?.siyuan?.config?.uiLayout;
        if (!uiLayout) return null;
        const hit = findDockTabPath(uiLayout, type);
        if (!hit) return null;
        return getDockPlacementFromHit(hit);
    } catch (e) {}
    return null;
};

const hasDockInCurrentUiLayout = (type) => {
    try {
        const uiLayout = globalThis?.siyuan?.config?.uiLayout;
        if (!uiLayout) return false;
        return !!findDockTabPath(uiLayout, type);
    } catch (e) {}
    return false;
};

const inferDockPlacementFromUiLayout = (type) => {
    const current = getDockPlacementFromCurrentUiLayout(type);
    if (current) return current;
    if (globalThis?.siyuan?.config?.uiLayout) return null;
    return inferDockPlacementFromLocalStorage(type);
};

const resetReminderDockReloadVisibility = (plugin = null) => {
    const pluginName = String(plugin?.name || PLUGIN_ID).trim() || PLUGIN_ID;
    const fullType = `${pluginName}${REMINDER_DOCK_TYPE}`;
    try {
        const pluginDocks = globalThis.siyuan?.storage?.["local-plugin-docks"];
        const savedDock = pluginDocks?.[pluginName]?.[fullType];
        if (!savedDock || savedDock.show === false) return;
        savedDock.show = false;
        platformUtils?.setStorageVal?.("local-plugin-docks", pluginDocks);
    } catch (e) {}
};

const fetchText = async (url, data, options = {}) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
        ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
};

const installTomatoHistoryWriter = (plugin) => {
    let currentRun = null;
    let disposed = false;
    const writerError = (message, code) => {
        const error = new Error(message);
        error.code = code;
        return error;
    };
    const wait = (delayMs, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(writerError("番茄历史写入已停止", "HISTORY_WRITER_DISPOSED"));
            return;
        }
        let timer = null;
        const onAbort = () => {
            if (timer !== null) clearTimeout(timer);
            reject(writerError("番茄历史写入已停止", "HISTORY_WRITER_DISPOSED"));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener?.("abort", onAbort);
            resolve();
        }, delayMs);
        signal?.addEventListener?.("abort", onAbort, { once: true });
    });
    const callLease = async (action, payload = {}) => {
        const fn = plugin?.kernel?.rpc?.call?.dockTomatoHistoryWriteLease;
        if (typeof fn !== "function") {
            const error = new Error("番茄历史写入内核不可用");
            error.code = "HISTORY_WRITER_UNAVAILABLE";
            throw error;
        }
        let timer = null;
        let result;
        try {
            result = await Promise.race([
                Promise.resolve().then(() => fn({ action, ...payload })),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        const error = new Error("番茄历史写入协调超时");
                        error.code = "HISTORY_WRITER_TIMEOUT";
                        reject(error);
                    }, HISTORY_WRITE_RPC_TIMEOUT_MS);
                }),
            ]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
        if (!result || result.ok !== true) {
            const error = new Error(String(result?.error?.message || "番茄历史写入协调失败"));
            error.code = String(result?.error?.code || "HISTORY_WRITER_UNAVAILABLE");
            throw error;
        }
        return result.data || {};
    };
    const acquire = async (signal) => {
        const deadlineAt = Date.now() + HISTORY_WRITE_WAIT_MS;
        while (!disposed && !signal?.aborted && Date.now() < deadlineAt) {
            const result = await callLease("acquire", { leaseMs: HISTORY_WRITE_LEASE_MS });
            if (result.acquired === true && result.token) {
                if (disposed || signal?.aborted) {
                    void callLease("release", { token: result.token }).catch(() => {});
                    throw writerError("番茄历史写入已停止", "HISTORY_WRITER_DISPOSED");
                }
                return result;
            }
            await wait(Math.max(20, Math.min(500, Number(result.retryAfterMs) || 80)), signal);
        }
        throw writerError(
            disposed || signal?.aborted ? "番茄历史写入已停止" : "等待番茄历史写入权限超时",
            disposed || signal?.aborted ? "HISTORY_WRITER_DISPOSED" : "HISTORY_WRITER_BUSY",
        );
    };
    const renew = async (state) => {
        if (state?.error) throw state.error;
        if (!state?.lease?.token || disposed || state.controller.signal.aborted || currentRun !== state) {
            throw writerError("番茄历史写入权限已失效", "HISTORY_WRITE_LEASE_LOST");
        }
        const result = await callLease("renew", {
            token: state.lease.token,
            leaseMs: HISTORY_WRITE_LEASE_MS,
        });
        if (result.acquired !== true || result.token !== state.lease.token) {
            throw writerError("番茄历史写入权限已失效", "HISTORY_WRITE_LEASE_LOST");
        }
        state.lease = result;
        return true;
    };
    const bridge = {
        async run(operation) {
            if (typeof operation !== "function") throw new TypeError("history write operation must be a function");
            if (disposed) throw writerError("番茄历史写入已停止", "HISTORY_WRITER_DISPOSED");
            if (currentRun) throw writerError("番茄历史写入已在进行", "HISTORY_WRITER_BUSY");
            const state = {
                controller: new AbortController(),
                lease: null,
                heartbeat: null,
                error: null,
            };
            currentRun = state;
            let heartbeat = null;
            try {
                state.lease = await acquire(state.controller.signal);
                heartbeat = setInterval(() => {
                    void renew(state).catch((error) => {
                        state.error = error;
                        try { state.controller.abort(); } catch (e) {}
                    });
                }, Math.max(1000, Math.floor(HISTORY_WRITE_LEASE_MS / 3)));
                state.heartbeat = heartbeat;
                return await operation(state.controller.signal);
            } finally {
                if (heartbeat !== null) clearInterval(heartbeat);
                const token = state.lease?.token;
                if (currentRun === state) currentRun = null;
                if (token) {
                    try { await callLease("release", { token }); } catch (e) {}
                }
            }
        },
        assert() {
            return renew(currentRun);
        },
        dispose() {
            disposed = true;
            const state = currentRun;
            if (!state) return false;
            try { state.controller.abort(); } catch (e) {}
            if (state.heartbeat !== null) clearInterval(state.heartbeat);
            const token = state.lease?.token;
            if (token) void callLease("release", { token }).catch(() => {});
            return !!token;
        },
    };
    globalThis.__dockTomatoHistoryWriter = bridge;
    return bridge;
};

const loadTomatoStatsCore = async (options = {}) => {
    const existing = globalThis.__dockTomatoStatsCore;
    if (existing && typeof existing.queryFocus === "function") {
        tomatoStatsCore = existing;
        return true;
    }
    try {
        const code = await fetchText("/api/file/getFile", { path: TOMATO_STATS_SCRIPT_PATH }, options);
        if (!code || !code.trim()) throw new Error("empty statistics core");
        const script = document.createElement("script");
        script.textContent = code + "\n//# sourceURL=docktomato-kernel-core.js";
        document.head.appendChild(script);
        script.remove();
        const core = globalThis.__dockTomatoStatsCore;
        if (typeof options?.isCurrent === "function" && !options.isCurrent()) {
            try { delete globalThis.__dockTomatoStatsCore; } catch (e) {}
            tomatoStatsCore = null;
            return false;
        }
        if (!core || typeof core.queryFocus !== "function" || typeof core.queryRoutine !== "function") {
            throw new Error("statistics core did not initialize");
        }
        tomatoStatsCore = core;
        return true;
    } catch (e) {
        tomatoStatsCore = null;
        console.error("[tomato] load statistics core failed", e);
        return false;
    }
};

const loadTomatoScript = async () => {
    try {
        const code = await fetchText("/api/file/getFile", { path: TOMATO_SCRIPT_PATH });
        if (!code || !code.trim()) throw new Error("empty script");
        
        // Use script tag injection instead of eval for better debugging and potential performance
        const script = document.createElement("script");
        script.textContent = code + "\n//# sourceURL=tomato.js";
        document.head.appendChild(script);
        script.remove(); // Remove tag after execution to keep DOM clean
        
        return true;
    } catch (e) {
        console.error("[tomato] load script failed", e);
        return false;
    }
};

const ensureDir = async (path) => {
    try {
        const formData = new FormData();
        formData.append("path", path);
        formData.append("isDir", "true");
        const res = await fetch("/api/file/putFile", { method: "POST", body: formData });
        const result = await res.json().catch(() => null);
        if (result?.code === 0) return true;
        if (result?.data?.code === 0) return true;
    } catch (e) {}
    return false;
};

const loadMainSettings = async () => {
    try {
        const text = await fetchText("/api/file/getFile", { path: MAIN_SETTINGS_PATH });
        if (!text || !text.trim()) return { ...DEFAULT_MAIN_SETTINGS };
        const parsed = JSON.parse(text);
        return sanitizeMainSettings(parsed);
    } catch (e) {
        return { ...DEFAULT_MAIN_SETTINGS };
    }
};

const installTomatoStatsFacade = async (plugin, options = {}) => {
    const fallbackMetaKey = "siyuan-tomato-history-fallback-meta";
    const fallbackHistoryKey = "siyuan-tomato-history";
    const kernelSessionAuthError = "Auth failed [session]";
    const kernelRecoveryStorageKey = "dock_tomato_kernel_auth_recovery_at";
    const kernelRecoveryCooldownMs = 30000;
    const kernelRecoveryPeerWaitMs = 1000;
    const retryableKernelReads = new Set([
        "dockTomatoGetStatsCapabilities",
        "dockTomatoQueryFocus",
        "dockTomatoQueryRoutine",
        "dockTomatoListSessions",
    ]);
    let kernelHistoryHydrationPromise = null;
    let kernelHistoryHydrationRevision = 0;
    let markerHydratedRevision = 0;
    let markerHydrationFailure = { revision: 0, at: 0 };
    let kernelSessionRecoveryPromise = null;
    let statsQuerySequence = 0;
    const assertStatsQueryActive = (control = {}) => {
        if (!control?.signal?.aborted) return;
        const error = new Error("统计查询已取消");
        error.code = "STATS_QUERY_ABORTED";
        throw error;
    };
    const readKernelRecoveryTime = () => {
        try {
            const value = Number(globalThis.localStorage?.getItem?.(kernelRecoveryStorageKey));
            return Number.isFinite(value) && value > 0 ? value : 0;
        } catch (e) {
            return 0;
        }
    };
    const restartKernelSession = async () => {
        const appID = String(plugin?.app?.appId || "").trim();
        if (!appID) throw new Error("缺少当前窗口标识，无法安全重启番茄统计内核");
        const now = Date.now();
        const recentRecovery = readKernelRecoveryTime();
        if (recentRecovery && now >= recentRecovery && now - recentRecovery < kernelRecoveryCooldownMs) {
            await new Promise((resolve) => setTimeout(resolve, kernelRecoveryPeerWaitMs));
            return false;
        }
        const recoveryStartedAt = Date.now();
        try { globalThis.localStorage?.setItem?.(kernelRecoveryStorageKey, String(recoveryStartedAt)); } catch (e) {}
        try {
            const response = await fetch("/api/petal/setPetalEnabled", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ packageName: PLUGIN_ID, enabled: true, app: appID }),
            });
            let payload = null;
            try { payload = await response.json(); } catch (e) {}
            if (!response.ok || !payload || Number(payload.code) !== 0) {
                throw new Error(String(payload?.msg || payload?.message || `番茄统计内核重启失败 (${response.status})`));
            }
            return true;
        } catch (error) {
            try {
                if (readKernelRecoveryTime() === recoveryStartedAt) {
                    globalThis.localStorage?.removeItem?.(kernelRecoveryStorageKey);
                }
            } catch (e) {}
            throw error;
        }
    };
    const recoverKernelSession = () => {
        if (!kernelSessionRecoveryPromise) {
            kernelSessionRecoveryPromise = restartKernelSession().finally(() => {
                kernelSessionRecoveryPromise = null;
            });
        }
        return kernelSessionRecoveryPromise;
    };
    const isKernelSessionAuthError = (error) => String(error?.message || error || "").trim() === kernelSessionAuthError;
    const callKernel = async (method, payload) => {
        const invoke = async () => {
            const fn = plugin?.kernel?.rpc?.call?.[method];
            if (typeof fn !== "function") return null;
            const result = await fn(payload || {});
            if (!result || result.ok !== true) {
                const error = new Error(String(result?.error?.message || "番茄统计内核调用失败"));
                error.code = String(result?.error?.code || "STATS_ERROR");
                error.details = result?.error?.details || null;
                throw error;
            }
            return result.data;
        };
        try {
            return await invoke();
        } catch (cause) {
            let failure = cause;
            if (isKernelSessionAuthError(failure)) {
                try {
                    await recoverKernelSession();
                    if (retryableKernelReads.has(method)) {
                        const recovered = await invoke();
                        return recovered;
                    }
                    failure = new Error("番茄统计内核会话已恢复，请重试刚才的操作");
                } catch (recoveryError) {
                    failure = recoveryError;
                }
            }
            if (/^(?:STATS_|INVALID_RANGE|HISTORY_)/.test(String(failure?.code || ""))) throw failure;
            const error = new Error(String(failure?.message || "番茄统计内核不可用"));
            error.code = "HISTORY_SOURCE_UNAVAILABLE";
            error.details = { method };
            throw error;
        }
    };
    const readFallbackMarker = () => {
        const metaRaw = localStorage.getItem(fallbackMetaKey);
        if (!metaRaw) return null;
        let meta;
        try {
            meta = JSON.parse(metaRaw);
        } catch (cause) {
            const error = new Error("番茄历史回退标记损坏");
            error.code = "HISTORY_SOURCE_UNAVAILABLE";
            error.details = { stage: "fallback-marker" };
            throw error;
        }
        return {
            revision: Math.max(0, Number(meta?.updatedAt) || 0),
            recordCount: Math.max(0, Number(meta?.recordCount) || 0),
        };
    };
    const readPersistedHistoryRevision = async (control = {}) => {
        try {
            const raw = await fetchText("/api/file/getFile", { path: TOMATO_HISTORY_INDEX_PATH }, control);
            const index = JSON.parse(String(raw || "{}"));
            return Math.max(0, Number(index?.revision) || 0, Date.parse(index?.updatedAt || "") || 0);
        } catch (e) {
            if (control?.signal?.aborted) throw e;
            return 0;
        }
    };
    const reconcileFallbackMarker = async (control = {}) => {
        const fallback = readFallbackMarker();
        if (!fallback) return null;
        const persistedRevision = await readPersistedHistoryRevision(control);
        if (persistedRevision >= fallback.revision) {
            localStorage.removeItem(fallbackMetaKey);
            localStorage.removeItem(fallbackHistoryKey);
            return null;
        }
        return fallback;
    };
    const loadLocalRecords = async (options, control = {}) => {
        assertStatsQueryActive(control);
        const loader = globalThis.__dockTomato?.history?.loadRange;
        if (typeof loader !== "function") throw new Error("番茄历史接口尚未就绪");
        const records = await loader(options?.from, options?.to);
        assertStatsQueryActive(control);
        return Array.isArray(records) ? records : [];
    };
    const hydrateKernelHistory = (revisionOverride = 0) => {
        const requestedRevision = Math.max(0, Number(revisionOverride) || 0);
        if (requestedRevision && markerHydratedRevision >= requestedRevision) return Promise.resolve(true);
        if (requestedRevision && markerHydrationFailure.revision === requestedRevision
            && Date.now() - markerHydrationFailure.at < 5000) return Promise.resolve(false);
        if (kernelHistoryHydrationPromise) {
            if (!requestedRevision || requestedRevision === kernelHistoryHydrationRevision) {
                return kernelHistoryHydrationPromise;
            }
            return kernelHistoryHydrationPromise.then(() => hydrateKernelHistory(requestedRevision));
        }
        kernelHistoryHydrationRevision = requestedRevision;
        kernelHistoryHydrationPromise = Promise.resolve().then(async () => {
            const loader = globalThis.__dockTomato?.history?.loadAll;
            if (typeof loader !== "function") {
                if (requestedRevision) markerHydrationFailure = { revision: requestedRevision, at: Date.now() };
                return false;
            }
            const records = await loader();
            if (!Array.isArray(records)) {
                if (requestedRevision) markerHydrationFailure = { revision: requestedRevision, at: Date.now() };
                return false;
            }
            const revision = requestedRevision
                || await readPersistedHistoryRevision()
                || Date.now();
            const hydrated = await callKernel("dockTomatoSetHistoryFallback", {
                active: true,
                revision,
                records,
            });
            if (!hydrated) {
                if (requestedRevision) markerHydrationFailure = { revision: requestedRevision, at: Date.now() };
                return false;
            }
            if (requestedRevision) {
                markerHydratedRevision = requestedRevision;
                markerHydrationFailure = { revision: 0, at: 0 };
            }
            return true;
        }).catch(() => {
            if (requestedRevision) markerHydrationFailure = { revision: requestedRevision, at: Date.now() };
            return false;
        }).finally(() => {
            kernelHistoryHydrationPromise = null;
            kernelHistoryHydrationRevision = 0;
        });
        return kernelHistoryHydrationPromise;
    };
    const isRecoverableHistorySourceError = (error) => {
        const code = String(error?.code || "");
        return code === "HISTORY_SOURCE_UNAVAILABLE" || code === "HISTORY_REVISION_CHANGED";
    };
    const runLocal = async (coreMethod, options, source, control = {}) => {
        const records = await loadLocalRecords(options, control);
        const result = tomatoStatsCore[coreMethod](records, options);
        assertStatsQueryActive(control);
        return { ...result, meta: { ...(result.meta || {}), source } };
    };
    const resolveFallbackQuerySource = async (control = {}) => {
        assertStatsQueryActive(control);
        const fallback = await reconcileFallbackMarker(control);
        if (fallback) {
            const hydrated = await hydrateKernelHistory(fallback.revision);
            assertStatsQueryActive(control);
            return hydrated
                ? { useLocal: false }
                : { useLocal: true, source: "fallback-local" };
        }
        markerHydrationFailure = { revision: 0, at: 0 };
        if (markerHydratedRevision > 0) {
            try {
                const cleared = await callKernel("dockTomatoSetHistoryFallback", { active: false, revision: Date.now() });
                assertStatsQueryActive(control);
                if (!cleared) return { useLocal: true, source: "frontend-local" };
                markerHydratedRevision = 0;
            } catch (e) {
                return { useLocal: true, source: "frontend-local" };
            }
        }
        return { useLocal: false };
    };
    const run = async (method, coreMethod, options = {}, control = {}) => {
        const signal = control?.signal || null;
        const queryID = `stats-${Date.now()}-${++statsQuerySequence}`;
        const queryOptions = { ...(options || {}), queryID };
        const cancelKernelQuery = async () => {
            const cancel = plugin?.kernel?.rpc?.call?.dockTomatoCancelStatsQuery;
            if (typeof cancel !== "function") return false;
            try { await cancel({ queryID }); return true; } catch (e) { return false; }
        };
        const abortHandler = () => { void cancelKernelQuery(); };
        signal?.addEventListener?.("abort", abortHandler, { once: true });
        try {
            assertStatsQueryActive(control);
            const fallbackSource = await resolveFallbackQuerySource(control);
            assertStatsQueryActive(control);
            if (fallbackSource.useLocal) {
                return runLocal(coreMethod, queryOptions, fallbackSource.source, control);
            }
            try {
                const value = await callKernel(method, queryOptions);
                assertStatsQueryActive(control);
                if (value) {
                    const kernelSource = String(value?.meta?.source || "");
                    const kernelRecordCount = Math.max(0, Number(value?.meta?.recordCount) || 0);
                    if (kernelSource === "legacy" && kernelRecordCount === 0) {
                        const records = await loadLocalRecords(queryOptions, control);
                        if (records.length) {
                            const local = tomatoStatsCore[coreMethod](records, queryOptions);
                            const recovered = {
                                ...local,
                                meta: { ...(local?.meta || {}), source: "frontend-local-after-empty-kernel", recordCount: records.length },
                            };
                            void hydrateKernelHistory();
                            return recovered;
                        }
                    }
                    return value;
                }
            } catch (kernelError) {
                if (!isRecoverableHistorySourceError(kernelError)) throw kernelError;
                if (await hydrateKernelHistory()) {
                    assertStatsQueryActive(control);
                    try {
                        const recovered = await callKernel(method, queryOptions);
                        if (recovered) {
                            assertStatsQueryActive(control);
                            return recovered;
                        }
                    } catch (hydratedKernelError) {
                        if (!isRecoverableHistorySourceError(hydratedKernelError)) throw hydratedKernelError;
                    }
                }
                try {
                    return await runLocal(coreMethod, queryOptions, "frontend-local", control);
                } catch (e) {
                    if (e?.code && !isRecoverableHistorySourceError(e)) throw e;
                    throw kernelError;
                }
            }
            return runLocal(coreMethod, queryOptions, "frontend-local", control);
        } finally {
            signal?.removeEventListener?.("abort", abortHandler);
        }
    };
    const facade = {
        contractVersion: tomatoStatsCore.CONTRACT_VERSION,
        core: tomatoStatsCore,
        getCapabilities: async () => {
            try { return await callKernel("dockTomatoGetStatsCapabilities", {}); }
            catch (e) { return tomatoStatsCore.getCapabilities(); }
        },
        queryFocus: (options, control) => run("dockTomatoQueryFocus", "queryFocus", options, control),
        queryRoutine: (options, control) => run("dockTomatoQueryRoutine", "queryRoutine", options, control),
        listSessions: (options, control) => run("dockTomatoListSessions", "listSessions", options, control),
        syncFallback: async (records, active, revision = Date.now()) => {
            try {
                const result = await callKernel("dockTomatoSetHistoryFallback", {
                    active: active === true,
                    revision,
                    records: active === true && Array.isArray(records) ? records : undefined,
                });
                if (result) {
                    markerHydratedRevision = result.active === true
                        ? Math.max(0, Number(result.revision) || Number(revision) || 0)
                        : 0;
                    markerHydrationFailure = { revision: 0, at: 0 };
                }
                return result;
            } catch (e) {
                return null;
            }
        },
        hydrateFallback: async () => {
            const resolved = await resolveFallbackQuerySource();
            return resolved.useLocal !== true;
        },
    };
    const fallback = await reconcileFallbackMarker(options);
    if (typeof options?.isCurrent === "function" && !options.isCurrent()) return null;
    globalThis.__dockTomatoStatsFacade = facade;
    if (globalThis.__dockTomato && typeof globalThis.__dockTomato === "object") globalThis.__dockTomato.stats = facade;
    if (!fallback) void facade.syncFallback([], false, Date.now()).catch(() => {});
    return facade;
};

const dispatchTomatoStatsAvailability = (available) => {
    try {
        window.dispatchEvent(new CustomEvent("tomato:stats-availability-changed", {
            detail: { available: available === true },
        }));
    } catch (e) {}
};

const initializeTomatoStats = async (plugin) => {
    const generation = ++tomatoStatsStartupGeneration;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const isCurrent = () => generation === tomatoStatsStartupGeneration && plugin?._isUnloaded !== true;
    let timer = null;
    try {
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                try { controller?.abort?.(); } catch (e) {}
                const error = new Error("番茄统计初始化超时");
                error.code = "STATS_STARTUP_TIMEOUT";
                reject(error);
            }, TOMATO_STATS_STARTUP_TIMEOUT_MS);
        });
        const facade = await Promise.race([
            Promise.resolve().then(async () => {
                const options = { signal: controller?.signal, isCurrent };
                if (!await loadTomatoStatsCore(options)) return null;
                return installTomatoStatsFacade(plugin, options);
            }),
            timeout,
        ]);
        if (!facade || !isCurrent()) return null;
        if (globalThis.__dockTomato && typeof globalThis.__dockTomato === "object") {
            globalThis.__dockTomato.stats = facade;
        }
        dispatchTomatoStatsAvailability(true);
        void Promise.resolve(facade.hydrateFallback?.()).catch(() => {});
        return facade;
    } catch (e) {
        if (generation === tomatoStatsStartupGeneration) tomatoStatsStartupGeneration += 1;
        const facade = globalThis.__dockTomatoStatsFacade;
        if (globalThis.__dockTomato?.stats === facade) globalThis.__dockTomato.stats = null;
        try { delete globalThis.__dockTomatoStatsFacade; } catch (error) {}
        try { delete globalThis.__dockTomatoStatsCore; } catch (error) {}
        tomatoStatsCore = null;
        dispatchTomatoStatsAvailability(false);
        return null;
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
};

const saveMainSettings = async (settings) => {
    try {
        await ensureDir(PLUGIN_STORAGE_DIR);
        const normalizedSettings = sanitizeMainSettings(settings);
        const formData = new FormData();
        formData.append("path", MAIN_SETTINGS_PATH);
        formData.append("isDir", "false");
        formData.append("file", new Blob([JSON.stringify(normalizedSettings, null, 2)], { type: "application/json" }));
        const res = await fetch("/api/file/putFile", { method: "POST", body: formData });
        const result = await res.json().catch(() => null);
        if (result?.code === 0) return true;
        if (result?.data?.code === 0) return true;
    } catch (e) {}
    return false;
};

const removeFile = async (path, isDir) => {
    try {
        let normalizedPath = path;
        if (isDir === true && typeof normalizedPath === "string" && normalizedPath && !normalizedPath.endsWith("/")) {
            normalizedPath = normalizedPath + "/";
        }

        const payload = { path: normalizedPath };
        if (isDir === true) payload.isDir = true;
        if (isDir === false) payload.isDir = false;
        const res = await fetch("/api/file/removeFile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await res.json().catch(() => null);
        if (result?.code === 0) return true;
        if (result?.data?.code === 0) return true;
    } catch (e) {}

    return false;
};

module.exports = class TomatoTimerPlugin extends Plugin {
    // 用于保存需要清理的资源引用
    _badgeUpdateInterval = null;
    _badgeUpdateListener = null;
    _dockBadgeRetryTimer = null;
    _dockBadgeRetryAt = 0;
    _isUnloaded = false;
    _reminderDockAdded = false;
    _reminderDockRecoverTimers = [];

    _scheduleReminderDockRecover(reason) {
        if (isRuntimeMobileClient()) return;
        [0, 180, 600].forEach((delay) => {
            const timer = setTimeout(() => {
                try { globalThis.__dockTomato?.recoverDock?.(`${reason}-${delay}`); } catch (e) {}
            }, delay);
            this._reminderDockRecoverTimers.push(timer);
        });
    }

    _clearReminderDockMeta() {
        const dockMeta = getReminderDockMeta();
        dockMeta.addRequested = false;
        dockMeta.registered = false;
        dockMeta.mountEl = null;
        dockMeta.mountParentEl = null;
        dockMeta.mountIndex = -1;
        dockMeta.mountTagName = "";
        dockMeta.mountClassName = "";
    }

    _resetReminderBadgeResources() {
        try {
            if (this._badgeUpdateInterval) {
                clearInterval(this._badgeUpdateInterval);
                this._badgeUpdateInterval = null;
            }
        } catch (e) {}
        try {
            if (this._badgeUpdateListener) {
                window.removeEventListener("tomato-reminder-badge-update", this._badgeUpdateListener);
                this._badgeUpdateListener = null;
            }
        } catch (e) {}
        try {
            if (this._dockBadgeRetryTimer) {
                clearTimeout(this._dockBadgeRetryTimer);
                this._dockBadgeRetryTimer = null;
            }
            this._dockBadgeRetryAt = 0;
        } catch (e) {}
    }

    _mountReminderDockElement(element) {
        if (!element) return false;
        try {
            const dockMeta = getReminderDockMeta();
            dockMeta.addRequested = true;
            dockMeta.registered = true;
            dockMeta.mountEl = element;
        } catch (e) {}
        const mount = globalThis.__dockTomatoReminderDock?.mount;
        if (typeof mount !== "function") return false;
        try {
            mount(element);
            return true;
        } catch (e) {}
        return false;
    }

    _registerReminderDock(reason = "manual", options = {}) {
        try {
            const force = !!options.force;
            if (typeof this.addDock !== "function") return false;
            const mainSettings = globalThis.__dockTomatoMainSettings || DEFAULT_MAIN_SETTINGS;
            if (!mainSettings.remindersEnabled) return false;
            if (this._reminderDockAdded && !force) {
                this._scheduleReminderDockRecover(`${reason}-existing`);
                return true;
            }
            if (force) {
                this._reminderDockAdded = false;
                this._clearReminderDockMeta();
            }

            const existingPlacement = getDockPlacementFromCurrentUiLayout(REMINDER_DOCK_TYPE);
            const plugin = this;
            let badgeElement = globalThis.__tomatoReminderBadgeElement || null;

            const scheduleDockBadgeRetry = (delay = 5000) => {
                if (plugin._isUnloaded) return;
                const retryDelay = Math.max(0, Number(delay) || 0);
                const retryAt = Date.now() + retryDelay;
                if (plugin._dockBadgeRetryTimer && plugin._dockBadgeRetryAt <= retryAt) return;
                if (plugin._dockBadgeRetryTimer) clearTimeout(plugin._dockBadgeRetryTimer);
                plugin._dockBadgeRetryAt = retryAt;
                plugin._dockBadgeRetryTimer = setTimeout(() => {
                    plugin._dockBadgeRetryTimer = null;
                    plugin._dockBadgeRetryAt = 0;
                    findAndCreateDockBadge();
                }, retryDelay);
            };

            const findAndCreateDockBadge = async () => {
                if (plugin._isUnloaded) return;
                try {
                    const badgeData = globalThis.__tomatoReminderBadge;
                    const count = badgeData?.total || 0;
                    let container = null;

                    const typeIcons = document.querySelectorAll('[data-type="::tomato-reminder"]');
                    for (const icon of typeIcons) {
                        const found = icon.closest(".dock__item") || icon.closest(".dock__panel") || icon;
                        if (found) {
                            container = found;
                            break;
                        }
                    }

                    if (!container) {
                        const svgIcons = document.querySelectorAll("svg.iconClock");
                        for (const svg of svgIcons) {
                            const found = svg.closest(".dock__item") || svg.closest(".dock__panel") || svg;
                            if (found) {
                                container = found;
                                break;
                            }
                        }
                    }

                    if (!container) {
                        const dockItems = document.querySelectorAll(".dock__item, .dock__panel");
                        for (const item of dockItems) {
                            const title = item.title || item.getAttribute("aria-label") || "";
                            if (title.includes("提醒") || title.includes("Clock")) {
                                container = item;
                                break;
                            }
                        }
                    }

                    if (!container) {
                        scheduleDockBadgeRetry();
                        return;
                    }

                    if (plugin._dockBadgeRetryTimer) {
                        clearTimeout(plugin._dockBadgeRetryTimer);
                        plugin._dockBadgeRetryTimer = null;
                        plugin._dockBadgeRetryAt = 0;
                    }

                    const existingBadge = container.querySelector(".tomato-reminder-badge");
                    if (existingBadge) {
                        badgeElement = existingBadge;
                    } else {
                        badgeElement = document.createElement("div");
                        badgeElement.className = "tomato-reminder-badge";
                        container.style.position = "relative";
                        badgeElement.style.cssText = `
                            position: absolute;
                            top: -4px;
                            right: -4px;
                            min-width: 18px;
                            height: 18px;
                            line-height: 18px;
                            text-align: center;
                            font-size: 10px;
                            font-weight: bold;
                            color: white;
                            background: #f44336;
                            border-radius: 9px;
                            padding: 0 4px;
                            box-sizing: border-box;
                            z-index: 1000;
                            display: ${count > 0 ? "flex" : "none"};
                            align-items: center;
                            justify-content: center;
                        `;
                        badgeElement.textContent = count > 99 ? "99+" : (count > 0 ? count : "");
                        container.appendChild(badgeElement);
                    }

                    globalThis.__tomatoReminderBadgeElement = badgeElement;
                } catch (e) {
                    scheduleDockBadgeRetry();
                }
            };

            const updateBadgeCount = async () => {
                try {
                    const badgeData = globalThis.__tomatoReminderBadge;
                    const count = badgeData?.total || 0;
                    if (badgeElement) {
                        badgeElement.textContent = count > 99 ? "99+" : (count > 0 ? count : "");
                        badgeElement.style.display = count > 0 ? "flex" : "none";
                    }
                    globalThis.__tomatoReminderBadgeElement = badgeElement;
                } catch (e) {}
            };

            const refreshBadgeNow = async () => {
                try {
                    if (typeof globalThis.__tomatoUpdateReminderBadge === "function") {
                        await globalThis.__tomatoUpdateReminderBadge();
                    }
                } catch (e) {}
                await findAndCreateDockBadge();
                await updateBadgeCount();
            };

            this.addDock({
                type: REMINDER_DOCK_TYPE,
                config: {
                    position: existingPlacement?.position || "RightBottom",
                    size: { width: 320, height: 360 },
                    icon: "iconClock",
                    title: "任务提醒",
                    index: Number.isFinite(existingPlacement?.index) ? existingPlacement.index : undefined,
                },
                data: { plugin: this },
                init() {
                    plugin._mountReminderDockElement(this.element || null);
                    scheduleDockBadgeRetry(1000);
                },
                update() {
                    plugin._mountReminderDockElement(this.element || null);
                    scheduleDockBadgeRetry(120);
                },
                resize() {
                    plugin._mountReminderDockElement(this.element || null);
                    try { globalThis.__dockTomato?.refresh?.(); } catch (e) {}
                },
                destroy() {
                    try {
                        const dockMeta = getReminderDockMeta();
                        if (dockMeta.mountEl === (this.element || null)) {
                            dockMeta.mountEl = null;
                            dockMeta.registered = false;
                        }
                    } catch (e) {}
                },
            });

            this._reminderDockAdded = true;
            try {
                const dockMeta = getReminderDockMeta();
                dockMeta.addRequested = true;
            } catch (e) {}

            this._resetReminderBadgeResources();
            if (typeof Event === "function") {
                this._badgeUpdateListener = (e) => {
                    const count = e.detail?.total || 0;
                    if (badgeElement) {
                        badgeElement.textContent = count > 99 ? "99+" : (count > 0 ? count : "");
                        badgeElement.style.display = count > 0 ? "flex" : "none";
                    }
                };
                window.addEventListener("tomato-reminder-badge-update", this._badgeUpdateListener);
            }
            this._badgeUpdateInterval = setInterval(async () => {
                await refreshBadgeNow();
            }, 60000);

            // Dock 内容可能尚未打开，但角标容器已经存在。主动消费一次当前提醒状态，
            // 避免 tomato.js 在监听器注册前发出的启动事件丢失后必须打开侧栏才显示角标。
            Promise.resolve().then(refreshBadgeNow).catch(() => {});

            this._scheduleReminderDockRecover(reason);
            return true;
        } catch (e) {}
        return false;
    }

    async onload() {
        this._isUnloaded = false;
        const runtimeMobile = isRuntimeMobileClient();
        const runtimeNativeMobile = isNativeMobileRuntimeClient();
        globalThis.__tomatoPluginApp = this.app;
        globalThis.__tomatoPluginInstance = this;
        globalThis.__tomatoPlatformUtils = platformUtils || null;
        globalThis.__tomatoLegacyNotificationBridge = (!runtimeMobile && platformUtils && typeof platformUtils === "object") ? {
            sendNotification: (channel, title, body, delayInSeconds) => {
                if (typeof platformUtils.sendNotification !== "function") return -1;
                return platformUtils.sendNotification({
                    channel: String(channel || ""),
                    title: String(title || ""),
                    body: String(body || ""),
                    delayInSeconds: Math.max(0, Math.round(Number(delayInSeconds) || 0)),
                    timeoutType: "never",
                });
            },
            cancelNotification: (id) => {
                if (typeof platformUtils.cancelNotification !== "function") return false;
                return platformUtils.cancelNotification(id);
            },
        } : null;
        globalThis.__tomatoPluginIsMobile = runtimeMobile;
        globalThis.__tomatoPluginIsNativeMobile = runtimeNativeMobile;
        globalThis.__tomatoOpenTab = typeof openTab === "function" ? openTab : null;
        globalThis.__tomatoOpenMobileFileById = typeof openMobileFileById === "function" ? openMobileFileById : null;
        globalThis.__dockTomatoRegisterReminderDock = (reason = "external", force = false) => {
            try { return this._registerReminderDock(reason, { force: !!force }); } catch (e) { return false; }
        };
        this._historyWriter = installTomatoHistoryWriter(this);
        globalThis.__dockTomatoMainSettings = await loadMainSettings();
        await loadTomatoScript();
        dispatchTomatoStatsAvailability(false);
        void initializeTomatoStats(this);

        this.setting = new Setting({});

        const mkButton = (label, onClick) => {
            const btn = document.createElement("button");
            btn.className = "b3-button b3-button--outline fn__block";
            btn.textContent = label;
            btn.onclick = () => {
                try { onClick?.(); } catch (e) { console.error("[tomato] open setting failed", e); }
            };
            return btn;
        };

        this.setting.addItem({
            title: "番茄钟设置",
            description: "同步/音频/外观/任务块",
            createActionElement: () => mkButton("打开设置", () => globalThis.__dockTomato?.openSettings?.()),
        });

        const mkToggleRow = (label, checked, onChange) => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;";
            const lbl = document.createElement("div");
            lbl.textContent = label;
            lbl.style.cssText = "font-size:13px;line-height:1.4;";
            const sw = document.createElement("input");
            sw.type = "checkbox";
            sw.checked = !!checked;
            sw.style.cssText = "width:20px;height:20px;cursor:pointer;flex:0 0 auto;";
            sw.onchange = onChange;
            row.appendChild(lbl);
            row.appendChild(sw);
            return row;
        };

        this.setting.addItem({
            title: "任务提醒",
            description: "开关将在下次重载插件后生效",
            createActionElement: () => {
                const box = document.createElement("div");
                box.style.cssText = "display:flex;flex-direction:column;";
                const settings = globalThis.__dockTomatoMainSettings || { ...DEFAULT_MAIN_SETTINGS };
                box.appendChild(mkToggleRow("启用任务提醒（Dock）", settings.remindersEnabled, async (e) => {
                    settings.remindersEnabled = !!e.target.checked;
                    globalThis.__dockTomatoMainSettings = settings;
                    await saveMainSettings(settings);
                }));
                return box;
            },
        });

        this.setting.addItem({
            title: "专注时间范围",
            description: "配置工作日/周末等专注时间段",
            createActionElement: () => mkButton("打开时间范围设置", () => globalThis.__dockTomato?.openFocusSettings?.()),
        });

        this.setting.addItem({
            title: "时间轴设置",
            description: "时间轴样式与显示范围",
            createActionElement: () => mkButton("打开时间轴设置", () => globalThis.__dockTomato?.openTimelineSettings?.()),
        });

        this.setting.addItem({
            title: "历史统计",
            description: "查看历史记录与统计",
            createActionElement: () => mkButton("打开历史面板", () => globalThis.__dockTomato?.openHistory?.("summary")),
        });

        this._registerReminderDock("onload");
    }

    onLayoutReady() {
        resetReminderDockReloadVisibility(this);
        try {
            if (!this._reminderDockAdded) {
                this._registerReminderDock("layout-ready");
                return;
            }
            this._scheduleReminderDockRecover("layout-ready");
        } catch (e) {}
    }

    onunload() {
        this._isUnloaded = true;
        tomatoStatsStartupGeneration += 1;
        // 清理定时器和事件监听器
        try {
            if (this._badgeUpdateInterval) {
                clearInterval(this._badgeUpdateInterval);
                this._badgeUpdateInterval = null;
            }
        } catch (e) {}
        try {
            if (this._badgeUpdateListener) {
                window.removeEventListener("tomato-reminder-badge-update", this._badgeUpdateListener);
                this._badgeUpdateListener = null;
            }
        } catch (e) {}
        try {
            this._resetReminderBadgeResources();
        } catch (e) {}
        try {
            for (const timer of this._reminderDockRecoverTimers) {
                clearTimeout(timer);
            }
            this._reminderDockRecoverTimers.length = 0;
        } catch (e) {}
        try { delete globalThis.__dockTomatoRegisterReminderDock; } catch (e) {}
        try {
            this._historyWriter?.dispose?.();
            this._historyWriter = null;
            delete globalThis.__dockTomatoHistoryWriter;
        } catch (e) {}
        try {
            const facade = globalThis.__dockTomatoStatsFacade;
            if (globalThis.__dockTomato?.stats === facade) globalThis.__dockTomato.stats = null;
            delete globalThis.__dockTomatoStatsFacade;
            dispatchTomatoStatsAvailability(false);
        } catch (e) {}
        try { delete globalThis.__dockTomatoStatsCore; } catch (e) {}
        tomatoStatsCore = null;
        try {
            this._reminderDockAdded = false;
            this._clearReminderDockMeta();
        } catch (e) {}

        try {
            if (typeof globalThis.__TomatoTimerCleanup === "function") {
                globalThis.__TomatoTimerCleanup();
            }
        } catch (e) {
            console.error("[tomato] cleanup failed", e);
        } finally {
            try { delete globalThis.__tomatoPluginApp; } catch (e) {}
            try { delete globalThis.__tomatoPluginInstance; } catch (e) {}
            try { delete globalThis.__tomatoPlatformUtils; } catch (e) {}
            try { delete globalThis.__tomatoLegacyNotificationBridge; } catch (e) {}
            try { delete globalThis.__tomatoPluginIsMobile; } catch (e) {}
            try { delete globalThis.__tomatoPluginIsNativeMobile; } catch (e) {}
            try { delete globalThis.__tomatoOpenTab; } catch (e) {}
            try { delete globalThis.__tomatoOpenMobileFileById; } catch (e) {}
        }
    }

    uninstall() {
        const keepHistoryOnly = async () => {
            try {
                if (typeof globalThis.__TomatoTimerCleanup === "function") {
                    globalThis.__TomatoTimerCleanup();
                }
            } catch (e) {
                console.error("[tomato] cleanup before uninstall failed", e);
            }
            try {
                if (typeof globalThis.__TomatoTimerUninstallCleanup === "function") {
                    await globalThis.__TomatoTimerUninstallCleanup();
                }
            } catch (e) {
                console.error("[tomato] uninstall cleanup hook failed", e);
            }

            const deleteTargets = [
                `${LEGACY_STORAGE_DIR}/tomato-settings.json`,
                `${LEGACY_STORAGE_DIR}/tomato-focus-settings.json`,
                `${LEGACY_STORAGE_DIR}/tomato-sync.json`,
                `${PLUGIN_STORAGE_DIR}/tomato-settings.json`,
                `${PLUGIN_STORAGE_DIR}/tomato-focus-settings.json`,
                `${PLUGIN_STORAGE_DIR}/tomato-sync.json`,
            ];
            for (const p of deleteTargets) {
                await removeFile(p);
            }

            await removeFile(LEGACY_AUDIO_DIR, true);
            await removeFile(PLUGIN_AUDIO_DIR, true);
        };

        keepHistoryOnly().catch((e) => {
            console.error(`[tomato] uninstall cleanup failed`, e);
        });
    }
};
