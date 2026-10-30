'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
assert.ok(fs.statSync(path.join(root, 'i18n/runtime.js')).isFile(), 'Missing language runtime');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const locales = ['en', 'zh-CN'];
const dictionaries = Object.fromEntries(locales.map(locale => {
    const source = read('i18n/' + locale + '.json');
    const keys = [...source.matchAll(/^  "([^"\\]+)":/gm)].map(m => m[1]);
    assert.equal(new Set(keys).size, keys.length, 'Duplicate language key in ' + locale);
    const messages = JSON.parse(source);
    assert.equal(messages.__locale, locale);
    for (const [key, value] of Object.entries(messages)) {
        assert.equal(typeof value, 'string', locale + ': ' + key);
        assert.ok(value.trim(), locale + ': empty ' + key);
    }
    return [locale, messages];
}));
assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries['zh-CN']).sort());
const parameters = value => [...new Set([...value.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map(m => m[1]))].sort();
for (const key of Object.keys(dictionaries.en)) {
    assert.deepEqual(parameters(dictionaries.en[key]), parameters(dictionaries['zh-CN'][key]), 'Placeholder mismatch: ' + key);
}
let references = 0;
for (const file of ['index.js', 'tomato.js', 'kernel.js']) {
    const source = read(file);
    for (const match of source.matchAll(/(?:__tt|__dockTomatoI18n\.html)\(["']([\w.]+)["']/g)) {
        assert.ok(match[1] in dictionaries.en, file + ': missing ' + match[1]);
        references++;
    }
    for (const match of source.matchAll(/(?:__tt|__dockTomatoI18n\.html)\(["']([\w.]+)["']\s*\)/g)) {
        assert.equal(parameters(dictionaries.en[match[1]] || '').length, 0, file + ': parameters missing for ' + match[1]);
    }
}
const manifest = JSON.parse(read('plugin.json'));
for (const file of Object.values(manifest.readme)) assert.ok(fs.existsSync(path.join(root, file)));
assert.equal(manifest.readme['zh-CN'], 'README_zh_CN.md');
assert.match(read(manifest.readme.default), /\]\(README_zh_CN\.md\)/);
// The Chinese guide keeps its existing content; both guides are selected by the manifest.
assert.equal(manifest.readme.default, 'README.md');
console.log(`i18n verified: ${Object.keys(dictionaries.en).length - 1} messages, ${references} references and both READMEs`);
