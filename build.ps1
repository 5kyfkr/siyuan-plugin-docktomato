$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSCommandPath
$output = Join-Path $pluginDir 'package.zip'
$pluginJson = Join-Path $pluginDir 'plugin.json'
$pluginName = (Get-Content -Raw -Encoding UTF8 -LiteralPath $pluginJson | ConvertFrom-Json).name
if ([string]::IsNullOrWhiteSpace($pluginName)) { throw 'plugin.json name missing' }

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('plugin_build_' + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    # 优化：排除不需要的目录，只复制需要的文件
    $excludePaths = @(
        '.git',
        '.gitignore',
        '.codex-tmp',
        'docs',
        '.github',
        '.impeccable.md',
        '.playwright-cli',
        '.history',
        '.idea',
        '.vscode',
        '.DS_Store',
        'scripts',
        'node_modules',
        'output',
        'PRODUCT.md',
        'DESIGN.md',
        'GUIDE_zh_CN.md',
        'REPRO_SYNC.md',
        'CHANGELOG.md',
        'LICENSE',
        'package.zip',
        'build.sh',
        'build.bat',
        'build.ps1',
        '.hotreload'
    )

    Get-ChildItem -Path $pluginDir -Exclude $excludePaths | Copy-Item -Destination $tempDir -Recurse -Force

    # 清理可能残留的 zip
    Get-ChildItem -Path $tempDir -Filter '*.zip' -File -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -Force } catch {}
    }

    # 尝试重置时间戳（可选，容错）
    $chinaTime = [DateTime]::UtcNow.AddHours(8)
    Get-ChildItem -Path $tempDir -Recurse -File | ForEach-Object {
        try { $_.LastWriteTime = $chinaTime } catch {}
        try { $_.CreationTime = $chinaTime } catch {}
    }

    Get-ChildItem -Path $tempDir -Filter '*.zip' -File -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -Force } catch {}
    }

    # 重置所有文件的时间戳为中国时间 (UTC+8)
    $chinaTime = [DateTime]::UtcNow.AddHours(8)
    Get-ChildItem -Path $tempDir -Recurse -File | ForEach-Object {
        $_.LastWriteTime = $chinaTime
        $_.CreationTime = $chinaTime
    }

    if (Test-Path -LiteralPath $output) {
        Remove-Item -LiteralPath $output -Force
    }

    # Explicit POSIX entry paths also work with Windows PowerShell/.NET Framework.
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $python) { throw 'Python 3 is required to build package.zip' }
    $zipScript = @'
import os
import sys
import zipfile

source, output = sys.argv[1:]
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for root, directories, files in os.walk(source):
        directories.sort()
        files.sort()
        for name in files:
            path = os.path.join(root, name)
            relative = os.path.relpath(path, source).replace(os.sep, '/')
            archive.write(path, relative)
'@
    & $python.Source -c $zipScript $tempDir $output
    if ($LASTEXITCODE -ne 0) { throw 'Python ZIP packaging failed' }

    Write-Host ("Pack success: {0}" -f $output)
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        $resolvedTempDir = (Resolve-Path -LiteralPath $tempDir).Path
        $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
        if ([System.IO.Path]::GetDirectoryName($resolvedTempDir) -ne $expectedTempRoot) {
            throw "Unexpected build staging directory: $resolvedTempDir"
        }
        Remove-Item -LiteralPath $resolvedTempDir -Recurse -Force
    }
}
