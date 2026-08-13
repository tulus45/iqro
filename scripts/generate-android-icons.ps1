param(
    [string]$Source = (Join-Path $PSScriptRoot '..\assets\app-icon-mosque-glossy.png'),
    [string]$Foreground = (Join-Path $PSScriptRoot '..\assets\app-icon-mosque-foreground.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$foregroundPath = (Resolve-Path -LiteralPath $Foreground).Path
$resPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\android\app\src\main\res')).Path
$webLogoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\app-logo.png'))
$emerald = [System.Drawing.ColorTranslator]::FromHtml('#166534')
$densities = [ordered]@{
    'ldpi' = @{ launcher = 36; adaptive = 81 }
    'mdpi' = @{ launcher = 48; adaptive = 108 }
    'hdpi' = @{ launcher = 72; adaptive = 162 }
    'xhdpi' = @{ launcher = 96; adaptive = 216 }
    'xxhdpi' = @{ launcher = 144; adaptive = 324 }
    'xxxhdpi' = @{ launcher = 192; adaptive = 432 }
}

function New-Canvas([int]$size) {
    return [System.Drawing.Bitmap]::new(
        $size,
        $size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
}

function Set-HighQuality([System.Drawing.Graphics]$graphics) {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
}

function Save-ResizedIcon(
    [System.Drawing.Image]$sourceImage,
    [int]$size,
    [string]$outputPath,
    [bool]$roundMask = $false
) {
    $bitmap = New-Canvas $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        Set-HighQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)

        if ($roundMask) {
            $clip = [System.Drawing.Drawing2D.GraphicsPath]::new()
            try {
                $clip.AddEllipse(0, 0, $size, $size)
                $graphics.SetClip($clip)
                $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
                $graphics.ResetClip()
            }
            finally {
                $clip.Dispose()
            }
        }
        else {
            $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        }

        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-AdaptiveForeground(
    [System.Drawing.Image]$foregroundImage,
    [int]$size,
    [string]$outputPath
) {
    $bitmap = New-Canvas $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        Set-HighQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)

        # Android animates adaptive-icon foregrounds inside a smaller safe zone.
        # Keep the whole mihrab visible for circle, squircle and rounded-square masks.
        $drawSize = [int][Math]::Round($size * 0.78)
        $offset = [int][Math]::Round(($size - $drawSize) / 2)
        $graphics.DrawImage($foregroundImage, $offset, $offset, $drawSize, $drawSize)
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-SolidBackground([int]$size, [string]$outputPath) {
    $bitmap = New-Canvas $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear($emerald)
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$foregroundImage = [System.Drawing.Image]::FromFile($foregroundPath)

try {
    foreach ($density in $densities.GetEnumerator()) {
        $targetDir = Join-Path $resPath "mipmap-$($density.Key)"
        $launcherSize = [int]$density.Value.launcher
        $adaptiveSize = [int]$density.Value.adaptive

        Save-ResizedIcon $sourceImage $launcherSize (Join-Path $targetDir 'ic_launcher.png')
        Save-ResizedIcon $sourceImage $launcherSize (Join-Path $targetDir 'ic_launcher_round.png') $true
        Save-AdaptiveForeground $foregroundImage $adaptiveSize (Join-Path $targetDir 'ic_launcher_foreground.png')
        Save-SolidBackground $adaptiveSize (Join-Path $targetDir 'ic_launcher_background.png')
    }

    Save-ResizedIcon $sourceImage 256 $webLogoPath
}
finally {
    $foregroundImage.Dispose()
    $sourceImage.Dispose()
}

Write-Output "Android launcher icons generated from $sourcePath"
