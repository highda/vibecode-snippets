[CmdletBinding()]
param(
    [switch]$Help,
    [string]$Input,
    [string]$Output,
    [double]$Factor = 0.5,
    [string]$Palette = "HighIntensity",
    [string]$DitherMethod = "FloydSteinberg",
    [string]$Filter = "Point",
    [string]$ProcessingPath = "FirstDownscale"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- Script-scoped variables for persistent temp files, debouncing timer, and UI state ---
$script:previewTempFile = $null
$script:previewPaletteFile = $null
$script:previewTimer = $null
$script:pendingUpdate = $false
$script:lastFilterValue = $Filter
$script:inputFiles = @() # New variable to store multiple file paths

# Define the full path to the magick.exe executable
$magickPath = Join-Path -Path $PSScriptRoot -ChildPath "magick.exe"

# Check for magick.exe
if (-not (Test-Path -Path $magickPath -PathType Leaf)) {
    Write-Warning "magick.exe not found. Displaying error message."
    [System.Windows.Forms.MessageBox]::Show("magick.exe was not found. Please ensure ImageMagick's 'magick.exe' is in the same folder as this script.","Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

function Show-Help {
    Write-Host "CGA Image Converter Script"
    Write-Host "--------------------------`n"
    Write-Host "This script converts an image to a CGA-style palette."
    Write-Host "It can be run with a graphical user interface (GUI) or from the command line (CLI).`n"
    Write-Host "Usage:`n"
    Write-Host "  GUI Mode (no parameters):`n"
    Write-Host "    $($PSCommandPath)`n"
    Write-Host "  CLI Mode (with parameters):`n"
    Write-Host "    $($PSCommandPath) -Input <path> -Output <path> [options]`n"
    Write-Host "  Help:`n"
    Write-Host "    $($PSCommandPath) -Help`n"
    Write-Host "Parameters:`n"
    Write-Host "  -Input <string>"
    Write-Host "    Path to the source image file (required in CLI mode)."
    Write-Host "  -Output <string>"
    Write-Host "    Path for the converted image file (required in CLI mode)."
    Write-Host "  -Factor <double>"
    Write-Host "    Downscale factor. Value is between 0.01 and 1.0 (default: 0.5)."
    Write-Host "  -Palette <string>"
    Write-Host "    The color palette to use (default: HighIntensity)."
    Write-Host "    Options: LowIntensity, HighIntensity, RedCGA, CGA16Color"
    Write-Host "  -DitherMethod <string>"
    Write-Host "    The dithering algorithm to use (default: FloydSteinberg)."
    Write-Host "    Options: None, FloydSteinberg, Riemersma, Jarvis, Stucki"
    Write-Host "  -Filter <string>"
    Write-Host "    The filter to use for downscaling (default: Point)."
    Write-Host "    Note: The filter is automatically set to 'Point' when ProcessingPath is 'FirstRecolor'."
    Write-Host "    Options: Point, Bartlett, Blackman, Bohman, Box, Catrom, Cubic, Gaussian, Hamming, Hanning, Hermite, Jinc, Kaiser, Lagrange, Lanczos, LanczosSharp, Lanczos2, Lanczos2Sharp, Mitchell, Parzen, Quadratic, Robidoux, Sinc, SincFast, Triangle, Welsh"
    Write-Host "  -ProcessingPath <string>"
    Write-Host "    The order of processing steps (default: FirstDownscale)."
    Write-Host "    Options: FirstDownscale (Downscale -> Recolor -> Upscale)"
    Write-Host "             FirstRecolor (Recolor -> Downscale -> Upscale)"
    Write-Host "`nExamples:`n"
    Write-Host "  $($PSCommandPath) -Input image.png -Output converted.png -Factor 0.25 -Palette RedCGA"
    Write-Host "  $($PSCommandPath) -Input photo.jpg -Output converted.png -DitherMethod Stucki -ProcessingPath FirstRecolor"
}

function Show-OptionsDialog {
    param(
        [ref]$Factor,
        [ref]$Palette,
        [ref]$DitherMethod,
        [ref]$Filter,
        [ref]$ProcessingPath,
        [string]$InputPath,
        [System.Drawing.Image]$InputImage
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "CGA Conversion Options"
    $form.Size = New-Object System.Drawing.Size(1200, 700)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    # Controls for the settings panel
    $pnlSettings = New-Object System.Windows.Forms.Panel
    $pnlSettings.Location = New-Object System.Drawing.Point(10, 10)
    $pnlSettings.Size = New-Object System.Drawing.Size(300, 650)
    $pnlSettings.BackColor = [System.Drawing.Color]::LightGray
    $form.Controls.Add($pnlSettings)

    # UI for batch mode
    $lblBatchMode = New-Object System.Windows.Forms.Label
    $lblBatchMode.Text = "Batch Mode"
    $lblBatchMode.Font = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)
    $lblBatchMode.Location = New-Object System.Drawing.Point(10, 10)
    $lblBatchMode.AutoSize = $true
    $lblBatchMode.ForeColor = [System.Drawing.Color]::DarkRed
    $pnlSettings.Controls.Add($lblBatchMode)
    $lblBatchMode.Visible = $false
    
    $lblIntro = New-Object System.Windows.Forms.Label
    $lblIntro.Text = "Select conversion parameters:"
    $lblIntro.Location = New-Object System.Drawing.Point(10, 40)
    $lblIntro.Size = New-Object System.Drawing.Size(280, 20)
    $pnlSettings.Controls.Add($lblIntro)

    # Resolution Slider (now for a factor)
    $lblFactor = New-Object System.Windows.Forms.Label
    $lblFactor.Text = "Downscale Factor: $($Factor.Value)x"
    $lblFactor.Location = New-Object System.Drawing.Point(10, 70)
    $lblFactor.Size = New-Object System.Drawing.Size(280, 20)
    $pnlSettings.Controls.Add($lblFactor)

    $trkFactor = New-Object System.Windows.Forms.TrackBar
    $trkFactor.Location = New-Object System.Drawing.Point(10, 90)
    $trkFactor.Size = New-Object System.Drawing.Size(280, 45)
    $trkFactor.Minimum = 1
    $trkFactor.Maximum = 100
    $trkFactor.Value = [math]::Round($Factor.Value * 100)
    $pnlSettings.Controls.Add($trkFactor)
    
    # Filter Dropdown
    $lblFilter = New-Object System.Windows.Forms.Label
    $lblFilter.Text = "Downscale Filter:"
    $lblFilter.Location = New-Object System.Drawing.Point(10, 140)
    $lblFilter.Size = New-Object System.Drawing.Size(100, 20)
    $pnlSettings.Controls.Add($lblFilter)
    
    $cmbFilter = New-Object System.Windows.Forms.ComboBox
    $cmbFilter.Location = New-Object System.Drawing.Point(120, 140)
    $cmbFilter.Size = New-Object System.Drawing.Size(120, 20)
    $cmbFilter.Items.AddRange(@(
        "Point", "Bartlett", "Blackman", "Bohman", "Box", "Catrom", "Cubic",
        "Gaussian", "Hamming", "Hanning", "Hermite", "Jinc", "Kaiser",
        "Lagrange", "Lanczos", "LanczosSharp", "Lanczos2",
        "Lanczos2Sharp", "Mitchell", "Parzen", "Quadratic",
        "Robidoux", "Sinc", "SincFast", "Triangle", "Welsh"
    ))
    $cmbFilter.SelectedItem = $Filter.Value
    $pnlSettings.Controls.Add($cmbFilter)

    # Palette Dropdown
    $lblPalette = New-Object System.Windows.Forms.Label
    $lblPalette.Text = "Palette:"
    $lblPalette.Location = New-Object System.Drawing.Point(10, 170)
    $lblPalette.Size = New-Object System.Drawing.Size(100, 20)
    $pnlSettings.Controls.Add($lblPalette)

    $cmbPalette = New-Object System.Windows.Forms.ComboBox
    $cmbPalette.Location = New-Object System.Drawing.Point(120, 170)
    $cmbPalette.Size = New-Object System.Drawing.Size(100, 20)
    $cmbPalette.Items.AddRange(@("LowIntensity", "HighIntensity","RedCGA","CGA16Color"))
    $cmbPalette.SelectedItem = $Palette.Value
    $pnlSettings.Controls.Add($cmbPalette)

    # Dithering Dropdown
    $lblDither = New-Object System.Windows.Forms.Label
    $lblDither.Text = "Dithering:"
    $lblDither.Location = New-Object System.Drawing.Point(10, 200)
    $lblDither.Size = New-Object System.Drawing.Size(100, 20)
    $pnlSettings.Controls.Add($lblDither)

    $cmbDither = New-Object System.Windows.Forms.ComboBox
    $cmbDither.Location = New-Object System.Drawing.Point(120, 200)
    $cmbDither.Size = New-Object System.Drawing.Size(120, 20)
    $cmbDither.Items.AddRange(@("None", "FloydSteinberg", "Riemersma", "Jarvis", "Stucki"))
    $cmbDither.SelectedItem = $DitherMethod.Value
    $pnlSettings.Controls.Add($cmbDither)

    # Processing Path Radio Buttons
    $pnlPath = New-Object System.Windows.Forms.GroupBox
    $pnlPath.Text = "Processing Path"
    $pnlPath.Location = New-Object System.Drawing.Point(10, 230)
    $pnlPath.Size = New-Object System.Drawing.Size(280, 60)
    $pnlSettings.Controls.Add($pnlPath)
    
    $rbDownscaleFirst = New-Object System.Windows.Forms.RadioButton
    $rbDownscaleFirst.Text = "First downscale"
    $rbDownscaleFirst.Location = New-Object System.Drawing.Point(10, 20)
    $pnlPath.Controls.Add($rbDownscaleFirst)
    
    $rbRecolorFirst = New-Object System.Windows.Forms.RadioButton
    $rbRecolorFirst.Text = "First recolor"
    $rbRecolorFirst.Location = New-Object System.Drawing.Point(130, 20)
    $pnlPath.Controls.Add($rbRecolorFirst)
    
    if ($ProcessingPath.Value -eq "FirstDownscale") {
        $rbDownscaleFirst.Checked = $true
    } else {
        $rbRecolorFirst.Checked = $true
    }

    # Action Buttons
    $btnSave = New-Object System.Windows.Forms.Button
    $btnSave.Text = "Save Image"
    $btnSave.Location = New-Object System.Drawing.Point(10, 300)
    $btnSave.Size = New-Object System.Drawing.Size(130, 30)
    $btnSave.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
    $pnlSettings.Controls.Add($btnSave)

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = "Cancel"
    $btnCancel.Location = New-Object System.Drawing.Point(150, 300)
    $btnCancel.Size = New-Object System.Drawing.Size(130, 30)
    $btnCancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
    $pnlSettings.Controls.Add($btnCancel)
    
    # Preview Image Box
    $picPreview = New-Object System.Windows.Forms.PictureBox
    $picPreview.Location = New-Object System.Drawing.Point(320, 10)
    $picPreview.Size = New-Object System.Drawing.Size(860, 650)
    $picPreview.SizeMode = "Zoom"
    $picPreview.BorderStyle = "FixedSingle"
    $form.Controls.Add($picPreview)

    function Update-Preview {
        param (
            [string]$inputImagePath,
            [double]$factor,
            [string]$filter,
            [string]$palette,
            [string]$ditherMethod,
            [string]$processingPath
        )
        try {
            if ([string]::IsNullOrEmpty($inputImagePath)) { return }
            if (-not (Test-Path $inputImagePath)) { return }
            
            Convert-Image -InputPath $inputImagePath -OutputPath $script:previewTempFile -Factor $factor -Palette $palette -DitherMethod $ditherMethod -Filter $filter -ProcessingPath $processingPath -Silent

            if (Test-Path $script:previewTempFile) {
                if ($picPreview.Image -ne $null) { $picPreview.Image.Dispose() }
                
                $stream = [System.IO.FileStream]::new($script:previewTempFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
                $sourceBitmap = [System.Drawing.Bitmap]::new($stream)
                $stream.Close()

                $scaledBitmap = New-Object System.Drawing.Bitmap($picPreview.Width, $picPreview.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($scaledBitmap)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

                $picWidth = $picPreview.Width
                $picHeight = $picPreview.Height
                $imgWidth = $sourceBitmap.Width
                $imgHeight = $sourceBitmap.Height

                $scaleX = $picWidth / $imgWidth
                $scaleY = $picHeight / $imgHeight
                $scale = [math]::Min($scaleX, $scaleY)

                $destWidth = [math]::Round($imgWidth * $scale)
                $destHeight = [math]::Round($imgHeight * $scale)
                $destX = ($picWidth - $destWidth) / 2
                $destY = ($picHeight - $destHeight) / 2
                
                $graphics.DrawImage($sourceBitmap, $destX, $destY, $destWidth, $destHeight)

                $picPreview.Image = $scaledBitmap
                
                $sourceBitmap.Dispose()
                $graphics.Dispose()
            } else {
                Write-Error "Temporary output file not found. Conversion might have failed."
            }
        }
        catch {
            Write-Error "Error in Update-Preview: $($_.Exception.Message)"
        }
    }

    # Debounce Timer for the slider
    $script:previewTimer = New-Object System.Windows.Forms.Timer
    $script:previewTimer.Interval = 250 # milliseconds
    $script:previewTimer.Add_Tick({
        $script:previewTimer.Stop()
        if ($script:pendingUpdate) {
            $script:pendingUpdate = $false
            $currentFactor = $trkFactor.Value / 100.0
            $currentPath = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
            $currentFilter = $cmbFilter.SelectedItem
            if ($currentPath -eq "FirstRecolor") {
                $currentFilter = "Point"
            }
            Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $currentFilter -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath $currentPath
        }
    })

    # Event handlers
    $trkFactor.Add_ValueChanged({
        $Factor.Value = $trkFactor.Value / 100.0
        $lblFactor.Text = "Downscale Factor: $($Factor.Value)x"
        $script:pendingUpdate = $true
        $script:previewTimer.Stop()
        $script:previewTimer.Start()
    })
    
    $cmbFilter.Add_SelectedValueChanged({
        $Filter.Value = $cmbFilter.SelectedItem
        $currentFactor = $trkFactor.Value / 100.0
        $currentPath = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $cmbFilter.SelectedItem -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath $currentPath
    })
    
    $cmbPalette.Add_SelectedValueChanged({
        $Palette.Value = $cmbPalette.SelectedItem
        $currentFactor = $trkFactor.Value / 100.0
        $currentPath = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
        $currentFilter = $cmbFilter.SelectedItem
        if ($currentPath -eq "FirstRecolor") {
            $currentFilter = "Point"
        }
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $currentFilter -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath $currentPath
    })
    
    $cmbDither.Add_SelectedValueChanged({
        $DitherMethod.Value = $cmbDither.SelectedItem
        $currentFactor = $trkFactor.Value / 100.0
        $currentPath = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
        $currentFilter = $cmbFilter.SelectedItem
        if ($currentPath -eq "FirstRecolor") {
            $currentFilter = "Point"
        }
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $currentFilter -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath $currentPath
    })
    
    $rbDownscaleFirst.Add_CheckedChanged({
        $ProcessingPath.Value = "FirstDownscale"
        $cmbFilter.Enabled = $true
        if ($script:lastFilterValue -ne $null) {
            $cmbFilter.SelectedItem = $script:lastFilterValue
        }
        $currentFactor = $trkFactor.Value / 100.0
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $cmbFilter.SelectedItem -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath "FirstDownscale"
    })
    
    $rbRecolorFirst.Add_CheckedChanged({
        $ProcessingPath.Value = "FirstRecolor"
        $script:lastFilterValue = $cmbFilter.SelectedItem
        $cmbFilter.Enabled = $false
        $cmbFilter.SelectedItem = "Point"
        $currentFactor = $trkFactor.Value / 100.0
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter "Point" -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath "FirstRecolor"
    })

    # Initial UI state setup
    if ($ProcessingPath.Value -eq "FirstRecolor") {
        $cmbFilter.Enabled = $false
        $cmbFilter.SelectedItem = "Point"
    }

    # If in batch mode, update UI elements
    if ($script:inputFiles.Count -gt 1) {
        $lblBatchMode.Visible = $true
        $lblIntro.Location = New-Object System.Drawing.Point(10, 40)
        $lblFactor.Location = New-Object System.Drawing.Point(10, 70)
        $trkFactor.Location = New-Object System.Drawing.Point(10, 90)
        $lblFilter.Location = New-Object System.Drawing.Point(10, 140)
        $cmbFilter.Location = New-Object System.Drawing.Point(120, 140)
        $lblPalette.Location = New-Object System.Drawing.Point(10, 170)
        $cmbPalette.Location = New-Object System.Drawing.Point(120, 170)
        $lblDither.Location = New-Object System.Drawing.Point(10, 200)
        $cmbDither.Location = New-Object System.Drawing.Point(120, 200)
        $pnlPath.Location = New-Object System.Drawing.Point(10, 230)
        $btnSave.Text = "Save Batch"
    }

    # Initial preview update when form is shown
    $form.Add_Shown({ 
        $currentFactor = $trkFactor.Value / 100.0
        $currentPath = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
        $currentFilter = $cmbFilter.SelectedItem
        if ($currentPath -eq "FirstRecolor") {
            $currentFilter = "Point"
        }
        Update-Preview -inputImagePath $InputPath -factor $currentFactor -filter $currentFilter -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem -processingPath $currentPath
    })

    # Show the dialog and return result
    $result = $form.ShowDialog()
    
    # Dispose of the image and timer
    if ($picPreview.Image -ne $null) { $picPreview.Image.Dispose() }
    if ($script:previewTimer -ne $null) { $script:previewTimer.Dispose() }
    
    $form.Dispose()
    
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        $Factor.Value = $trkFactor.Value / 100.0
        $Palette.Value = $cmbPalette.SelectedItem
        $DitherMethod.Value = $cmbDither.SelectedItem
        $ProcessingPath.Value = if ($rbDownscaleFirst.Checked) { "FirstDownscale" } else { "FirstRecolor" }
        $Filter.Value = if ($ProcessingPath.Value -eq "FirstRecolor") { "Point" } else { $cmbFilter.SelectedItem }
        return $true
    } else {
        return $false
    }
}

function Convert-Image {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [double]$Factor,
        [string]$Palette,
        [string]$DitherMethod,
        [string]$Filter,
        [string]$ProcessingPath,
        [switch]$Silent
    )
    
    try {
        if ($null -eq $script:previewPaletteFile) {
            $script:previewPaletteFile = [System.IO.Path]::GetTempFileName() + ".txt"
        }
        
$paletteContent = switch ($Palette) {
    "LowIntensity"  {
@"
# ImageMagick pixel enumeration: 4,1,255,srgb
0,0: (0,0,0)      #000000
1,0: (0,170,170)  #00AAAA
2,0: (170,68,170) #AA44AA
3,0: (255,255,255)#FFFFFF
"@
    }
    "HighIntensity" {
@"
# ImageMagick pixel enumeration: 4,1,255,srgb
0,0: (0,0,0)      #000000
1,0: (85,255,255) #55FFFF
2,0: (255,85,255) #FF55FF
3,0: (255,255,255)#FFFFFF
"@
    }
    "RedCGA" {
@"
# ImageMagick pixel enumeration: 4,1,255,srgb
0,0: (0,0,0)      #000000
1,0: (170,0,0)    #AA0000
2,0: (170,85,0)   #AA5500
3,0: (255,255,255)#FFFFFF
"@
    }
    "CGA16Color" {
@"
# ImageMagick pixel enumeration: 16,1,255,srgb
0,0:  (0,0,0)       #000000
1,0:  (0,0,170)     #0000AA
2,0:  (0,170,0)     #00AA00
3,0:  (0,170,170)   #00AAAA
4,0:  (170,0,0)     #AA0000
5,0:  (170,0,170)   #AA00AA
6,0:  (170,85,0)    #AA5500
7,0:  (170,170,170) #AAAAAA
8,0:  (85,85,85)    #555555
9,0:  (85,85,255)   #5555FF
10,0: (85,255,85)   #55FF55
11,0: (85,255,255)  #55FFFF
12,0: (255,85,85)   #FF5555
13,0: (255,85,255)  #FF55FF
14,0: (255,255,85)  #FFFF55
15,0: (255,255,255) #FFFFFF
"@
    }
    default {
@"
# ImageMagick pixel enumeration: 4,1,255,srgb
0,0: (0,0,0)      #000000
1,0: (85,255,255) #55FFFF
2,0: (255,85,255) #FF55FF
3,0: (255,255,255)#FFFFFF
"@
    }
}
        Set-Content -Path $script:previewPaletteFile -Value $paletteContent -Encoding ASCII
        
        $imgInfo = & $magickPath identify -format "%w %h" "$InputPath" 2>&1
        $tokens = $imgInfo -split ' '

        $origWidth = 0
        $origHeight = 0
        
        if ($tokens.Count -lt 2 -or -not ([int]::TryParse($tokens[0], [ref]$origWidth)) -or -not ([int]::TryParse($tokens[1], [ref]$origHeight))) {
            $errorMsg = "Failed to get image dimensions. The file may be invalid or ImageMagick failed to read it. Output: $imgInfo"
            Write-Error $errorMsg
            if (-not $Silent) { throw $errorMsg }
            return
        }

        $newWidth = [math]::Ceiling($origWidth * $Factor)
        $newHeight = [math]::Ceiling($origHeight * $Factor)
        
        if ($newWidth -lt 1) { $newWidth = 1 }
        if ($newHeight -lt 1) { $newHeight = 1 }

        $magickArgs = @()
        
        switch ($ProcessingPath) {
            "FirstRecolor" {
                $magickArgs += "$InputPath"
                
                # First, recolor and dither at the original resolution
                $magickArgs += "-remap"
                $magickArgs += "$script:previewPaletteFile"
                if ($DitherMethod -ne "None") {
                    $magickArgs += "-dither"
                    $magickArgs += $DitherMethod
                }
                $magickArgs += "-colors"
                $magickArgs += "4"
                
                # Then, downscale and upscale using ONLY the Point filter
                $magickArgs += "-filter"
                $magickArgs += "Point"
                $magickArgs += "-resize"
                $magickArgs += "${newWidth}x${newHeight}!"
                
                $magickArgs += "-filter"
                $magickArgs += "Point"
                $magickArgs += "-resize"
                $magickArgs += "${origWidth}x${origHeight}!"
                $magickArgs += "$OutputPath"
            }
            "FirstDownscale" {
                # This is the original pipeline
                $magickArgs += "$InputPath"
                
                # 1. Downscale first
                $magickArgs += "-filter"
                $magickArgs += "$Filter"
                $magickArgs += "-resize"
                $magickArgs += "${newWidth}x${newHeight}!"
                
                # 2. Map colors and dither
                $magickArgs += "-remap"
                $magickArgs += "$script:previewPaletteFile"
                if ($DitherMethod -ne "None") {
                    $magickArgs += "-dither"
                    $magickArgs += $DitherMethod
                }
                $magickArgs += "-colors"
                $magickArgs += "4"
                
                # 3. Upscale to the original dimensions with Point filter
                $magickArgs += "-filter"
                $magickArgs += "Point"
                $magickArgs += "-resize"
                $magickArgs += "${origWidth}x${origHeight}!"
                $magickArgs += "$OutputPath"
            }
            default {
                throw "Invalid Processing Path specified."
            }
        }
        
        $magickOutput = & $magickPath $magickArgs 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            $errorMsg = "ImageMagick conversion failed with exit code $LASTEXITCODE. Output: $magickOutput"
            Write-Error $errorMsg
            if (-not $Silent) { throw $errorMsg }
        }
    }
    catch {
        Write-Error "Exception in Convert-Image: $($_.Exception.Message)"
        if (-not $Silent) { throw }
    }
}

# Moved the temp file initialization outside the main try block
$script:previewTempFile = [System.IO.Path]::GetTempFileName() + ".png"
$script:previewPaletteFile = [System.IO.Path]::GetTempFileName() + ".txt"

try {
    if ($Help) {
        Show-Help
        exit
    }
    
    # Input validation for CLI mode
    if ($PSCmdlet.MyInvocation.BoundParameters.ContainsKey('Input')) {
        if (-not $PSCmdlet.MyInvocation.BoundParameters.ContainsKey('Output')) {
            throw "The -Output parameter is required in command-line mode."
        }
        if (-not (Test-Path $Input)) {
            throw "Input file does not exist: $Input"
        }
        if ($Factor -le 0) {
            throw "The -Factor must be a positive number."
        }
        
        $finalFilter = $Filter
        if ($ProcessingPath -eq "FirstRecolor") {
            $finalFilter = "Point"
        }

        $InputPath = (Resolve-Path $Input).Path
        $OutputPath = $Output
        
        Convert-Image -InputPath $InputPath -OutputPath $OutputPath -Factor $Factor -Palette $Palette -DitherMethod $DitherMethod -Filter $finalFilter -ProcessingPath $ProcessingPath
        
    } else {
        # GUI Mode
        $ofd = New-Object System.Windows.Forms.OpenFileDialog
        $ofd.Filter = "Image Files|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tiff"
        $ofd.Title = "Select Input Image(s)"
        $ofd.Multiselect = $true # Allow multiple file selection
        if ($ofd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
        
        $script:inputFiles = $ofd.FileNames | ForEach-Object { (Resolve-Path $_).Path }
        $InputPath = $script:inputFiles[0] # Use the first file for preview

        try {
            $InputImage = [System.Drawing.Image]::FromFile($InputPath)
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show("Failed to load the selected image file.","Error",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
            exit
        }

        $f = [ref]$Factor
        $p = [ref]$Palette
        $d = [ref]$DitherMethod
        $l = [ref]$Filter
        $t = [ref]$ProcessingPath
        
        if (-not (Show-OptionsDialog -Factor $f -Palette $p -DitherMethod $d -Filter $l -ProcessingPath $t -InputPath $InputPath -InputImage $InputImage)) { 
            $InputImage.Dispose()
            exit 
        }
        
        $Factor = $f.Value
        $Palette = $p.Value
        $DitherMethod = $d.Value
        $Filter = $l.Value
        $ProcessingPath = $t.Value
        
        $InputImage.Dispose()

        if ($script:inputFiles.Count -gt 1) {
            # Batch Mode
            $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
            $fbd.Description = "Select a folder to save converted images."
            if ($fbd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }

            $OutputPath = $fbd.SelectedPath
            
            $i = 1
            foreach ($file in $script:inputFiles) {
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file)
                $ext = [System.IO.Path]::GetExtension($file)
                $outputFile = Join-Path -Path $OutputPath -ChildPath "$baseName`_cga.png"

                Write-Host "Converting file $i of $($script:inputFiles.Count): $file"
                Convert-Image -InputPath $file -OutputPath $outputFile -Factor $Factor -Palette $Palette -DitherMethod $DitherMethod -Filter $Filter -ProcessingPath $ProcessingPath
                $i++
            }
            [System.Windows.Forms.MessageBox]::Show("Batch conversion complete!","Done",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information)
            Start-Process "$OutputPath"
            
        } else {
            # Single File Mode
            $sfd = New-Object System.Windows.Forms.SaveFileDialog
            $sfd.Filter = "PNG Image|*.png"
            $sfd.Title = "Save Output Image"
            $sfd.FileName = [System.IO.Path]::GetFileNameWithoutExtension($InputPath) + "_cga.png"
            if ($sfd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
            $OutputPath = $sfd.FileName
            
            Convert-Image -InputPath $InputPath -OutputPath $OutputPath -Factor $Factor -Palette $Palette -DitherMethod $DitherMethod -Filter $Filter -ProcessingPath $ProcessingPath
            
            [System.Windows.Forms.MessageBox]::Show("Conversion successful!","Done",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information)
            Start-Process "$OutputPath"
        }
    }

} catch {
    Write-Error "Caught an exception: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show("Error during conversion: $($_.Exception.Message)","Error",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
} finally {
    if (Test-Path $script:previewTempFile -ErrorAction SilentlyContinue) { Remove-Item $script:previewTempFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $script:previewPaletteFile -ErrorAction SilentlyContinue) { Remove-Item $script:previewPaletteFile -Force -ErrorAction SilentlyContinue }
}