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
  npm run dist:win
  if ($LASTEXITCODE -ne 0) { throw "Windows packaging failed with exit code $LASTEXITCODE" }
  $packagedNative = Join-Path $app 'dist-installers\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3'
  $electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    & $electron -e "const Database=require(process.argv[1]);const db=new Database(':memory:');if(db.prepare('SELECT 1 ok').get().ok!==1)process.exit(2);db.close();" $packagedNative
    if ($LASTEXITCODE -ne 0) { throw "Packaged SQLite validation failed with exit code $LASTEXITCODE" }
  } finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  }
  Copy-Item -LiteralPath (Join-Path $app "dist-installers\KMaster-POS-Setup-$version.exe") -Destination $artifact -Force
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw "NSIS completed without producing the expected installer: $artifact"
  }
  $file = Get-Item -LiteralPath $artifact
  if ($file.Length -lt 10MB) {
    throw "Installer is unexpectedly small ($($file.Length) bytes): $artifact"
  }
  $stream = [System.IO.File]::OpenRead($artifact)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
  Write-Host "Installer: $($file.FullName)"
  Write-Host "Size: $($file.Length) bytes"
  Write-Host "SHA256: $hash"
} finally {
  Pop-Location
}
