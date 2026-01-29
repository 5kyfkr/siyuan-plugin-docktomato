const { Plugin, Setting, openTab, openMobileFileById } = require("siyuan");

const PLUGIN_ID = "siyuan-plugin-docktomato";
const TOMATO_SCRIPT_PATH = `/data/plugins/${PLUGIN_ID}/tomato.js`;
const PLUGIN_STORAGE_DIR = "/data/storage/petal/siyuan-plugin-docktomato";
const LEGACY_STORAGE_DIR = "/data/storage";
const LEGACY_AUDIO_DIR = "/data/storage/tomato-audio/";
const PLUGIN_AUDIO_DIR = `${PLUGIN_STORAGE_DIR}/tomato-audio/`;
const REMINDER_DOCK_TYPE = "::tomato-reminder";
const MAIN_SETTINGS_PATH = `${PLUGIN_STORAGE_DIR}/tomato-main-settings.json`;

const DEFAULT_MAIN_SETTINGS = {
    remindersEnabled: true,
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

            const path = hit.path;
            const area = path.includes("left") ? "left" : path.includes("right") ? "right" : path.includes("bottom") ? "bottom" : null;
            if (!area) continue;

            const dataIdx = path.lastIndexOf("data");
            const groupIndex = dataIdx >= 0 ? path[dataIdx + 1] : null;
            const index = dataIdx >= 0 ? path[dataIdx + 2] : null;
            if (!Number.isFinite(groupIndex) || !Number.isFinite(index)) continue;

            let position = "RightBottom";
            if (area === "left") position = groupIndex === 0 ? "LeftTop" : "LeftBottom";
            if (area === "right") position = groupIndex === 0 ? "RightTop" : "RightBottom";
            if (area === "bottom") position = groupIndex === 0 ? "BottomLeft" : "BottomRight";

            return { position, index };
        }
    } catch (e) {}
    return null;
};

const inferDockPlacementFromUiLayout = (type) => {
    try {
        const uiLayout = globalThis?.siyuan?.config?.uiLayout;
        if (!uiLayout) return inferDockPlacementFromLocalStorage(type);
        const hit = findDockTabPath(uiLayout, type);
        if (!hit) return inferDockPlacementFromLocalStorage(type);

        const path = hit.path;
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
    return inferDockPlacementFromLocalStorage(type);
};

const fetchText = async (url, data) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
};

const loadTomatoScript = async () => {
    try {
        const code = await fetchText("/api/file/getFile", { path: TOMATO_SCRIPT_PATH });
        if (!code || !code.trim()) throw new Error("empty script");
        (0, eval)(code);
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
        const merged = { ...DEFAULT_MAIN_SETTINGS, ...(parsed || {}) };
        if (merged.reminderDockEnabled === false) merged.remindersEnabled = false;
        return merged;
    } catch (e) {
        return { ...DEFAULT_MAIN_SETTINGS };
    }
};

const saveMainSettings = async (settings) => {
    try {
        await ensureDir(PLUGIN_STORAGE_DIR);
        const formData = new FormData();
        formData.append("path", MAIN_SETTINGS_PATH);
        formData.append("isDir", "false");
        formData.append("file", new Blob([JSON.stringify(settings || {}, null, 2)], { type: "application/json" }));
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
    async onload() {
        globalThis.__tomatoPluginApp = this.app;
        globalThis.__tomatoPluginInstance = this;
        globalThis.__tomatoPluginIsMobile = !!this.isMobile;
        globalThis.__tomatoOpenTab = typeof openTab === "function" ? openTab : null;
        globalThis.__tomatoOpenMobileFileById = typeof openMobileFileById === "function" ? openMobileFileById : null;
        globalThis.__dockTomatoMainSettings = await loadMainSettings();
        await loadTomatoScript();

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
    }

    onLayoutReady() {
        try {
            if (typeof this.addDock !== "function") return;
            const mainSettings = globalThis.__dockTomatoMainSettings || DEFAULT_MAIN_SETTINGS;
            if (!mainSettings.remindersEnabled) return;
            const existingPlacement = inferDockPlacementFromUiLayout(REMINDER_DOCK_TYPE);
            const dock = this.addDock({
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
                    const mount = globalThis.__dockTomatoReminderDock?.mount;
                    if (typeof mount === "function") {
                        mount(this.element);
                    }
                },
            });
        } catch (e) {
            console.error("[tomato] addDock failed", e);
        }
    }

    onunload() {
        try {
            if (typeof globalThis.__TomatoTimerCleanup === "function") {
                globalThis.__TomatoTimerCleanup();
            }
        } catch (e) {
            console.error("[tomato] cleanup failed", e);
        } finally {
            try { delete globalThis.__tomatoPluginApp; } catch (e) {}
            try { delete globalThis.__tomatoPluginInstance; } catch (e) {}
            try { delete globalThis.__tomatoPluginIsMobile; } catch (e) {}
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
