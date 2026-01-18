@echo off
REM build.bat - package plugin (exclude dev/temp files)

setlocal enabledelayedexpansion

set OUTPUT=package.zip
set PLUGIN_DIR=.

if not exist "%PLUGIN_DIR%" (
    echo ERROR: plugin directory not found '%PLUGIN_DIR%' >&2
    exit /b 1
)

REM Save original working directory
set ORIGINAL_DIR=%cd%

REM Create temp directory
set TEMP_DIR=%TEMP%\plugin_build_%RANDOM%
if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

REM Delete old output first (avoid copying it into temp dir)
if exist "%ORIGINAL_DIR%\%OUTPUT%" del /q "%ORIGINAL_DIR%\%OUTPUT%"

echo Copy plugin files to temp dir...

REM Copy content with excludes
robocopy "%PLUGIN_DIR%" "%TEMP_DIR%" /E /R:1 /W:1 ^
 /XD ".git" ".github" ".vscode" "node_modules" ".history" ".idea" ^
 /XF ".gitignore" ".DS_Store" ".hotreload" "build.bat" "build.ps1" "build.sh" "CHANGELOG.md" "LICENSE" "%OUTPUT%"
set RC=%errorlevel%
if %RC% GEQ 8 (
    echo ERROR: robocopy failed with code %RC% >&2
    rd /s /q "%TEMP_DIR%"
    exit /b 1
)

REM Pack with PowerShell ZipFile to ensure Windows Explorer compatibility
echo Packing...
powershell -nologo -noprofile -executionpolicy bypass -command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('%TEMP_DIR%', '%ORIGINAL_DIR%\\%OUTPUT%', [System.IO.Compression.CompressionLevel]::Optimal, $false)"

if %errorlevel% neq 0 (
    echo Pack failed
    rd /s /q "%TEMP_DIR%"
    exit /b 1
)

REM 清理临时目录
rd /s /q "%TEMP_DIR%"

echo Pack success: %OUTPUT%

endlocal
