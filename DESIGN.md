# Design System

## Overview

Dock Tomato 的提醒面板采用“原生工作台”方向：轻量表面、细分隔、紧凑行式列表、克制的蓝色强调。视觉系统需要兼容思源主题变量，HTML 原型使用 OKLCH 的冷灰中性色模拟浅色主题。

## Color

- Strategy: Restrained，强调色只用于当前视图、今天和关键操作。
- Canvas: `oklch(96.8% 0.007 255)`
- Panel: `oklch(98.8% 0.004 255)`
- Raised surface: `oklch(95.2% 0.010 255)`
- Strong text: `oklch(27% 0.025 255)`
- Muted text: `oklch(53% 0.022 255)`
- Divider: `oklch(89% 0.014 255)`
- Accent: `oklch(58% 0.16 260)`
- Success: `oklch(55% 0.12 150)`
- Warning: `oklch(61% 0.14 62)`
- Danger: `oklch(58% 0.17 28)`

## Typography

- UI family: `"Segoe UI Variable", "Microsoft YaHei UI", system-ui, sans-serif`
- Task title: 13px/1.4, weight 600
- Body and controls: 12px/1.4, weight 500
- Metadata: 11px/1.35, tabular numerals for time
- Panel title: 15px/1.3, weight 700

## Layout

- Base spacing unit: 4px.
- Panel inset: 12px on normal Dock widths, 8px below 330px.
- Group spacing: 16px; row spacing is created by dividers rather than separate card margins.
- Reminder row: fixed left time rail plus flexible content plus actions. Normal and narrow Dock widths use the same structure.
- Sticky header contains title, global actions, and a compact segmented view switcher.

## Components

- Segmented control: one shared background, no separate outlined tab cards.
- Time group: semantic label, item count, optional relative date; groups can collapse.
- Reminder row: flat interactive row with subtle hover surface and an emphasized state only for “today”.
- Type badges: compact icon plus text. `循环` uses repeat arrows, `跟随任务` uses a link icon, device scheduling uses a phone icon.
- Actions: completion is a small direct icon button; edit and delete live in an overflow menu.
- Toast: lightweight undo feedback after prototype actions.

## Motion

- 160–200ms ease-out transitions for opacity, color and transform only.
- Group collapse uses `grid-template-rows`.
- Respect reduced motion when available, though it is not a formal acceptance target.

## Responsive Behavior

- All supported widths retain the dedicated left time rail and the same row hierarchy.
- Narrow Dock widths adapt through tighter available content width and ellipsis on secondary text, not structural rearrangement.
- The reminder component has no width breakpoint because the SiYuan sidebar is continuously resizable; width presets exist only in the prototype harness for verification.
- Coarse pointer: action hit areas expand while visual button size remains compact.
