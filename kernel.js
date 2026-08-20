(function (root, factory) {
    'use strict';

    const core = factory();
    if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = core;
    if (root && typeof document !== 'undefined') root.__dockTomatoStatsCore = core;

    const siyuan = root?.siyuan;
    if (siyuan?.plugin?.lifecycle && siyuan?.rpc) {
        installKernelRuntime(siyuan, core);
    }

    function installKernelRuntime(siyuanApi, statsCore) {
        const PLUGIN_ID = 'siyuan-plugin-docktomato';
        const STORAGE_DIR = `/data/storage/petal/${PLUGIN_ID}`;
        const HISTORY_DIR = `${STORAGE_DIR}/history`;
        const HISTORY_INDEX_PATH = `${HISTORY_DIR}/history-index.json`;
        const SETTINGS_PATH = `${STORAGE_DIR}/tomato-settings.json`;
        const HISTORY_IO_TIMEOUT_MS = 5000;
        const HISTORY_TEXT_LIMIT = 32 * 1024 * 1024;
        const HISTORY_WRITE_LEASE_MIN_MS = 5000;
        const HISTORY_WRITE_LEASE_MAX_MS = 60000;
        const LEGACY_HISTORY_PATHS = [
            `${STORAGE_DIR}/tomato-history.json`,
            '/data/storage/tomato-history.json',
        ];
        const RPC_NAMES = [
            'dockTomatoGetStatsCapabilities',
            'dockTomatoQueryFocus',
            'dockTomatoQueryRoutine',
            'dockTomatoListSessions',
            'dockTomatoCancelStatsQuery',
            'dockTomatoSetHistoryFallback',
            'dockTomatoHistoryWriteLease',
        ];
        const text = (value) => String(value == null ? '' : value).trim();
        let historyWriteLease = null;
        const activeStatsQueries = new Map();
        const cancelledStatsQueries = new Map();

        function createLeaseToken() {
            try {
                if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
            } catch (e) {}
            return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }

        function handleHistoryWriteLease(payload) {
            const source = payload && typeof payload === 'object' ? payload : {};
            const action = text(source.action);
            const now = Date.now();
            if (historyWriteLease && historyWriteLease.leaseUntil <= now) historyWriteLease = null;
            if (action === 'acquire') {
                if (historyWriteLease) {
                    return {
                        acquired: false,
                        leaseUntil: historyWriteLease.leaseUntil,
                        retryAfterMs: Math.max(20, Math.min(500, historyWriteLease.leaseUntil - now)),
                    };
                }
                const requestedMs = Math.max(0, Number(source.leaseMs) || 0);
                const leaseMs = Math.max(HISTORY_WRITE_LEASE_MIN_MS, Math.min(HISTORY_WRITE_LEASE_MAX_MS, requestedMs || 15000));
                historyWriteLease = { token: createLeaseToken(), leaseUntil: now + leaseMs };
                return { acquired: true, ...historyWriteLease };
            }
            const token = text(source.token);
            if (!historyWriteLease || !token || token !== historyWriteLease.token) {
                return { acquired: false, leaseUntil: historyWriteLease?.leaseUntil || 0 };
            }
            if (action === 'renew') {
                const requestedMs = Math.max(0, Number(source.leaseMs) || 0);
                const leaseMs = Math.max(HISTORY_WRITE_LEASE_MIN_MS, Math.min(HISTORY_WRITE_LEASE_MAX_MS, requestedMs || 15000));
                historyWriteLease.leaseUntil = now + leaseMs;
                return { acquired: true, ...historyWriteLease };
            }
            if (action === 'release') {
                historyWriteLease = null;
                return { acquired: false, released: true, leaseUntil: 0 };
            }
            return { acquired: true, ...historyWriteLease };
        }

        function historySourceError(message, details = {}) {
            const error = new Error(message);
            error.code = 'HISTORY_SOURCE_UNAVAILABLE';
            error.details = details;
            return error;
        }

        function historyTextLimitError(path) {
            const error = new Error(`历史数据文件过大: ${path}`);
            error.code = path === SETTINGS_PATH ? 'STATS_SETTINGS_TOO_LARGE' : 'HISTORY_TEXT_LIMIT_EXCEEDED';
            error.details = { path, maxTextBytes: HISTORY_TEXT_LIMIT };
            return error;
        }

        function statsQueryExpiredError(deadlineAt = 0) {
            const error = new Error('统计查询已超过执行期限');
            error.code = 'STATS_QUERY_EXPIRED';
            error.details = { deadlineAt: Math.max(0, Number(deadlineAt) || 0) };
            return error;
        }

        function statsQueryAbortedError(queryID = '') {
            const error = new Error('统计查询已取消');
            error.code = 'STATS_QUERY_ABORTED';
            error.details = { queryID: text(queryID) };
            return error;
        }

        async function withHistoryIoTimeout(path, operation, control = {}) {
            const deadlineAt = Math.max(0, Number(control?.deadlineAt) || 0);
            const querySignal = control?.signal || null;
            if (querySignal?.aborted) throw statsQueryAbortedError(control?.queryID);
            const remainingMs = deadlineAt > 0 ? deadlineAt - Date.now() : HISTORY_IO_TIMEOUT_MS;
            if (deadlineAt > 0 && remainingMs <= 0) throw statsQueryExpiredError(deadlineAt);
            const timeoutMs = Math.max(1, Math.min(HISTORY_IO_TIMEOUT_MS, remainingMs));
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            let timer = null;
            let abortHandler = null;
            try {
                const timeout = new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        if (deadlineAt > 0 && remainingMs <= HISTORY_IO_TIMEOUT_MS) {
                            reject(statsQueryExpiredError(deadlineAt));
                            try { controller?.abort?.(); } catch (e) {}
                            return;
                        }
                        reject(historySourceError('历史数据读取超时', {
                            path,
                            timeoutMs,
                        }));
                        try { controller?.abort?.(); } catch (e) {}
                    }, timeoutMs);
                });
                const aborted = querySignal ? new Promise((resolve, reject) => {
                    abortHandler = () => {
                        reject(statsQueryAbortedError(control?.queryID));
                        try { controller?.abort?.(); } catch (e) {}
                    };
                    querySignal.addEventListener?.('abort', abortHandler, { once: true });
                }) : new Promise(() => {});
                return await Promise.race([
                    Promise.resolve().then(() => operation(controller?.signal)),
                    timeout,
                    aborted,
                ]);
            } catch (cause) {
                if (text(cause?.code)) throw cause;
                throw historySourceError('历史数据读取超时或失败', {
                    path,
                    timeoutMs,
                    cause: text(cause?.message),
                });
            } finally {
                if (timer !== null) clearTimeout(timer);
                if (abortHandler) querySignal?.removeEventListener?.('abort', abortHandler);
            }
        }

        async function responseTextLimited(response, path) {
            const declaredLength = Number(response?.headers?.get?.('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > HISTORY_TEXT_LIMIT) {
                throw historyTextLimitError(path);
            }
            const reader = response?.body?.getReader?.();
            if (!reader || typeof TextDecoder !== 'function') {
                const value = await response.text();
                if (String(value || '').length > HISTORY_TEXT_LIMIT) throw historyTextLimitError(path);
                return value;
            }
            const decoder = new TextDecoder();
            const chunks = [];
            let receivedBytes = 0;
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                receivedBytes += Number(part.value?.byteLength) || 0;
                if (receivedBytes > HISTORY_TEXT_LIMIT) {
                    try { await reader.cancel(); } catch (e) {}
                    throw historyTextLimitError(path);
                }
                chunks.push(decoder.decode(part.value, { stream: true }));
            }
            chunks.push(decoder.decode());
            return chunks.join('');
        }

        function isMissingFileMessage(value) {
            const message = text(value).toLowerCase();
            return message.includes('not exist') || message.includes('not found')
                || message.includes('no such file') || message.includes('不存在');
        }

        async function fileText(path, optional = false, control = {}) {
            return withHistoryIoTimeout(path, async (signal) => {
                const response = await siyuanApi.client.fetch('/api/file/getFile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path }),
                    ...(signal ? { signal } : {}),
                });
                if (response.status === 404 && optional) return null;
                if (!response.ok) {
                    throw historySourceError(`读取文件失败: ${path}`, { path, status: Number(response.status) || 0 });
                }
                return responseTextLimited(response, path);
            }, control);
        }

        async function readJson(path, optional = false, control = {}) {
            const raw = await fileText(path, optional, control);
            if (raw == null || !text(raw)) return null;
            let parsed;
            try { parsed = JSON.parse(raw); }
            catch (cause) {
                if (path === SETTINGS_PATH) {
                    const error = new Error('番茄统计设置格式错误');
                    error.code = 'STATS_SETTINGS_INVALID';
                    error.details = { path, cause: text(cause?.message) };
                    throw error;
                }
                throw historySourceError(`历史数据格式错误: ${path}`, { path, cause: text(cause?.message) });
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                && Object.prototype.hasOwnProperty.call(parsed, 'code') && Number(parsed.code) !== 0) {
                if (optional && isMissingFileMessage(parsed.msg || parsed.message)) return null;
                throw historySourceError(`读取文件失败: ${path}`, {
                    path,
                    code: Number(parsed.code) || -1,
                    message: text(parsed.msg || parsed.message),
                });
            }
            return parsed;
        }

        async function listShardNames(control = {}) {
            const payload = await withHistoryIoTimeout(HISTORY_DIR, async (signal) => {
                const response = await siyuanApi.client.fetch('/api/file/readDir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: HISTORY_DIR }),
                    ...(signal ? { signal } : {}),
                });
                if (response.status === 404) return { code: 0, data: [] };
                if (!response.ok) {
                    throw historySourceError('读取历史目录失败', { path: HISTORY_DIR, status: Number(response.status) || 0 });
                }
                const raw = await responseTextLimited(response, HISTORY_DIR);
                try { return JSON.parse(String(raw || '')); }
                catch (cause) {
                    throw historySourceError('历史目录响应格式错误', {
                        path: HISTORY_DIR,
                        cause: text(cause?.message),
                    });
                }
            }, control);
            if (!payload || Number(payload.code) !== 0) {
                if (isMissingFileMessage(payload?.msg || payload?.message)) return [];
                throw historySourceError('读取历史目录失败', {
                    path: HISTORY_DIR,
                    code: Number(payload?.code) || -1,
                    message: text(payload?.msg || payload?.message),
                });
            }
            const value = payload.data;
            const entries = Array.isArray(value)
                ? value
                : (Array.isArray(value?.files) ? value.files
                    : (Array.isArray(value?.items) ? value.items
                        : (Array.isArray(value?.children) ? value.children : [])));
            const names = entries.map((entry) => text(entry?.name || entry?.path).split('/').pop())
                .filter((name) => /^(?:\d{4}|unknown)(?:-\d{1,20}-[0-9a-f]{8})?\.json$/.test(name))
                .sort();
            if (names.some((name) => !/^(?:\d{4}|unknown)\.json$/.test(name))) {
                throw historySourceError('历史索引缺失，无法确定权威分片版本', { path: HISTORY_DIR });
            }
            return names;
        }

        const historyRepository = statsCore.createHistoryRepository({
            readText: fileText,
            readJson,
            listShardNames,
            indexPath: HISTORY_INDEX_PATH,
            shardPath: (name) => `${HISTORY_DIR}/${name}`,
            legacyPaths: LEGACY_HISTORY_PATHS,
            createError: (code, message, details = {}) => {
                const error = code === 'HISTORY_SOURCE_UNAVAILABLE'
                    ? historySourceError(message, details)
                    : new Error(message);
                error.code = code;
                error.details = details;
                return error;
            },
        });

        async function loadRoutineSettings() {
            const value = await readJson(SETTINGS_PATH, true);
            return {
                routineButtons: Array.isArray(value?.routineButtons) ? value.routineButtons : [],
                routineGroups: Array.isArray(value?.routineGroups) ? value.routineGroups : [],
            };
        }

        const statsFailure = (error) => ({
            ok: false,
            data: null,
            error: {
                code: text(error?.code) || 'STATS_ERROR',
                message: text(error?.message) || '统计失败',
                details: error?.details || null,
            },
        });

        function focusScanCacheKey(options = {}) {
            const normalizeTime = (value) => {
                const parsed = Date.parse(String(value || ''));
                return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value || '');
            };
            const candidates = Array.from(new Set((Array.isArray(options?.candidateIDs) ? options.candidateIDs : [])
                .map(text).filter(Boolean))).sort();
            return JSON.stringify({
                method: 'focus',
                from: normalizeTime(options?.from),
                to: normalizeTime(options?.to),
                bucket: text(options?.bucket || 'none'),
                candidateIDs: candidates,
                candidateIDsConstrainTotals: options?.candidateIDsConstrainTotals === true,
                includeAssociations: options?.includeAssociations !== false,
            });
        }

        async function withHistoryScan(options, createAggregator) {
            try {
                const loaded = await historyRepository.scan(options, createAggregator);
                const data = { ...loaded.data, meta: { ...(loaded.data?.meta || {}), ...loaded.meta } };
                return { ok: true, data, error: null };
            } catch (error) {
                return statsFailure(error);
            }
        }

        const queryFocusResult = (options) => {
            const input = options && typeof options === 'object' ? options : {};
            return withHistoryScan(
                { ...input, __statsCacheKey: focusScanCacheKey(input) },
                () => statsCore.createFocusAggregator(input),
            );
        };
        const queryRoutineResult = async (options) => {
            try {
                const settings = await loadRoutineSettings();
                const input = { ...settings, ...(options || {}) };
                return await withHistoryScan(input, () => statsCore.createRoutineAggregator(input));
            } catch (error) {
                return statsFailure(error);
            }
        };
        const listSessionsResult = (options) => withHistoryScan(
            options || {},
            () => statsCore.createSessionAggregator(options || {}),
        );

        async function runCancelableStatsQuery(payload, operation) {
            const source = payload && typeof payload === 'object' ? payload : {};
            const queryID = text(source.queryID);
            if (!queryID || typeof AbortController !== 'function') return operation(source);
            const now = Date.now();
            cancelledStatsQueries.forEach((expiresAt, id) => {
                if (expiresAt <= now) cancelledStatsQueries.delete(id);
            });
            if (cancelledStatsQueries.delete(queryID)) {
                return statsFailure(statsQueryAbortedError(queryID));
            }
            const previous = activeStatsQueries.get(queryID);
            try { previous?.abort?.(); } catch (e) {}
            const controller = new AbortController();
            activeStatsQueries.set(queryID, controller);
            try {
                return await operation({ ...source, queryID, signal: controller.signal });
            } finally {
                if (activeStatsQueries.get(queryID) === controller) activeStatsQueries.delete(queryID);
            }
        }

        function cancelStatsQuery(payload) {
            const queryID = text(payload?.queryID);
            const controller = queryID ? activeStatsQueries.get(queryID) : null;
            if (controller) {
                activeStatsQueries.delete(queryID);
                try { controller.abort(); } catch (e) {}
            } else if (queryID) {
                while (cancelledStatsQueries.size >= 128) {
                    cancelledStatsQueries.delete(cancelledStatsQueries.keys().next().value);
                }
                cancelledStatsQueries.set(queryID, Date.now() + 30000);
            }
            return { cancelled: !!controller, queryID };
        }

        async function bindRpc() {
            await siyuanApi.rpc.bind('dockTomatoGetStatsCapabilities', async () => ({
                ok: true,
                data: statsCore.getCapabilities(),
                error: null,
            }));
            await siyuanApi.rpc.bind('dockTomatoQueryFocus', (payload) => runCancelableStatsQuery(payload, queryFocusResult));
            await siyuanApi.rpc.bind('dockTomatoQueryRoutine', (payload) => runCancelableStatsQuery(payload, queryRoutineResult));
            await siyuanApi.rpc.bind('dockTomatoListSessions', (payload) => runCancelableStatsQuery(payload, listSessionsResult));
            await siyuanApi.rpc.bind('dockTomatoCancelStatsQuery', async (payload) => ({
                ok: true,
                data: cancelStatsQuery(payload),
                error: null,
            }));
            await siyuanApi.rpc.bind('dockTomatoSetHistoryFallback', async (payload) => {
                const source = payload && typeof payload === 'object' ? payload : {};
                const requestedRevision = Math.max(0, Number(source.revision) || 0);
                let active = source.active === true && Array.isArray(source.records);
                if (active) {
                    try {
                        const index = await readJson(HISTORY_INDEX_PATH, true);
                        const persistedRevision = Math.max(0, Number(index?.revision) || 0, Date.parse(index?.updatedAt || '') || 0);
                        if (persistedRevision >= requestedRevision) active = false;
                    } catch (error) {
                        if (String(error?.code || '') !== 'HISTORY_SOURCE_UNAVAILABLE') throw error;
                    }
                }
                const fallback = historyRepository.setFallback(active, active ? source.records : null, requestedRevision || Date.now());
                return { ok: true, data: fallback, error: null };
            });
            await siyuanApi.rpc.bind('dockTomatoHistoryWriteLease', async (payload) => ({
                ok: true,
                data: handleHistoryWriteLease(payload),
                error: null,
            }));
        }

        siyuanApi.plugin.lifecycle.onload = async function () {
            await bindRpc();
        };
        siyuanApi.plugin.lifecycle.onrunning = function () {};
        siyuanApi.plugin.lifecycle.onunload = async function () {
            for (const name of RPC_NAMES) {
                try { await siyuanApi.rpc.unbind(name); } catch (e) {}
            }
            historyWriteLease = null;
            activeStatsQueries.forEach((controller) => {
                try { controller?.abort?.(); } catch (e) {}
            });
            activeStatsQueries.clear();
            cancelledStatsQueries.clear();
            historyRepository.clear();
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CONTRACT_VERSION = 2;
    const HISTORY_CONTRACT_VERSION = 2;
    const LEGACY_HISTORY_CONTRACT_VERSION = 1;
    const PHASES = new Set(['countdown', 'stopwatch', 'break', 'stopwatch-break']);
    const FOCUS_PHASES = new Set(['countdown', 'stopwatch']);
    const BREAK_PHASES = new Set(['break', 'stopwatch-break']);
    const BUCKETS = new Set(['none', 'hour', 'day', 'week', 'month', 'quarter', 'year']);
    const MAX_BUCKET_COUNT = 4096;
    const MAX_ASSOCIATION_COUNT = 5000;
    const MAX_RESULT_CELLS = 10000;
    const MAX_SCANNED_RECORDS = 250000;
    const MAX_UNIQUE_SESSIONS = 50000;
    const MAX_QUERY_DURATION_MS = 5000;
    const QUERY_BUDGET_CHECK_INTERVAL = 1024;
    const MAX_SHARD_TEXT_LENGTH = 32 * 1024 * 1024;
    const MAX_PENDING_HISTORY_SCANS = 8;
    const MAX_CACHED_HISTORY_SHARDS = 2;
    const MAX_CACHED_HISTORY_RECORDS = 20000;
    const MAX_CACHED_HISTORY_SHARD_BYTES = 8 * 1024 * 1024;
    const MAX_CACHED_QUERY_RESULTS = 16;
    const MAX_CACHED_QUERY_RESULT_BYTES = 4 * 1024 * 1024;
    const MAX_SINGLE_CACHED_QUERY_RESULT_BYTES = 1024 * 1024;

    const text = (value) => String(value == null ? '' : value).trim();
    const number = (value, fallback = 0) => {
        const result = Number(value);
        return Number.isFinite(result) ? result : fallback;
    };
    const uniqueStrings = (values) => Array.from(new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean)));

    function hashText(value) {
        const source = String(value == null ? '' : value);
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function parseTime(value) {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function normalizeRange(options = {}) {
        const fromMs = parseTime(options.from);
        const toMs = parseTime(options.to);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
            const error = new Error('from/to 必须构成有效时间范围');
            error.code = 'INVALID_RANGE';
            throw error;
        }
        return { fromMs, toMs, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
    }

    function createHistoryRepository(config = {}) {
        const readText = config.readText;
        const readJson = config.readJson;
        const listShardNames = config.listShardNames;
        const indexPath = text(config.indexPath);
        const shardPath = typeof config.shardPath === 'function' ? config.shardPath : (name) => name;
        const legacyPaths = Array.isArray(config.legacyPaths) ? config.legacyPaths.map(text).filter(Boolean) : [];
        let fallbackState = { active: false, revision: 0, records: null };
        let sourceEpoch = 0;
        let scanLane = Promise.resolve();
        let pendingScans = 0;
        const shardCache = new Map();
        let shardCacheRecordCount = 0;
        let shardCacheBytes = 0;
        const queryCache = new Map();
        let queryCacheBytes = 0;

        const makeError = (code, message, details = {}) => {
            const error = typeof config.createError === 'function'
                ? config.createError(code, message, details)
                : new Error(message);
            if (!text(error?.code)) error.code = code;
            if (error && !error.details) error.details = details;
            return error;
        };

        const requireAdapter = (value, name) => {
            if (typeof value !== 'function') throw makeError('HISTORY_SOURCE_UNAVAILABLE', `历史仓储缺少 ${name} 适配器`);
            return value;
        };

        function clearRepositoryCaches() {
            shardCache.clear();
            shardCacheRecordCount = 0;
            shardCacheBytes = 0;
            queryCache.clear();
            queryCacheBytes = 0;
        }

        function readCachedShard(key) {
            if (!key || !shardCache.has(key)) return null;
            const entry = shardCache.get(key);
            shardCache.delete(key);
            shardCache.set(key, entry);
            return entry.records;
        }

        function retainCachedShard(key, records, sourceTextLength = 0) {
            if (!key || !Array.isArray(records) || records.length > MAX_CACHED_HISTORY_RECORDS) return;
            const weight = Math.max(0, Number(sourceTextLength) || 0) * 2 + records.length * 192;
            if (weight <= 0 || weight > MAX_CACHED_HISTORY_SHARD_BYTES) return;
            if (shardCache.has(key)) {
                const existing = shardCache.get(key);
                shardCacheRecordCount -= existing?.records?.length || 0;
                shardCacheBytes -= existing?.weight || 0;
                shardCache.delete(key);
            }
            while (shardCache.size && (shardCache.size >= MAX_CACHED_HISTORY_SHARDS
                || shardCacheRecordCount + records.length > MAX_CACHED_HISTORY_RECORDS
                || shardCacheBytes + weight > MAX_CACHED_HISTORY_SHARD_BYTES)) {
                const oldestKey = shardCache.keys().next().value;
                const oldest = shardCache.get(oldestKey);
                shardCacheRecordCount -= oldest?.records?.length || 0;
                shardCacheBytes -= oldest?.weight || 0;
                shardCache.delete(oldestKey);
            }
            shardCache.set(key, { records, weight });
            shardCacheRecordCount += records.length;
            shardCacheBytes += weight;
        }

        function readCachedQuery(key) {
            if (!key || !queryCache.has(key)) return null;
            const entry = queryCache.get(key);
            queryCache.delete(key);
            queryCache.set(key, entry);
            return entry.value;
        }

        function retainCachedQuery(key, value) {
            if (!key || !value) return;
            let weight = 0;
            try { weight = JSON.stringify(value).length; } catch (error) { return; }
            if (weight <= 0 || weight > MAX_SINGLE_CACHED_QUERY_RESULT_BYTES) return;
            if (queryCache.has(key)) {
                queryCacheBytes -= queryCache.get(key)?.weight || 0;
                queryCache.delete(key);
            }
            while (queryCache.size && (queryCache.size >= MAX_CACHED_QUERY_RESULTS
                || queryCacheBytes + weight > MAX_CACHED_QUERY_RESULT_BYTES)) {
                const oldestKey = queryCache.keys().next().value;
                queryCacheBytes -= queryCache.get(oldestKey)?.weight || 0;
                queryCache.delete(oldestKey);
            }
            queryCache.set(key, { value, weight });
            queryCacheBytes += weight;
        }

        function assertQueryDeadline(options = {}, stage = '') {
            if (options?.signal?.aborted) {
                throw makeError('STATS_QUERY_ABORTED', '统计查询已取消', {
                    queryID: text(options?.queryID),
                    stage: text(stage),
                });
            }
            const deadlineAt = Math.max(0, Number(options?.deadlineAt) || 0);
            if (!deadlineAt || Date.now() < deadlineAt) return;
            throw makeError('STATS_QUERY_EXPIRED', '统计查询已超过执行期限', {
                deadlineAt,
                stage: text(stage),
            });
        }

        async function readShard(name, expected = null, options = {}) {
            assertQueryDeadline(options, 'before-shard-cache');
            const expectedHash = text(expected?.hash);
            const cacheKey = expectedHash ? `${name}\n${expectedHash}` : '';
            const cached = readCachedShard(cacheKey);
            if (cached) return cached;
            assertQueryDeadline(options, 'before-shard-read');
            const raw = await requireAdapter(readText, 'readText')(shardPath(name), false, options);
            assertQueryDeadline(options, 'after-shard-read');
            const rawText = String(raw || '');
            if (rawText.length > MAX_SHARD_TEXT_LENGTH) {
                throw makeError('HISTORY_SHARD_TOO_LARGE', `历史分片过大: ${name}`, {
                    maxShardTextLength: MAX_SHARD_TEXT_LENGTH,
                });
            }
            if (expectedHash && hashText(rawText) !== expectedHash) {
                throw makeError('HISTORY_REVISION_CHANGED', `历史分片校验失败: ${name}`);
            }
            const parsed = JSON.parse(rawText);
            if (!Array.isArray(parsed)) throw makeError('HISTORY_SOURCE_UNAVAILABLE', `历史分片格式错误: ${name}`);
            retainCachedShard(cacheKey, parsed, rawText.length);
            return parsed;
        }

        function shardOverlaps(meta, range) {
            const min = Date.parse(meta?.minStart || '');
            const max = Date.parse(meta?.maxEnd || '');
            if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
            return min < range.toMs && max > range.fromMs;
        }

        function shardFileName(year, meta) {
            const candidate = text(meta?.file);
            if (candidate === `${year}.json`
                || new RegExp(`^${year}-\\d{1,20}-[0-9a-f]{8}\\.json$`).test(candidate)) {
                return candidate;
            }
            return `${year}.json`;
        }

        function consumeRecords(records, aggregator, options = {}) {
            for (let index = 0; index < records.length; index += 1) {
                if (index % QUERY_BUDGET_CHECK_INTERVAL === 0) assertQueryDeadline(options, 'record-scan');
                aggregator.add(records[index]);
            }
        }

        function assertSourceEpoch(expectedEpoch) {
            if (sourceEpoch === expectedEpoch) return;
            throw makeError('HISTORY_REVISION_CHANGED', '历史数据源正在切换');
        }

        async function scanOnce(options, createAggregator) {
            assertQueryDeadline(options, 'scan-start');
            const expectedSourceEpoch = sourceEpoch;
            const aggregator = createAggregator();
            if (!aggregator || typeof aggregator.add !== 'function' || typeof aggregator.finish !== 'function') {
                throw makeError('STATS_ERROR', '统计聚合器无效');
            }
            if (fallbackState.active) {
                if (!Array.isArray(fallbackState.records)) {
                    throw makeError('HISTORY_SOURCE_UNAVAILABLE', '前端历史后备尚未同步到统计内核');
                }
                const cacheKey = text(options?.__statsCacheKey)
                    ? `fallback\n${fallbackState.revision}\n${text(options.__statsCacheKey)}`
                    : '';
                const cached = readCachedQuery(cacheKey);
                if (cached) return { data: cached.data, meta: { ...cached.meta, cacheHit: true } };
                consumeRecords(fallbackState.records, aggregator, options);
                const result = {
                    data: aggregator.finish(),
                    meta: { source: 'fallback-memory', revision: fallbackState.revision, recordCount: fallbackState.records.length },
                };
                retainCachedQuery(cacheKey, result);
                return result;
            }

            const firstIndex = await requireAdapter(readJson, 'readJson')(indexPath, true, options);
            assertSourceEpoch(expectedSourceEpoch);
            assertQueryDeadline(options, 'after-index-read');
            const historyContractVersion = Number(firstIndex?.contractVersion);
            if ((historyContractVersion === HISTORY_CONTRACT_VERSION
                || historyContractVersion === LEGACY_HISTORY_CONTRACT_VERSION) && firstIndex?.shards) {
                const range = normalizeRange(options);
                const revision = text(firstIndex.revision);
                const cacheKey = revision && text(options?.__statsCacheKey)
                    ? `indexed\n${historyContractVersion}\n${revision}\n${text(options.__statsCacheKey)}`
                    : '';
                const cached = readCachedQuery(cacheKey);
                if (cached) return { data: cached.data, meta: { ...cached.meta, cacheHit: true } };
                const entries = Object.entries(firstIndex.shards)
                    .filter(([year]) => /^(?:\d{4}|unknown)$/.test(year))
                    .filter(([, meta]) => shardOverlaps(meta, range))
                    .map(([year, meta]) => [shardFileName(year, meta), meta]);
                const declaredRecordCount = entries.reduce((sum, [, meta]) => (
                    sum + Math.max(0, Number(meta?.count) || 0)
                ), 0);
                if (declaredRecordCount > MAX_SCANNED_RECORDS) {
                    throw makeError('STATS_SCAN_LIMIT_EXCEEDED', `统计查询扫描超过 ${MAX_SCANNED_RECORDS} 条记录，请缩小时间范围`, {
                        maxScannedRecords: MAX_SCANNED_RECORDS,
                    });
                }
                let recordCount = 0;
                for (const [name, meta] of entries) {
                    let records;
                    try {
                        records = await readShard(name, meta, options);
                    } catch (error) {
                        error.details = { ...(error?.details || {}), indexRevision: revision, shard: name };
                        throw error;
                    }
                    assertSourceEpoch(expectedSourceEpoch);
                    recordCount += records.length;
                    if (recordCount > MAX_SCANNED_RECORDS) {
                        throw makeError('STATS_SCAN_LIMIT_EXCEEDED', `统计查询扫描超过 ${MAX_SCANNED_RECORDS} 条记录，请缩小时间范围`, {
                            maxScannedRecords: MAX_SCANNED_RECORDS,
                        });
                    }
                    consumeRecords(records, aggregator, options);
                }
                const secondIndex = await readJson(indexPath, true, options);
                assertSourceEpoch(expectedSourceEpoch);
                if (text(secondIndex?.revision) !== text(firstIndex.revision)) {
                    throw makeError('HISTORY_REVISION_CHANGED', '历史记录正在更新');
                }
                const result = {
                    data: aggregator.finish(),
                    meta: { source: 'indexed-shards', revision: firstIndex.revision, recordCount },
                };
                retainCachedQuery(cacheKey, result);
                return result;
            }

            const names = await requireAdapter(listShardNames, 'listShardNames')(options);
            if (names.length) {
                let recordCount = 0;
                for (const name of names) {
                    const records = await readShard(name, null, options);
                    assertSourceEpoch(expectedSourceEpoch);
                    recordCount += records.length;
                    if (recordCount > MAX_SCANNED_RECORDS) {
                        throw makeError('STATS_SCAN_LIMIT_EXCEEDED', `统计查询扫描超过 ${MAX_SCANNED_RECORDS} 条记录，请缩小时间范围`, {
                            maxScannedRecords: MAX_SCANNED_RECORDS,
                        });
                    }
                    consumeRecords(records, aggregator, options);
                }
                return { data: aggregator.finish(), meta: { source: 'unindexed-shards', revision: 0, recordCount } };
            }
            for (const path of legacyPaths) {
                const records = await readJson(path, true, options);
                assertSourceEpoch(expectedSourceEpoch);
                if (Array.isArray(records) && records.length) {
                    if (records.length > MAX_SCANNED_RECORDS) {
                        throw makeError('STATS_SCAN_LIMIT_EXCEEDED', `统计查询扫描超过 ${MAX_SCANNED_RECORDS} 条记录，请缩小时间范围`, {
                            maxScannedRecords: MAX_SCANNED_RECORDS,
                        });
                    }
                    consumeRecords(records, aggregator, options);
                    return { data: aggregator.finish(), meta: { source: 'legacy', revision: 0, recordCount: records.length } };
                }
            }
            return { data: aggregator.finish(), meta: { source: 'legacy', revision: 0, recordCount: 0 } };
        }

        async function scanWithRetry(options, createAggregator) {
            if (typeof createAggregator !== 'function') throw makeError('STATS_ERROR', '缺少统计聚合器工厂');
            let lastError = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    return await scanOnce(options, createAggregator);
                } catch (error) {
                    lastError = error;
                    if (attempt > 0) throw error;
                    if (error?.code === 'HISTORY_REVISION_CHANGED') continue;
                    const expectedRevision = text(error?.details?.indexRevision);
                    if (error?.code !== 'HISTORY_SOURCE_UNAVAILABLE' || !expectedRevision) throw error;
                    let latestIndex = null;
                    try { latestIndex = await readJson(indexPath, true, options); } catch (readError) { throw error; }
                    if (text(latestIndex?.revision) === expectedRevision) throw error;
                }
            }
            throw lastError || makeError('HISTORY_REVISION_CHANGED', '历史记录正在更新');
        }

        function scan(options = {}, createAggregator) {
            if (options?.signal?.aborted) {
                return Promise.reject(makeError('STATS_QUERY_ABORTED', '统计查询已取消', {
                    queryID: text(options?.queryID),
                    stage: 'scan-queued',
                }));
            }
            if (pendingScans >= MAX_PENDING_HISTORY_SCANS) {
                return Promise.reject(makeError('STATS_BUSY', '统计查询排队过多，请稍后重试', {
                    maxPendingScans: MAX_PENDING_HISTORY_SCANS,
                }));
            }
            pendingScans += 1;
            let released = false;
            const releasePending = () => {
                if (released) return;
                released = true;
                pendingScans = Math.max(0, pendingScans - 1);
            };
            const signal = options?.signal || null;
            let abortHandler = null;
            const aborted = signal ? new Promise((resolve, reject) => {
                abortHandler = () => {
                    releasePending();
                    reject(makeError('STATS_QUERY_ABORTED', '统计查询已取消', {
                        queryID: text(options?.queryID),
                        stage: 'scan-queued',
                    }));
                };
                signal.addEventListener?.('abort', abortHandler, { once: true });
            }) : null;
            const queued = scanLane.then(
                () => scanWithRetry(options, createAggregator),
                () => scanWithRetry(options, createAggregator),
            );
            scanLane = queued.catch(() => {});
            return (aborted ? Promise.race([queued, aborted]) : queued).finally(() => {
                signal?.removeEventListener?.('abort', abortHandler);
                releasePending();
            });
        }

        function setFallback(active, records, revision = Date.now()) {
            if (active === true && Array.isArray(records) && records.length > MAX_SCANNED_RECORDS) {
                throw makeError('STATS_SCAN_LIMIT_EXCEEDED', `历史后备包含超过 ${MAX_SCANNED_RECORDS} 条记录`, {
                    maxScannedRecords: MAX_SCANNED_RECORDS,
                });
            }
            const nextRevision = Math.max(0, Number(revision) || 0);
            const nextActive = active === true && Array.isArray(records);
            if (nextRevision < fallbackState.revision) {
                return { active: fallbackState.active, revision: fallbackState.revision };
            }
            if (nextRevision === fallbackState.revision && nextActive === fallbackState.active) {
                return { active: fallbackState.active, revision: fallbackState.revision };
            }
            fallbackState = { active: nextActive, revision: nextRevision, records: nextActive ? records : null };
            sourceEpoch += 1;
            clearRepositoryCaches();
            return { active: fallbackState.active, revision: fallbackState.revision };
        }

        function clear() {
            fallbackState = { active: false, revision: 0, records: null };
            sourceEpoch += 1;
            clearRepositoryCaches();
        }

        return { scan, setFallback, clear };
    }

    function phaseOf(record) {
        const legacyMode = text(record?.mode);
        if (PHASES.has(legacyMode)) return legacyMode;
        const phase = text(record?.phase);
        const timerMode = text(record?.timerMode);
        if (phase === 'break') return timerMode === 'stopwatch' ? 'stopwatch-break' : 'break';
        if (phase === 'focus') return timerMode === 'stopwatch' ? 'stopwatch' : 'countdown';
        return '';
    }

    function normalizeRecord(record, index = 0) {
        if (!(record && typeof record === 'object')) return null;
        const phase = phaseOf(record);
        if (!phase) return null;
        const startMs = parseTime(record.start);
        const endMs = parseTime(record.end);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
        const wallSec = (endMs - startMs) / 1000;
        const storedSec = number(record.durationMs) > 0
            ? number(record.durationMs) / 1000
            : (number(record.durationSec) > 0
            ? number(record.durationSec)
            : (number(record.durationMin) > 0 ? number(record.durationMin) * 60 : wallSec));
        if (!(storedSec > 0)) return null;
        const candidateIds = uniqueStrings([
            record.taskBlockId,
            record.databaseBlockId,
            record.blockId,
            record.taskId,
            record.routineButtonBlockId,
        ]);
        const rawSessionId = text(record.sessionId || record.session_id);
        const recordKey = [text(record.start), text(record.end), phase, text(record.timestamp), String(index)].join('|');
        const sessionKey = rawSessionId ? `${rawSessionId}:${phase}` : `legacy:${recordKey}`;
        return {
            raw: record,
            phase,
            startMs,
            endMs,
            wallSec,
            durationSec: storedSec,
            candidateIds,
            associationKey: candidateIds.join('|'),
            sessionId: rawSessionId,
            sessionKey,
            isCompleted: record.isCompleted === true,
            distractionCount: Math.max(0, Math.round(number(record.distractionCount ?? record.distractions))),
            plannedDurationMin: Math.max(0, number(record.plannedDuration || record.durationMin)),
            routine: {
                id: text(record.routineButtonId),
                name: text(record.routineButtonName || record.taskBlockName),
                icon: text(record.routineButtonIcon),
                groupId: text(record.routineButtonGroupId),
                blockId: text(record.routineButtonBlockId || record.taskBlockId),
                color: text(record.routineButtonColor),
            },
        };
    }

    function overlapAllocation(record, fromMs, toMs) {
        const left = Math.max(record.startMs, fromMs);
        const right = Math.min(record.endMs, toMs);
        if (right <= left || record.wallSec <= 0) return null;
        const overlapWallSec = (right - left) / 1000;
        return {
            fromMs: left,
            toMs: right,
            durationSec: record.durationSec * (overlapWallSec / record.wallSec),
        };
    }

    function startOfWeek(date) {
        const result = new Date(date.getTime());
        result.setHours(0, 0, 0, 0);
        const day = result.getDay();
        result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
        return result;
    }

    function bucketStart(ms, bucket) {
        const date = new Date(ms);
        if (bucket === 'hour') return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
        if (bucket === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        if (bucket === 'week') return startOfWeek(date).getTime();
        if (bucket === 'month') return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
        if (bucket === 'quarter') return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1).getTime();
        if (bucket === 'year') return new Date(date.getFullYear(), 0, 1).getTime();
        return ms;
    }

    function nextBucketStart(ms, bucket) {
        const date = new Date(ms);
        if (bucket === 'hour') return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime();
        if (bucket === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
        if (bucket === 'week') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
        if (bucket === 'month') return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
        if (bucket === 'quarter') return new Date(date.getFullYear(), date.getMonth() + 3, 1).getTime();
        if (bucket === 'year') return new Date(date.getFullYear() + 1, 0, 1).getTime();
        return ms;
    }

    function bucketKey(ms, bucket) {
        const date = new Date(ms);
        const pad = (value) => String(value).padStart(2, '0');
        if (bucket === 'hour') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
        if (bucket === 'day') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        if (bucket === 'week') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        if (bucket === 'month') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
        if (bucket === 'quarter') return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
        if (bucket === 'year') return String(date.getFullYear());
        return 'all';
    }

    function makeAccumulator() {
        return {
            focusSec: 0,
            countdownSec: 0,
            stopwatchSec: 0,
            breakSec: 0,
            countdownBreakSec: 0,
            stopwatchBreakSec: 0,
            plannedCountdownMin: 0,
            distractionCount: 0,
            sessionCount: 0,
            focusSessionCount: 0,
            countdownSessionCount: 0,
            stopwatchSessionCount: 0,
            breakSessionCount: 0,
            completedSessionCount: 0,
            lastEndMs: 0,
        };
    }

    function addAllocation(acc, record, durationSec, endMs = record.endMs) {
        if (!(durationSec > 0)) return;
        if (record.phase === 'countdown') {
            acc.focusSec += durationSec;
            acc.countdownSec += durationSec;
        } else if (record.phase === 'stopwatch') {
            acc.focusSec += durationSec;
            acc.stopwatchSec += durationSec;
        } else if (record.phase === 'break') {
            acc.breakSec += durationSec;
            acc.countdownBreakSec += durationSec;
        } else if (record.phase === 'stopwatch-break') {
            acc.breakSec += durationSec;
            acc.stopwatchBreakSec += durationSec;
        }
        acc.lastEndMs = Math.max(acc.lastEndMs, endMs);
    }

    function addSessionEvent(acc, event, completed = false, endMs = event.endMs, plannedDurationMin = event.plannedDurationMin) {
        acc.sessionCount += 1;
        if (event.phase === 'countdown') {
            acc.focusSessionCount += 1;
            acc.countdownSessionCount += 1;
            acc.plannedCountdownMin += plannedDurationMin;
        } else if (event.phase === 'stopwatch') {
            acc.focusSessionCount += 1;
            acc.stopwatchSessionCount += 1;
        } else if (BREAK_PHASES.has(event.phase)) {
            acc.breakSessionCount += 1;
        }
        if (completed) acc.completedSessionCount += 1;
        acc.lastEndMs = Math.max(acc.lastEndMs, endMs);
    }

    function serializeAccumulator(acc) {
        return {
            focusSec: acc.focusSec,
            countdownSec: acc.countdownSec,
            stopwatchSec: acc.stopwatchSec,
            breakSec: acc.breakSec,
            countdownBreakSec: acc.countdownBreakSec,
            stopwatchBreakSec: acc.stopwatchBreakSec,
            plannedCountdownMin: acc.plannedCountdownMin,
            distractionCount: acc.distractionCount,
            sessionCount: acc.sessionCount,
            focusSessionCount: acc.focusSessionCount,
            countdownSessionCount: acc.countdownSessionCount,
            stopwatchSessionCount: acc.stopwatchSessionCount,
            breakSessionCount: acc.breakSessionCount,
            completedSessionCount: acc.completedSessionCount,
            lastEndMs: acc.lastEndMs,
        };
    }

    function createQueryBudget() {
        const startedAt = Date.now();
        let scannedRecords = 0;
        const checkTime = () => {
            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs <= MAX_QUERY_DURATION_MS) return;
            const error = new Error(`统计查询执行超过 ${MAX_QUERY_DURATION_MS} 毫秒，请缩小时间或统计范围`);
            error.code = 'STATS_QUERY_TIMEOUT';
            error.details = { maxQueryDurationMs: MAX_QUERY_DURATION_MS, elapsedMs };
            throw error;
        };
        return {
            scan() {
                scannedRecords += 1;
                if (scannedRecords > MAX_SCANNED_RECORDS) {
                    const error = new Error(`统计查询扫描超过 ${MAX_SCANNED_RECORDS} 条记录，请缩小时间范围`);
                    error.code = 'STATS_SCAN_LIMIT_EXCEEDED';
                    error.details = { maxScannedRecords: MAX_SCANNED_RECORDS };
                    throw error;
                }
                if (scannedRecords % QUERY_BUDGET_CHECK_INTERVAL === 0) checkTime();
                return scannedRecords;
            },
            addSession(sessionCount) {
                if (sessionCount <= MAX_UNIQUE_SESSIONS) return;
                const error = new Error(`统计查询包含超过 ${MAX_UNIQUE_SESSIONS} 个会话，请缩小时间范围`);
                error.code = 'STATS_SESSION_LIMIT_EXCEEDED';
                error.details = { maxUniqueSessions: MAX_UNIQUE_SESSIONS };
                throw error;
            },
            finish() {
                checkTime();
                return { scannedRecords, elapsedMs: Date.now() - startedAt };
            },
        };
    }

    function validateBucketRange(range, bucket) {
        if (bucket === 'none') return 0;
        let cursor = bucketStart(range.fromMs, bucket);
        let count = 0;
        while (cursor < range.toMs) {
            const next = nextBucketStart(cursor, bucket);
            if (!(next > cursor)) break;
            count += 1;
            if (count > MAX_BUCKET_COUNT) {
                const error = new Error(`时间范围包含超过 ${MAX_BUCKET_COUNT} 个分桶，请缩小范围或使用更粗粒度`);
                error.code = 'STATS_RANGE_TOO_LARGE';
                error.details = { bucket, maxBucketCount: MAX_BUCKET_COUNT };
                throw error;
            }
            cursor = next;
        }
        return count;
    }

    function createBucketEntry(range, bucket, start) {
        const next = nextBucketStart(start, bucket);
        return {
            key: bucketKey(start, bucket),
            from: new Date(Math.max(start, range.fromMs)).toISOString(),
            to: new Date(Math.min(next, range.toMs)).toISOString(),
            acc: makeAccumulator(),
        };
    }

    function consumeResultCells(budget, count = 1) {
        if (!budget) return;
        if (budget.count + count > MAX_RESULT_CELLS) {
            const error = new Error(`统计结果包含超过 ${MAX_RESULT_CELLS} 个明细单元，请缩小时间或统计范围`);
            error.code = 'STATS_RESULT_TOO_LARGE';
            error.details = { maxResultCells: MAX_RESULT_CELLS };
            throw error;
        }
        budget.count += count;
    }

    function ensureBucket(map, range, bucket, ms, budget = null) {
        if (bucket === 'none') return null;
        const start = bucketStart(ms, bucket);
        const key = bucketKey(start, bucket);
        if (!map.has(key)) {
            consumeResultCells(budget);
            map.set(key, createBucketEntry(range, bucket, start));
        }
        return map.get(key);
    }

    function initializeBuckets(range, bucket, dense = true) {
        const map = new Map();
        if (bucket === 'none' || !dense) return map;
        let cursor = bucketStart(range.fromMs, bucket);
        while (cursor < range.toMs) {
            const next = nextBucketStart(cursor, bucket);
            if (!(next > cursor)) break;
            const item = createBucketEntry(range, bucket, cursor);
            map.set(item.key, item);
            cursor = next;
        }
        return map;
    }

    function addRecordToBuckets(map, range, bucket, record, allocation, sparse = false, budget = null) {
        if (bucket === 'none') return;
        let cursor = allocation.fromMs;
        while (cursor < allocation.toMs) {
            const start = bucketStart(cursor, bucket);
            const next = nextBucketStart(start, bucket);
            const right = Math.min(next, allocation.toMs);
            const fraction = (right - cursor) / Math.max(1, allocation.toMs - allocation.fromMs);
            const item = sparse ? ensureBucket(map, range, bucket, start, budget) : map.get(bucketKey(start, bucket));
            if (item) addAllocation(item.acc, record, allocation.durationSec * fraction, Math.min(record.endMs, right));
            if (!(right > cursor)) break;
            cursor = right;
        }
    }

    function createFocusAggregator(options = {}) {
        const range = normalizeRange(options);
        const bucket = BUCKETS.has(text(options.bucket)) ? text(options.bucket) : 'none';
        validateBucketRange(range, bucket);
        const includeAssociations = options.includeAssociations !== false;
        const candidateIDsConstrainTotals = options.candidateIDsConstrainTotals === true;
        const candidateFilter = Array.isArray(options.candidateIDs) || candidateIDsConstrainTotals
            ? new Set(uniqueStrings(Array.isArray(options.candidateIDs) ? options.candidateIDs : []))
            : null;
        const total = makeAccumulator();
        const buckets = initializeBuckets(range, bucket);
        const resultBudget = { count: buckets.size };
        const associations = new Map();
        const sessionEvents = new Map();
        const queryBudget = createQueryBudget();
        let ignoredInvalidRecords = 0;
        let multiAssociationSessionCount = 0;

        const registerSession = (record) => {
            let event = sessionEvents.get(record.sessionKey);
            if (!event) {
                event = {
                    phase: record.phase,
                    endMs: record.endMs,
                    bucketEndMs: record.endMs >= range.fromMs && record.endMs < range.toMs ? record.endMs : 0,
                    plannedDurationMin: record.plannedDurationMin,
                    completedInRange: record.isCompleted && record.endMs >= range.fromMs && record.endMs < range.toMs,
                    associationKey: '',
                    associationEndMs: 0,
                    associationBucketEndMs: 0,
                    associationPlannedDurationMin: 0,
                    associationCompletedInRange: false,
                    additionalAssociationEvents: null,
                };
                sessionEvents.set(record.sessionKey, event);
                queryBudget.addSession(sessionEvents.size);
                return event;
            }
            event.endMs = Math.max(event.endMs, record.endMs);
            if (record.endMs >= range.fromMs && record.endMs < range.toMs) {
                event.bucketEndMs = Math.max(event.bucketEndMs, record.endMs);
            }
            event.plannedDurationMin = Math.max(event.plannedDurationMin, record.plannedDurationMin);
            event.completedInRange = event.completedInRange
                || (record.isCompleted && record.endMs >= range.fromMs && record.endMs < range.toMs);
            return event;
        };

        const registerAssociationSession = (event, record) => {
            const associationKey = record.associationKey || '__unattributed';
            const bucketEndMs = record.endMs >= range.fromMs && record.endMs < range.toMs ? record.endMs : 0;
            const completedInRange = record.isCompleted && record.endMs >= range.fromMs && record.endMs < range.toMs;
            if (!event.associationKey) {
                event.associationKey = associationKey;
                event.associationEndMs = record.endMs;
                event.associationBucketEndMs = bucketEndMs;
                event.associationPlannedDurationMin = record.plannedDurationMin;
                event.associationCompletedInRange = completedInRange;
                return;
            }
            if (event.associationKey === associationKey) {
                event.associationEndMs = Math.max(event.associationEndMs, record.endMs);
                event.associationBucketEndMs = Math.max(event.associationBucketEndMs, bucketEndMs);
                event.associationPlannedDurationMin = Math.max(event.associationPlannedDurationMin, record.plannedDurationMin);
                event.associationCompletedInRange = event.associationCompletedInRange || completedInRange;
                return;
            }
            if (!event.additionalAssociationEvents) {
                event.additionalAssociationEvents = [];
                multiAssociationSessionCount += 1;
            }
            let associationEvent = event.additionalAssociationEvents.find((item) => item.associationKey === associationKey);
            if (!associationEvent) {
                associationEvent = {
                    associationKey,
                    endMs: record.endMs,
                    bucketEndMs,
                    plannedDurationMin: record.plannedDurationMin,
                    completedInRange,
                };
                event.additionalAssociationEvents.push(associationEvent);
                return;
            }
            associationEvent.endMs = Math.max(associationEvent.endMs, record.endMs);
            associationEvent.bucketEndMs = Math.max(associationEvent.bucketEndMs, bucketEndMs);
            associationEvent.plannedDurationMin = Math.max(associationEvent.plannedDurationMin, record.plannedDurationMin);
            associationEvent.completedInRange = associationEvent.completedInRange || completedInRange;
        };

        const add = (raw) => {
            const index = queryBudget.scan() - 1;
            const record = normalizeRecord(raw, index);
            if (!record) {
                ignoredInvalidRecords += 1;
                return;
            }
            const matchesCandidate = !candidateFilter
                || record.candidateIds.some((id) => candidateFilter.has(id));
            if (candidateIDsConstrainTotals && !matchesCandidate) return;
            const allocation = overlapAllocation(record, range.fromMs, range.toMs);
            if (!allocation) return;
            const sessionEvent = registerSession(record);
            addAllocation(total, record, allocation.durationSec);
            addRecordToBuckets(buckets, range, bucket, record, allocation);
            if (FOCUS_PHASES.has(record.phase) && record.endMs >= range.fromMs && record.endMs < range.toMs) {
                total.distractionCount += record.distractionCount;
                if (bucket !== 'none') {
                    const item = buckets.get(bucketKey(bucketStart(record.endMs, bucket), bucket));
                    if (item) item.acc.distractionCount += record.distractionCount;
                }
            }
            if (!FOCUS_PHASES.has(record.phase)) return;
            if (!includeAssociations) return;
            if (!matchesCandidate) return;

            const key = record.associationKey || '__unattributed';
            if (!associations.has(key)) {
                if (associations.size >= MAX_ASSOCIATION_COUNT) {
                    const error = new Error(`统计结果包含超过 ${MAX_ASSOCIATION_COUNT} 个任务关联，请缩小时间或任务范围`);
                    error.code = 'STATS_RESULT_TOO_LARGE';
                    error.details = { maxAssociationCount: MAX_ASSOCIATION_COUNT };
                    throw error;
                }
                consumeResultCells(resultBudget);
                associations.set(key, {
                    candidateIds: record.candidateIds.slice(),
                    acc: makeAccumulator(),
                    buckets: initializeBuckets(range, bucket, false),
                });
            }
            const association = associations.get(key);
            addAllocation(association.acc, record, allocation.durationSec);
            addRecordToBuckets(association.buckets, range, bucket, record, allocation, true, resultBudget);
            if (record.endMs >= range.fromMs && record.endMs < range.toMs) {
                association.acc.distractionCount += record.distractionCount;
                const item = ensureBucket(association.buckets, range, bucket, record.endMs, resultBudget);
                if (item) item.acc.distractionCount += record.distractionCount;
            }
            registerAssociationSession(sessionEvent, record);
        };

        const finish = () => {
            sessionEvents.forEach((event) => {
                addSessionEvent(total, event, event.completedInRange);
                if (event.bucketEndMs && bucket !== 'none') {
                    const item = buckets.get(bucketKey(bucketStart(event.bucketEndMs, bucket), bucket));
                    if (item) addSessionEvent(item.acc, event, event.completedInRange);
                }
                if (!FOCUS_PHASES.has(event.phase) || !includeAssociations || !event.associationKey) return;
                const addAssociationEvent = (associationKey, endMs, bucketEndMs, plannedDurationMin, completedInRange) => {
                    const association = associations.get(associationKey);
                    if (!association) return;
                    addSessionEvent(association.acc, event, completedInRange, endMs, plannedDurationMin);
                    if (bucketEndMs && bucket !== 'none') {
                        const item = ensureBucket(association.buckets, range, bucket, bucketEndMs, resultBudget);
                        if (item) addSessionEvent(item.acc, event, completedInRange, endMs, plannedDurationMin);
                    }
                };
                addAssociationEvent(
                    event.associationKey,
                    event.associationEndMs,
                    event.associationBucketEndMs,
                    event.associationPlannedDurationMin,
                    event.associationCompletedInRange,
                );
                (event.additionalAssociationEvents || []).forEach((associationEvent) => addAssociationEvent(
                    associationEvent.associationKey,
                    associationEvent.endMs,
                    associationEvent.bucketEndMs,
                    associationEvent.plannedDurationMin,
                    associationEvent.completedInRange,
                ));
            });
            const budgetMeta = queryBudget.finish();
            return {
                contractVersion: CONTRACT_VERSION,
                range: { from: range.from, to: range.to, bucket },
                totals: serializeAccumulator(total),
                buckets: Array.from(buckets.values()).map((item) => ({ key: item.key, from: item.from, to: item.to, ...serializeAccumulator(item.acc) })),
                associations: Array.from(associations.values()).map((item) => ({
                    candidateIds: item.candidateIds,
                    ...serializeAccumulator(item.acc),
                    buckets: Array.from(item.buckets.values())
                        .sort((left, right) => left.from.localeCompare(right.from))
                        .map((entry) => ({ key: entry.key, from: entry.from, to: entry.to, ...serializeAccumulator(entry.acc) })),
                })),
                meta: { source: 'memory', revision: 0, ignoredInvalidRecords, multiAssociationSessionCount, ...budgetMeta },
            };
        };

        return { add, finish };
    }

    function queryFocus(records, options = {}) {
        const aggregator = createFocusAggregator(options);
        for (const record of Array.isArray(records) ? records : []) aggregator.add(record);
        return aggregator.finish();
    }

    function routineDefinitions(options) {
        const groups = Array.isArray(options.routineGroups) ? options.routineGroups : [];
        const buttons = Array.isArray(options.routineButtons) ? options.routineButtons : [];
        const groupNames = new Map(groups.map((group) => [text(group?.id), text(group?.name) || '分组']).filter(([id]) => id));
        const metas = buttons.map((button, index) => ({
            id: text(button?.id),
            name: text(button?.name || button?.label) || `按钮 ${index + 1}`,
            icon: text(button?.icon),
            groupId: text(button?.groupId),
            blockId: text(button?.blockId || button?.taskBlockId),
            color: text(button?.color),
        }));
        return { groupNames, metas };
    }

    function resolveRoutine(record, definitions) {
        const routine = record.routine;
        let meta = routine.id ? definitions.metas.find((item) => item.id === routine.id) : null;
        if (!meta && routine.blockId) meta = definitions.metas.find((item) => item.blockId === routine.blockId);
        if (!meta && routine.name) meta = definitions.metas.find((item) => item.name === routine.name);
        if (meta) return { ...meta, key: meta.id ? `routine:${meta.id}` : `name:${meta.name}` };
        if (routine.id || routine.name || routine.blockId) {
            return {
                ...routine,
                name: routine.name || '已删除按钮',
                key: routine.id ? `routine:${routine.id}` : (routine.blockId ? `block:${routine.blockId}` : `name:${routine.name}`),
                archived: true,
            };
        }
        return null;
    }

    function createIntervalUnion(maxIntervals = Infinity) {
        const intervals = [];
        return {
            add(start, end) {
                if (!(end > start)) return;
                let low = 0;
                let high = intervals.length;
                while (low < high) {
                    const middle = (low + high) >> 1;
                    if (intervals[middle][1] < start) low = middle + 1;
                    else high = middle;
                }
                let right = low;
                let mergedStart = start;
                let mergedEnd = end;
                while (right < intervals.length && intervals[right][0] <= mergedEnd) {
                    mergedStart = Math.min(mergedStart, intervals[right][0]);
                    mergedEnd = Math.max(mergedEnd, intervals[right][1]);
                    right += 1;
                }
                intervals.splice(low, right - low, [mergedStart, mergedEnd]);
                if (intervals.length > maxIntervals) {
                    const error = new Error(`统计结果包含超过 ${MAX_RESULT_CELLS} 个明细单元，请缩小时间或统计范围`);
                    error.code = 'STATS_RESULT_TOO_LARGE';
                    error.details = { maxResultCells: MAX_RESULT_CELLS };
                    throw error;
                }
            },
            values: () => intervals,
            seconds: () => intervals.reduce((sum, item) => sum + Math.max(0, item[1] - item[0]) / 1000, 0),
        };
    }

    function createRoutineAggregator(options = {}) {
        const range = normalizeRange(options);
        const bucket = BUCKETS.has(text(options.bucket)) ? text(options.bucket) : 'none';
        validateBucketRange(range, bucket);
        const definitions = routineDefinitions(options);
        const groups = new Map();
        const covered = createIntervalUnion(MAX_RESULT_CELLS);
        const bucketItems = new Map();
        const queryBudget = createQueryBudget();
        if (bucket !== 'none') {
            initializeBuckets(range, bucket).forEach((item, key) => {
                bucketItems.set(key, {
                    key,
                    from: item.from,
                    to: item.to,
                    fromMs: Date.parse(item.from),
                    toMs: Date.parse(item.to),
                    groups: new Map(),
                    covered: createIntervalUnion(),
                });
            });
        }
        const resultBudget = { count: bucketItems.size };

        const ensureGroup = (target, id, label) => {
            if (!target.has(id)) {
                consumeResultCells(resultBudget);
                target.set(id, { id, label, focusSec: 0, breakSec: 0, totalSec: 0, buttons: new Map() });
            }
            return target.get(id);
        };
        const addRoutineDuration = (target, groupId, groupLabel, routine, isFocus, durationSec) => {
            const group = ensureGroup(target, groupId, groupLabel);
            if (isFocus) group.focusSec += durationSec;
            else group.breakSec += durationSec;
            group.totalSec += durationSec;
            if (!routine) return;
            if (!group.buttons.has(routine.key)) {
                consumeResultCells(resultBudget);
                group.buttons.set(routine.key, { ...routine, focusSec: 0, breakSec: 0, totalSec: 0 });
            }
            const button = group.buttons.get(routine.key);
            if (isFocus) button.focusSec += durationSec;
            else button.breakSec += durationSec;
            button.totalSec += durationSec;
        };
        const serializeGroups = (target) => Array.from(target.values()).map((group) => ({
            id: group.id,
            label: group.label,
            focusSec: group.focusSec,
            breakSec: group.breakSec,
            totalSec: group.totalSec,
            buttons: Array.from(group.buttons.values()).sort((a, b) => b.totalSec - a.totalSec),
        })).sort((a, b) => b.totalSec - a.totalSec);
        const addToRoutineBuckets = (record, allocation, groupId, groupLabel, routine, isFocus) => {
            if (bucket === 'none') return;
            let cursor = allocation.fromMs;
            while (cursor < allocation.toMs) {
                const start = bucketStart(cursor, bucket);
                const next = nextBucketStart(start, bucket);
                const right = Math.min(next, allocation.toMs);
                const item = bucketItems.get(bucketKey(start, bucket));
                if (item) {
                    const fraction = (right - cursor) / Math.max(1, allocation.toMs - allocation.fromMs);
                    addRoutineDuration(item.groups, groupId, groupLabel, routine, isFocus, allocation.durationSec * fraction);
                    item.covered.add(cursor, right);
                }
                if (!(right > cursor)) break;
                cursor = right;
            }
        };

        const add = (raw) => {
            const index = queryBudget.scan() - 1;
            const record = normalizeRecord(raw, index);
            if (!record) return;
            const allocation = overlapAllocation(record, range.fromMs, range.toMs);
            if (!allocation) return;
            covered.add(allocation.fromMs, allocation.toMs);
            const routine = resolveRoutine(record, definitions);
            const isFocus = FOCUS_PHASES.has(record.phase);
            const isBreak = BREAK_PHASES.has(record.phase);
            if (!isFocus && !isBreak) return;
            const groupId = routine ? (routine.groupId || '__ungrouped') : (isFocus ? '__other_focus' : '__other_break');
            const groupLabel = routine
                ? (routine.groupId ? (definitions.groupNames.get(routine.groupId) || '分组') : '未分组')
                : (isFocus ? '其他专注' : '其他休息');
            addRoutineDuration(groups, groupId, groupLabel, routine, isFocus, allocation.durationSec);
            addToRoutineBuckets(record, allocation, groupId, groupLabel, routine, isFocus);
        };

        const finish = () => {
            const budgetMeta = queryBudget.finish();
            const coveredIntervals = covered.values();
            consumeResultCells(resultBudget, coveredIntervals.length);
            const coveredSec = covered.seconds();
            const rangeSec = Math.max(0, range.toMs - range.fromMs) / 1000;
            return {
                contractVersion: CONTRACT_VERSION,
                range: { from: range.from, to: range.to, bucket },
                totals: { rangeSec, coveredSec, unrecordedSec: Math.max(0, rangeSec - coveredSec) },
                groups: serializeGroups(groups),
                buckets: Array.from(bucketItems.values()).map((item) => {
                const itemCoveredSec = item.covered.seconds();
                const itemRangeSec = Math.max(0, item.toMs - item.fromMs) / 1000;
                return {
                    key: item.key,
                    from: item.from,
                    to: item.to,
                    totals: { rangeSec: itemRangeSec, coveredSec: itemCoveredSec, unrecordedSec: Math.max(0, itemRangeSec - itemCoveredSec) },
                    groups: serializeGroups(item.groups),
                };
                }),
                coveredIntervals: coveredIntervals.map(([fromMs, toMs]) => ({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() })),
                meta: { source: 'memory', revision: 0, ...budgetMeta },
            };
        };

        return { add, finish };
    }

    function queryRoutine(records, options = {}) {
        const aggregator = createRoutineAggregator(options);
        for (const record of Array.isArray(records) ? records : []) aggregator.add(record);
        return aggregator.finish();
    }

    function createSessionAggregator(options = {}) {
        const range = normalizeRange(options);
        const limit = Math.max(1, Math.min(500, Math.round(number(options.limit, 100))));
        const offset = Math.max(0, Math.round(number(options.cursor, 0)));
        const sessions = new Map();
        const queryBudget = createQueryBudget();

        const add = (raw) => {
            const index = queryBudget.scan() - 1;
            const record = normalizeRecord(raw, index);
            if (!record) return;
            const allocation = overlapAllocation(record, range.fromMs, range.toMs);
            if (!allocation) return;
            if (!sessions.has(record.sessionKey)) {
                sessions.set(record.sessionKey, {
                    key: record.sessionKey,
                    sessionId: record.sessionId,
                    phase: record.phase,
                    startMs: record.startMs,
                    endMs: record.endMs,
                    durationSec: 0,
                    completed: false,
                    distractionCount: 0,
                    candidateIds: [],
                });
                queryBudget.addSession(sessions.size);
            }
            const session = sessions.get(record.sessionKey);
            session.startMs = Math.min(session.startMs, record.startMs);
            session.endMs = Math.max(session.endMs, record.endMs);
            session.durationSec += allocation.durationSec;
            session.completed = session.completed || record.isCompleted;
            session.distractionCount += record.distractionCount;
            record.candidateIds.forEach((id) => {
                if (!session.candidateIds.includes(id)) session.candidateIds.push(id);
            });
        };

        const finish = () => {
            const budgetMeta = queryBudget.finish();
            const all = Array.from(sessions.values()).sort((a, b) => b.endMs - a.endMs);
            const items = all.slice(offset, offset + limit).map((session) => ({
                ...session,
                start: new Date(session.startMs).toISOString(),
                end: new Date(session.endMs).toISOString(),
            }));
            return {
                contractVersion: CONTRACT_VERSION,
                range: { from: range.from, to: range.to },
                items,
                nextCursor: offset + items.length < all.length ? offset + items.length : null,
                total: all.length,
                meta: { source: 'memory', revision: 0, ...budgetMeta },
            };
        };

        return { add, finish };
    }

    function listSessions(records, options = {}) {
        const aggregator = createSessionAggregator(options);
        for (const record of Array.isArray(records) ? records : []) aggregator.add(record);
        return aggregator.finish();
    }

    function getCapabilities() {
        return {
            contractVersion: CONTRACT_VERSION,
            buckets: Array.from(BUCKETS),
            phases: Array.from(PHASES),
            methods: ['queryFocus', 'queryRoutine', 'listSessions'],
        };
    }

    return {
        CONTRACT_VERSION,
        HISTORY_CONTRACT_VERSION,
        LEGACY_HISTORY_CONTRACT_VERSION,
        getCapabilities,
        hashText,
        normalizeRange,
        normalizeRecord,
        createHistoryRepository,
        createFocusAggregator,
        createRoutineAggregator,
        createSessionAggregator,
        queryFocus,
        queryRoutine,
        listSessions,
    };
});
