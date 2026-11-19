# Copyright (c) 2026 Brad Root
# SPDX-License-Identifier: MPL-2.0

param(
  [switch]$NoDesktopShortcut,
  [switch]$Build
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

if (Test-Path (Join-Path $ScriptDir 'Lurkr.exe')) {
  $SourceDir = $ScriptDir
} else {
  $SourceDir = Join-Path $RepoRoot 'release\win-unpacked'
  if ($Build -or -not (Test-Path (Join-Path $SourceDir 'Lurkr.exe'))) {
    if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
      throw "Could not find Lurkr.exe in $ScriptDir or $SourceDir."
    }
    Push-Location $RepoRoot
    try {
      Write-Host 'Building Lurkr for Windows...'
      npm run package:win:dir
      if ($LASTEXITCODE -ne 0) {
        throw "Windows package build failed with exit code $LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
  }
}

$ExeSource = Join-Path $SourceDir 'Lurkr.exe'
if (-not (Test-Path $ExeSource)) {
  throw "Expected Lurkr.exe at $ExeSource"
}

$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Lurkr'
Write-Host "Installing Lurkr to $InstallDir..."
if (Test-Path $InstallDir) {
  Remove-Item -Path $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $SourceDir '*') -Destination $InstallDir -Recurse -Force

$InstalledExe = Join-Path $InstallDir 'Lurkr.exe'
$WshShell = New-Object -ComObject WScript.Shell

$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
$StartShortcut = $WshShell.CreateShortcut((Join-Path $StartMenuDir 'Lurkr.lnk'))
$StartShortcut.TargetPath = $InstalledExe
$StartShortcut.WorkingDirectory = $InstallDir
$StartShortcut.IconLocation = "$InstalledExe,0"
$StartShortcut.Description = 'Lurkr Desktop IRC Client'
$StartShortcut.Save()

if (-not $NoDesktopShortcut) {
  $DesktopDir = [Environment]::GetFolderPath('Desktop')
  if ($DesktopDir) {
    $DesktopShortcut = $WshShell.CreateShortcut((Join-Path $DesktopDir 'Lurkr.lnk'))
    $DesktopShortcut.TargetPath = $InstalledExe
    $DesktopShortcut.WorkingDirectory = $InstallDir
    $DesktopShortcut.IconLocation = "$InstalledExe,0"
    $DesktopShortcut.Description = 'Lurkr Desktop IRC Client'
    $DesktopShortcut.Save()
  }
}

Write-Host 'Lurkr installed successfully on Windows!'
Write-Host "Executable: $InstalledExe"
