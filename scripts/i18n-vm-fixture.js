'use strict';
// Isolated script tests receive the language services supplied by SiYuan in production.
const vm = require('node:vm');
const runtime = require('../i18n/runtime');
const messages = require('../i18n/zh-CN.json');
function prepare(context = {}) {
    context.__dockTomatoI18n ||= runtime.createI18n(messages);
    context.__dockTomatoI18nRuntime ||= runtime;
    context.__tt ||= context.__dockTomatoI18n.t;
    context.siyuan ||= {};
    context.siyuan.config ||= {};
    context.siyuan.config.appearance ||= { lang: 'zh_CN' };
    if (context.siyuan.plugin) context.siyuan.plugin.i18n ||= messages;
    if (context.require) {
        const original = context.require;
        context.require = (name) => {
            const result = original(name);
            if (name === 'siyuan' && result?.Plugin) result.Plugin.prototype.i18n ||= messages;
            return result;
        };
    }
    return context;
}
module.exports = { ...vm, prepare,
    createContext: (context, options) => vm.createContext(prepare(context), options),
    runInNewContext: (code, context, options) => vm.runInNewContext(code, prepare(context), options),
};
