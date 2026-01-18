const { Plugin, Setting, openTab, openMobileFileById } = require("siyuan");

const PLUGIN_ID = "siyuan-plugin-docktomato";
const TOMATO_SCRIPT_PATH = `/data/plugins/${PLUGIN_ID}/tomato.js`;
const PLUGIN_STORAGE_DIR = "/data/storage/petal/siyuan-plugin-docktomato";
const LEGACY_STORAGE_DIR = "/data/storage";
const LEGACY_AUDIO_DIR = "/data/storage/tomato-audio/";
const PLUGIN_AUDIO_DIR = `${PLUGIN_STORAGE_DIR}/tomato-audio/`;

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
        globalThis.__tomatoPluginIsMobile = !!this.isMobile;
        globalThis.__tomatoOpenTab = typeof openTab === "function" ? openTab : null;
        globalThis.__tomatoOpenMobileFileById = typeof openMobileFileById === "function" ? openMobileFileById : null;
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

    onunload() {
        try {
            if (typeof globalThis.__TomatoTimerCleanup === "function") {
                globalThis.__TomatoTimerCleanup();
            }
        } catch (e) {
            console.error("[tomato] cleanup failed", e);
        } finally {
            try { delete globalThis.__tomatoPluginApp; } catch (e) {}
            try { delete globalThis.__tomatoPluginIsMobile; } catch (e) {}
            try { delete globalThis.__tomatoOpenTab; } catch (e) {}
            try { delete globalThis.__tomatoOpenMobileFileById; } catch (e) {}
        }
    }

    uninstall() {
        const keepHistoryOnly = async () => {
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
