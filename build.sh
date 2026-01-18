#!/bin/bash

# build.sh - 打包插件，排除开发和系统临时文件

set -e

OUTPUT="package.zip"
PLUGIN_DIR="."

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "❌ 错误: 未找到插件目录 '$PLUGIN_DIR'" >&2
  exit 1
fi

# ✅ 保存原始工作目录
ORIGINAL_DIR="$(pwd)"

# 创建临时目录
TEMP_DIR="$(mktemp -d)"

echo "📁 复制插件文件到临时目录..."

# 复制全部内容
cp -R "$PLUGIN_DIR"/. "$TEMP_DIR/"

# 删除不需要的文件和目录
rm -rf "$TEMP_DIR/.git"
rm -rf "$TEMP_DIR/.github"
rm -rf "$TEMP_DIR/.vscode"
rm -f  "$TEMP_DIR/.gitignore"
rm -rf "$TEMP_DIR/.history"
rm -rf "$TEMP_DIR/.idea"
rm -f  "$TEMP_DIR/.DS_Store"
rm -rf "$TEMP_DIR/node_modules"
rm -f  "$TEMP_DIR/CHANGELOG.md"
rm -f  "$TEMP_DIR/LICENSE"
rm -f  "$TEMP_DIR/build.sh"
rm -f  "$TEMP_DIR/build.bat"
rm -f  "$TEMP_DIR/build.ps1"
rm -f  "$TEMP_DIR/.hotreload"
rm -f  "$TEMP_DIR/$OUTPUT"

# ✅ 使用保存的原始目录
(cd "$TEMP_DIR" && zip -r "$ORIGINAL_DIR/$OUTPUT" .)

# 清理临时目录
rm -rf "$TEMP_DIR"

echo "✅ 打包成功: $OUTPUT"
