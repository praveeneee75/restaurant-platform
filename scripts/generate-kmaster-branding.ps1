$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$brandingDir = Join-Path $root "branding"
$outputDir = Join-Path $brandingDir "generated"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

function New-Color([string]$hex) {
  [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-Brush([string]$hex) {
  New-Object System.Drawing.SolidBrush (New-Color $hex)
}

function Write-Png($bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-BrandIcon([System.Drawing.Graphics]$graphics, [int]$size) {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 1024.0
  $background = New-RoundedPath 0 0 $size $size (236 * $scale)
  $graphics.FillPath((New-Brush "#102532"), $background)

  $circleSize = 628 * $scale
  $circleOffset = ($size - $circleSize) / 2
  $graphics.FillEllipse((New-Brush "#173748"), $circleOffset, $circleOffset, $circleSize, $circleSize)
  $ringPen = New-Object System.Drawing.Pen((New-Color "#D6E4EC"), (24 * $scale))
  $ringPen.Color = [System.Drawing.Color]::FromArgb(66, $ringPen.Color)
  $graphics.DrawEllipse($ringPen, $circleOffset + 12 * $scale, $circleOffset + 12 * $scale, $circleSize - 24 * $scale, $circleSize - 24 * $scale)

  $steamPen = New-Object System.Drawing.Pen((New-Color "#2EC4B6"), (30 * $scale))
  $steamPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $steamPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawCurve($steamPen, @(
    [System.Drawing.PointF]::new(381 * $scale, 350 * $scale),
    [System.Drawing.PointF]::new(395 * $scale, 316 * $scale),
    [System.Drawing.PointF]::new(420 * $scale, 284 * $scale),
    [System.Drawing.PointF]::new(451 * $scale, 262 * $scale)
  ))
  $graphics.DrawCurve($steamPen, @(
    [System.Drawing.PointF]::new(512 * $scale, 322 * $scale),
    [System.Drawing.PointF]::new(524 * $scale, 290 * $scale),
    [System.Drawing.PointF]::new(547 * $scale, 260 * $scale),
    [System.Drawing.PointF]::new(576 * $scale, 238 * $scale)
  ))
  $graphics.DrawCurve($steamPen, @(
    [System.Drawing.PointF]::new(640 * $scale, 350 * $scale),
    [System.Drawing.PointF]::new(654 * $scale, 316 * $scale),
    [System.Drawing.PointF]::new(679 * $scale, 284 * $scale),
    [System.Drawing.PointF]::new(710 * $scale, 262 * $scale)
  ))

  $clochePen = New-Object System.Drawing.Pen((New-Color "#F59E0B"), (44 * $scale))
  $clochePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $clochePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawCurve($clochePen, @(
    [System.Drawing.PointF]::new(300 * $scale, 674 * $scale),
    [System.Drawing.PointF]::new(329 * $scale, 548 * $scale),
    [System.Drawing.PointF]::new(410 * $scale, 452 * $scale),
    [System.Drawing.PointF]::new(512 * $scale, 452 * $scale),
    [System.Drawing.PointF]::new(614 * $scale, 452 * $scale),
    [System.Drawing.PointF]::new(695 * $scale, 548 * $scale),
    [System.Drawing.PointF]::new(724 * $scale, 674 * $scale)
  ))

  $kmLeft = [System.Drawing.RectangleF]::new(286 * $scale, 492 * $scale, 220 * $scale, 280 * $scale)
  $kmRight = [System.Drawing.RectangleF]::new(494 * $scale, 492 * $scale, 316 * $scale, 280 * $scale)
  $fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
  $kFont = New-Object System.Drawing.Font($fontFamily, [single](212 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $mFont = New-Object System.Drawing.Font($fontFamily, [single](182 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $centerFormat = New-Object System.Drawing.StringFormat
  $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString("K", $kFont, (New-Brush "#F59E0B"), $kmLeft, $centerFormat)
  $graphics.DrawString("M", $mFont, (New-Brush "#F8FAFC"), $kmRight, $centerFormat)
}

function New-IconBitmap([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  Draw-BrandIcon $graphics $size
  $graphics.Dispose()
  return $bitmap
}

function Resize-Png([string]$sourcePath, [int]$size, [string]$targetPath) {
  $source = [System.Drawing.Image]::FromFile($sourcePath)
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $size, $size)
  Write-Png $bitmap $targetPath
  $graphics.Dispose()
  $bitmap.Dispose()
  $source.Dispose()
}

function Write-Ico([string]$pngPath, [string]$icoPath) {
  $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
  $stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
  $writer.Flush()
  $writer.Dispose()
  $stream.Dispose()
}

$svgTargets = @(
  @{ Source = (Join-Path $brandingDir "kmaster-logo.svg"); Targets = @(
      (Join-Path $root "saas-backend\\public\\assets\\kmaster-logo.svg"),
      (Join-Path $root "mobile-app\\www\\assets\\kmaster-logo.svg"),
      (Join-Path $root "pos-app\\backend\\public\\icons\\kmaster-logo.svg")
    )
  },
  @{ Source = (Join-Path $brandingDir "kmaster-wordmark.svg"); Targets = @(
      (Join-Path $root "saas-backend\\public\\assets\\kmaster-wordmark.svg")
    )
  }
)

foreach ($entry in $svgTargets) {
  foreach ($target in $entry.Targets) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $entry.Source $target -Force
  }
}

$basePng = Join-Path $outputDir "kmaster-logo-1024.png"
$iconBitmap = New-IconBitmap 1024
Write-Png $iconBitmap $basePng
$iconBitmap.Dispose()

$pngTargets = @(
  @{ Size = 512; Targets = @(
      (Join-Path $root "mobile-app\\www\\assets\\kmaster-logo-512.png"),
      (Join-Path $root "mobile-app\\ios\\App\\App\\Assets.xcassets\\AppIcon.appiconset\\AppIcon-512@2x.png"),
      (Join-Path $root "pos-app\\build\\icon.png")
    )
  },
  @{ Size = 256; Targets = @(
      (Join-Path $outputDir "kmaster-logo-256.png")
    )
  },
  @{ Size = 192; Targets = @(
      (Join-Path $root "saas-backend\\public\\assets\\kmaster-logo-192.png"),
      (Join-Path $root "pos-app\\backend\\public\\icons\\kmaster-logo-192.png")
    )
  },
  @{ Size = 180; Targets = @(
      (Join-Path $root "saas-backend\\public\\assets\\apple-touch-icon.png"),
      (Join-Path $root "mobile-app\\www\\assets\\apple-touch-icon.png")
    )
  },
  @{ Size = 128; Targets = @(
      (Join-Path $root "saas-backend\\public\\favicon.png")
    )
  },
  @{ Size = 64; Targets = @(
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-mdpi\\ic_launcher.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-mdpi\\ic_launcher_round.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-mdpi\\ic_launcher_foreground.png")
    )
  },
  @{ Size = 96; Targets = @(
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-hdpi\\ic_launcher.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-hdpi\\ic_launcher_round.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-hdpi\\ic_launcher_foreground.png")
    )
  },
  @{ Size = 144; Targets = @(
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xhdpi\\ic_launcher.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xhdpi\\ic_launcher_round.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xhdpi\\ic_launcher_foreground.png")
    )
  },
  @{ Size = 192; Targets = @(
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxhdpi\\ic_launcher.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxhdpi\\ic_launcher_round.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxhdpi\\ic_launcher_foreground.png")
    )
  },
  @{ Size = 256; Targets = @(
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxxhdpi\\ic_launcher.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxxhdpi\\ic_launcher_round.png"),
      (Join-Path $root "mobile-app\\android\\app\\src\\main\\res\\mipmap-xxxhdpi\\ic_launcher_foreground.png")
    )
  }
)

foreach ($entry in $pngTargets) {
  foreach ($target in $entry.Targets) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Resize-Png $basePng $entry.Size $target
  }
}

$icoSource = Join-Path $outputDir "kmaster-logo-256.png"
Write-Ico $icoSource (Join-Path $root "saas-backend\\public\\favicon.ico")
Write-Ico $icoSource (Join-Path $root "pos-app\\build\\icon.ico")

Write-Host "Generated K'Master branding assets."
