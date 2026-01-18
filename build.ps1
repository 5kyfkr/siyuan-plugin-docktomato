$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$output = Join-Path $pluginDir 'package.zip'
$pluginJson = Join-Path $pluginDir 'plugin.json'
$pluginName = (Get-Content -Raw -Encoding UTF8 -LiteralPath $pluginJson | ConvertFrom-Json).name
if ([string]::IsNullOrWhiteSpace($pluginName)) { throw 'plugin.json name missing' }

$tempDir = Join-Path $env:TEMP ('plugin_build_' + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$tempPluginDir = Join-Path $tempDir $pluginName
New-Item -ItemType Directory -Path $tempPluginDir | Out-Null

try {
    Copy-Item -Path (Join-Path $pluginDir '*') -Destination $tempPluginDir -Recurse -Force

    $removePaths = @(
        '.git',
        '.gitignore',
        '.history',
        '.idea',
        '.DS_Store',
        'node_modules',
        'package.zip',
        'build.sh',
        'build.bat',
        'build.ps1',
        '.hotreload'
    )

    foreach ($p in $removePaths) {
        $full = Join-Path $tempPluginDir $p
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Recurse -Force
        }
    }

    if (Test-Path -LiteralPath $output) {
        Remove-Item -LiteralPath $output -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $output, [System.IO.Compression.CompressionLevel]::Optimal, $false)

    Write-Host ("Pack success: {0}" -f $output)
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
