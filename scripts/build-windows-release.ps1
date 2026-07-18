$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'pos-app'
$package = Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$output = Join-Path $app ("dist-release-$version")
$artifact = Join-Path $output ("KMaster-POS-Setup-$version.exe")

Write-Host "Building K'Master POS $version"
if (Get-Process -Name 'K''Master POS','makensis','electron-builder' -ErrorAction SilentlyContinue) {
  throw 'A POS or NSIS packaging process is already running. Close it and retry.'
}

Push-Location $app
try {
  npm run verify:native
  npx electron-builder --win nsis --publish never --config.directories.output=$output
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw "NSIS completed without producing the expected installer: $artifact"
  }
  $file = Get-Item -LiteralPath $artifact
  if ($file.Length -lt 10MB) {
    throw "Installer is unexpectedly small ($($file.Length) bytes): $artifact"
  }
  $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
  Write-Host "Installer: $($file.FullName)"
  Write-Host "Size: $($file.Length) bytes"
  Write-Host "SHA256: $hash"
} finally {
  Pop-Location
}
