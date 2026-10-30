$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$requiredFiles = @('plugin.json', 'index.js', 'tomato.js', 'kernel.js', 'build.ps1')
foreach ($relativePath in $requiredFiles) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required release file is missing: $relativePath"
    }
    $trackedPath = @(& git -C $root ls-files -- $relativePath)
    if ($LASTEXITCODE -ne 0 -or -not ($trackedPath -contains $relativePath)) {
        throw "Required release file is not tracked by Git: $relativePath"
    }
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'plugin.json') | ConvertFrom-Json
if (-not (@($manifest.kernels) -contains 'all')) { throw 'plugin.json must enable the Kernel runtime' }
if ($manifest.disabledInPublish -ne $true) { throw 'plugin.json must disable the plugin in publish-service pages' }

$tests = Get-ChildItem -LiteralPath (Join-Path $root 'scripts') -Filter '*.test.js' -File | Sort-Object Name
& node (Join-Path $root 'scripts/check-i18n.js')
if ($LASTEXITCODE -ne 0) { throw 'Language dictionary or README check failed' }
if (-not $tests.Count) { throw 'No contract tests found' }
if ([string]::IsNullOrWhiteSpace($env:PLAYWRIGHT_MODULE)) {
    $playwrightVersion = '1.63.0'
    $dependencyDir = Join-Path ([System.IO.Path]::GetTempPath()) "docktomato-release-tests-$playwrightVersion"
    $playwrightModule = Join-Path $dependencyDir 'node_modules/playwright'
    if (-not (Test-Path -LiteralPath (Join-Path $playwrightModule 'package.json'))) {
        & npm install --prefix $dependencyDir --no-save --no-package-lock --ignore-scripts "playwright@$playwrightVersion"
        if ($LASTEXITCODE -ne 0) { throw 'Playwright installation failed' }
    }
    $browserArgs = @('install', 'chromium')
    if ($IsLinux) { $browserArgs = @('install', '--with-deps', 'chromium') }
    & node (Join-Path $playwrightModule 'cli.js') @browserArgs
    if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' }
    $env:PLAYWRIGHT_MODULE = $playwrightModule
}
foreach ($test in $tests) {
    $repoRelativePath = 'scripts/' + $test.Name
    $trackedPath = @(& git -C $root ls-files -- $repoRelativePath)
    if ($LASTEXITCODE -ne 0 -or -not ($trackedPath -contains $repoRelativePath)) {
        throw "Release test is not tracked by Git: $repoRelativePath"
    }
    & node $test.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test failed: $($test.Name)" }
}

foreach ($relativePath in @('index.js', 'tomato.js', 'kernel.js', 'i18n/runtime.js')) {
    & node --check (Join-Path $root $relativePath)
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $relativePath" }
}

Write-Host ("Release verification passed: {0} tests" -f $tests.Count)
