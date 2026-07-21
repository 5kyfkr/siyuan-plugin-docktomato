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
        '.github',
        '.history',
        '.idea',
        '.vscode',
        '.DS_Store',
        'scripts',
        'node_modules',
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

    # 兼容打包
    $zipped = $false
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $output, [System.IO.Compression.CompressionLevel]::Optimal, $false)
        $zipped = $true
    } catch {
        $zipped = $false
    }
    if (-not $zipped) {
        Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $output -Force -CompressionLevel Optimal
    }

    Write-Host ("Pack success: {0}" -f $output)
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
