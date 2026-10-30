(function (root) {
    'use strict';
    const normalizeLanguage = value => /^zh(?:[-_]|$)/i.test(String(value || '')) ? 'zh-CN' : 'en';
    const normalizePreference = value => value === 'en' || value === 'zh-CN' ? value : 'system';
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => (
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    ));

    function createI18n(messages, options = {}) {
        const locale = normalizeLanguage(options.locale || messages.__locale);
        const formatters = new Map();
        const missing = new Set();
        function t(key, params = {}) {
            let value = messages[key];
            if (typeof value !== 'string' && typeof params.count === 'number') {
                value = messages[key + (locale === 'en' && params.count === 1 ? '.one' : '.other')];
            }
            if (typeof value !== 'string') {
                if (!missing.has(key)) {
                    missing.add(key);
                    if (typeof console !== 'undefined') console.warn('[docktomato] Missing translation:', key);
                }
                return key;
            }
            return value.replace(/\{([A-Za-z_$][\w$]*)\}/g, (placeholder, name) => (
                Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? '') : placeholder
            ));
        }
        function date(value, format = {}) {
            const input = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(input.getTime())) return '';
            const key = JSON.stringify(format);
            if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, format));
            return formatters.get(key).format(input);
        }
        return Object.freeze({ locale, preference: normalizePreference(options.preference), messages, t,
            html: (key, params) => escapeHtml(t(key, params)), date });
    }

    const api = Object.freeze({ normalizeLanguage, normalizePreference, createI18n });
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') root.__dockTomatoI18nRuntime = api;
})(globalThis);
