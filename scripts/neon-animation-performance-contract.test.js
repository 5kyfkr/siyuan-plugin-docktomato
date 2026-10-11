const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tomato.js'), 'utf8');

assert.match(source, /const TOMATO_ANIMATION_FPS = 30;/,
    'continuous tomato animations must be capped at 30fps');
assert.match(source, /slow:\s*120[\s\S]*normal:\s*90[\s\S]*fast:\s*60/,
    'breathing presets must use 120/90/60 frames for 4/3/2 second cycles');
assert.match(source, /function buildSteppedBreathingKeyframes\(/,
    'breathing opacity must be generated from discrete eased keyframes');

const easeStart = source.indexOf('function tomatoEaseInOut(');
const buildStart = source.indexOf('function buildSteppedBreathingKeyframes(', easeStart);
const updateStart = source.indexOf('function updateSteppedBreathingStyle(', buildStart);
assert.ok(easeStart >= 0 && buildStart > easeStart && updateStart > buildStart,
    'breathing keyframe helpers must remain extractable for contract verification');
const createBreathingCss = new Function(
    'userSettings',
    'TOMATO_BREATHING_FRAME_COUNTS',
    `${source.slice(easeStart, buildStart)}\n${source.slice(buildStart, updateStart)}\nreturn buildSteppedBreathingKeyframes();`
);
for (const [speed, frames] of Object.entries({ slow: 120, normal: 90, fast: 60 })) {
    const css = createBreathingCss(
        { appearance: { breathingSpeed: speed, breathingMinOpacity: 0.35, breathingMaxOpacity: 0.9 } },
        { slow: 120, normal: 90, fast: 60 }
    );
    assert.strictEqual((css.match(/% \{ opacity:/g) || []).length, frames + 1,
        `${speed} breathing must render at no more than 30fps`);
    assert.match(css, /0% \{ opacity: 0\.3500; \}/,
        `${speed} breathing must preserve its configured minimum opacity`);
    assert.match(css, /50\.0000% \{ opacity: 0\.9000; \}/,
        `${speed} breathing must preserve its configured maximum opacity`);
}

const shimmerKeyframes = source.match(/@keyframes shimmerFlow/g) || [];
assert.strictEqual(shimmerKeyframes.length, 1,
    'the injected neon stylesheet must contain one shimmer keyframe definition');
const neonStyleMarker = source.indexOf("style.id = 'tomato-neon-style';");
const neonCssStart = source.indexOf('style.textContent = `', neonStyleMarker) + 'style.textContent = `'.length;
const neonCssEnd = source.indexOf('`;', neonCssStart);
const neonCss = source.slice(neonCssStart, neonCssEnd);
assert.strictEqual((neonCss.match(/\{/g) || []).length, (neonCss.match(/\}/g) || []).length,
    'the injected neon stylesheet must have balanced rule braces');
assert.doesNotMatch(neonCss, /\/\//,
    'the injected neon stylesheet must not contain JavaScript-style comments');
assert.match(source, /@keyframes shimmerFlow\s*\{[\s\S]*transform:\s*translate3d\([\s\S]*100%\s*\{[\s\S]*transform:\s*translate3d\(/,
    'timeline shimmer must move through compositor transforms');
assert.doesNotMatch(source, /@keyframes shimmerFlow\s*\{[\s\S]{0,300}background-position/,
    'timeline shimmer must not animate background-position');
assert.match(source, /--shimmer-frames[\s\S]*TOMATO_ANIMATION_FPS/,
    'timeline shimmer must derive its step count from the 30fps cap');
assert.strictEqual((source.match(/const shouldBreathe = \(userSettings\.timeline\.enableBreathing/g) || []).length, 1,
    'timeline breathing state must be updated once per timeline tick');

const normalizedSource = source.replaceAll('\r\n', '\n');
const effectsStart = normalizedSource.indexOf('            const timelineAnimationActive =');
const effectsEnd = normalizedSource.indexOf('\n        }\n\n        let nowPercent', effectsStart);
assert.ok(effectsStart >= 0 && effectsEnd > effectsStart, 'timeline effect updater must be present');
const updateEffects = new Function(
    'userSettings', 'timerMode', 'isRunning', 'isTimerPaused', 'timelineVisual', 'timelineViewport',
    'isNeonMode', 'hasTimelineCustomColors', 'TOMATO_ANIMATION_FPS',
    normalizedSource.slice(effectsStart, effectsEnd)
);
function createEffectElement() {
    const classes = new Set();
    const properties = new Map();
    return {
        classes, properties,
        classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
        style: { setProperty(name, value) { properties.set(name, value); } }
    };
}
for (const mode of ['countdown', 'stopwatch', 'stopwatch-break', 'break']) {
    for (const breathing of [false, true]) {
        for (const appearanceBreathing of [false, true]) {
            for (const shimmer of [false, true]) {
                const visual = createEffectElement();
                const viewport = createEffectElement();
                const settings = {
                    timeline: {enableBreathing: breathing, enableShimmerFlow: shimmer, shimmerDuration: 8, shimmerWidth: 5, shimmerColor: '#ffffff'},
                    appearance: {enableBreathing: appearanceBreathing}
                };
                updateEffects(settings, mode, true, false, visual, viewport, false, false, 30);
                for (const element of [visual, viewport]) {
                    assert.strictEqual(element.classes.has('shimmering'), shimmer,
                        `${mode}: shimmer must follow its own switch independently of breathing`);
                    assert.strictEqual(element.classes.has('breathing'), breathing && appearanceBreathing,
                        `${mode}: breathing must follow its own switches independently of shimmer`);
                }
                for (const [running, paused] of [[true, true], [false, false]]) {
                    updateEffects(settings, mode, running, paused, visual, viewport, false, false, 30);
                    for (const element of [visual, viewport]) {
                        assert.strictEqual(element.classes.has('shimmering'), false, 'inactive timers must clear shimmer');
                        assert.strictEqual(element.classes.has('breathing'), false, 'inactive timers must clear breathing');
                    }
                }
            }
        }
    }
}

assert.match(source, /tomato-animations-paused/,
    'neon animations must expose a document visibility pause state');
assert.match(source, /animation-play-state:\s*paused\s*!important/,
    'hidden-page animation state must pause compositor animations');
assert.match(source, /lastProgressVisualKey/,
    'progress bar theme and glow writes must be cached');
assert.match(source, /translate3d\(\$\{leftPos\}px/,
    'progress indicator movement must use transforms instead of left animation');

assert.match(source, /timelineActiveKey/,
    'active timeline segments must have stable reconciliation keys');
assert.match(source, /beginTimelineActiveRender\(/,
    'active timeline rendering must reuse existing keyed nodes');
const activeRenderBlock = source.slice(
    source.indexOf('function renderTimelineActiveSegments('),
    source.indexOf('function applyProgressBarVisual(')
);
assert.doesNotMatch(activeRenderBlock, /layerEl\.innerHTML\s*=\s*['"]['"]/,
    'active timeline rendering must not clear and rebuild its layer every second');
assert.match(source, /tomato-neon-animation-style['"]\)\?\.remove\(\)/,
    'generated breathing keyframes must be removed during plugin cleanup');

console.log('neon animation performance contract tests passed');
