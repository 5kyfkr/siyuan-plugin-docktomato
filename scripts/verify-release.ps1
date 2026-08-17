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
if (-not $tests.Count) { throw 'No contract tests found' }
foreach ($test in $tests) {
    $repoRelativePath = 'scripts/' + $test.Name
    $trackedPath = @(& git -C $root ls-files -- $repoRelativePath)
    if ($LASTEXITCODE -ne 0 -or -not ($trackedPath -contains $repoRelativePath)) {
        throw "Release test is not tracked by Git: $repoRelativePath"
    }
    & node $test.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test failed: $($test.Name)" }
}

foreach ($relativePath in @('index.js', 'tomato.js', 'kernel.js')) {
    & node --check (Join-Path $root $relativePath)
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $relativePath" }
}

Write-Host ("Release verification passed: {0} tests" -f $tests.Count)
