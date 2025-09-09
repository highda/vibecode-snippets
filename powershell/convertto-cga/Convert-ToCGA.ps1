[CmdletBinding()]
param(
    [string]$Input,
    [string]$Output,
    [int]$Width = 64,
    [string]$Palette = "HighIntensity",
    [string]$DitherMethod = "FloydSteinberg"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- Script-scoped variables for persistent temp files and debouncing timer ---
$script:previewTempFile = $null
$script:previewPaletteFile = $null
$script:previewTimer = $null
$script:pendingUpdate = $false

# Define the full path to the magick.exe executable
$magickPath = Join-Path -Path $PSScriptRoot -ChildPath "magick.exe"

# Check for magick.exe
if (-not (Test-Path -Path $magickPath -PathType Leaf)) {
    Write-Warning "magick.exe not found. Displaying error message."
    [System.Windows.Forms.MessageBox]::Show("magick.exe was not found. Please ensure ImageMagick's 'magick.exe' is in the same folder as this script.","Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

function Show-OptionsDialog {
    param(
        [ref]$Width,
        [ref]$Palette,
        [ref]$DitherMethod,
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

    $lblIntro = New-Object System.Windows.Forms.Label
    $lblIntro.Text = "Select conversion parameters:"
    $lblIntro.Location = New-Object System.Drawing.Point(10, 10)
    $lblIntro.Size = New-Object System.Drawing.Size(280, 20)
    $pnlSettings.Controls.Add($lblIntro)

    # Resolution Slider
    $lblWidth = New-Object System.Windows.Forms.Label
    $lblWidth.Text = "Resolution: $($Width.Value) px"
    $lblWidth.Location = New-Object System.Drawing.Point(10, 40)
    $lblWidth.Size = New-Object System.Drawing.Size(280, 20)
    $pnlSettings.Controls.Add($lblWidth)

    $trkWidth = New-Object System.Windows.Forms.TrackBar
    $trkWidth.Location = New-Object System.Drawing.Point(10, 60)
    $trkWidth.Size = New-Object System.Drawing.Size(280, 45)
    $trkWidth.Minimum = 64
    $trkWidth.Maximum = $InputImage.Width
    $trkWidth.Value = $Width.Value
    $trkWidth.TickFrequency = 160
    $pnlSettings.Controls.Add($trkWidth)

    # Palette Dropdown
    $lblPalette = New-Object System.Windows.Forms.Label
    $lblPalette.Text = "Palette:"
    $lblPalette.Location = New-Object System.Drawing.Point(10, 110)
    $lblPalette.Size = New-Object System.Drawing.Size(100, 20)
    $pnlSettings.Controls.Add($lblPalette)

    $cmbPalette = New-Object System.Windows.Forms.ComboBox
    $cmbPalette.Location = New-Object System.Drawing.Point(120, 110)
    $cmbPalette.Size = New-Object System.Drawing.Size(100, 20)
    $cmbPalette.Items.AddRange(@("LowIntensity", "HighIntensity","RedCGA","CGA16Color"))
    $cmbPalette.SelectedItem = $Palette.Value
    $pnlSettings.Controls.Add($cmbPalette)

    # Dithering Dropdown
    $lblDither = New-Object System.Windows.Forms.Label
    $lblDither.Text = "Dithering:"
    $lblDither.Location = New-Object System.Drawing.Point(10, 140)
    $lblDither.Size = New-Object System.Drawing.Size(100, 20)
    $pnlSettings.Controls.Add($lblDither)

    $cmbDither = New-Object System.Windows.Forms.ComboBox
    $cmbDither.Location = New-Object System.Drawing.Point(120, 140)
    $cmbDither.Size = New-Object System.Drawing.Size(120, 20)
    $cmbDither.Items.AddRange(@("None", "FloydSteinberg", "Riemersma"))
    $cmbDither.SelectedItem = $DitherMethod.Value
    $pnlSettings.Controls.Add($cmbDither)

    # Preview Image Box
    $picPreview = New-Object System.Windows.Forms.PictureBox
    $picPreview.Location = New-Object System.Drawing.Point(320, 10)
    $picPreview.Size = New-Object System.Drawing.Size(860, 650)
    $picPreview.SizeMode = "Zoom"
    $picPreview.BorderStyle = "FixedSingle"
    $form.Controls.Add($picPreview)

    # Function to update the preview (defined inside the dialog scope)
 function Update-Preview {
    param (
        [string]$inputImagePath,
        [int]$width,
        [string]$palette,
        [string]$ditherMethod
    )
    try {
        if ([string]::IsNullOrEmpty($inputImagePath)) {
            Write-Error "Input image path is null or empty. Cannot update preview."
            return
        }

        if (-not (Test-Path $inputImagePath)) {
            Write-Error "Input image path does not exist: $inputImagePath"
            return
        }

        # Use the single, persistent temp file
        Convert-Image -InputPath $inputImagePath -OutputPath $script:previewTempFile -Width $width -Palette $palette -DitherMethod $ditherMethod -Silent

        if (Test-Path $script:previewTempFile) {
            # Dispose of previous image and graphic objects
            if ($picPreview.Image -ne $null) {
                $picPreview.Image.Dispose()
                $picPreview.Image = $null
            }

            # Load image from file stream to avoid locking
            $stream = [System.IO.FileStream]::new($script:previewTempFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
            $sourceBitmap = [System.Drawing.Bitmap]::new($stream)
            $stream.Close()

            # Create a new Bitmap to hold the pixelated preview
            $scaledBitmap = New-Object System.Drawing.Bitmap($picPreview.Width, $picPreview.Height)
            $graphics = [System.Drawing.Graphics]::FromImage($scaledBitmap)

            # Set the interpolation mode to NearestNeighbor for pixelated scaling
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            # Set the pixel offset mode for high-quality, non-smoothed rendering
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

            # Calculate the destination rectangle to maintain aspect ratio without smoothing
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
            
            # Draw the image with pixelated scaling
            $graphics.DrawImage($sourceBitmap, $destX, $destY, $destWidth, $destHeight)

            $picPreview.Image = $scaledBitmap
            
            # Dispose of the source bitmap and graphics object
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
            Update-Preview -inputImagePath $InputPath -width $trkWidth.Value -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem
        }
    })

    # Event handlers with proper variable access
    $trkWidth.Add_ValueChanged({
        $Width.Value = $trkWidth.Value
        $lblWidth.Text = "Resolution: $($Width.Value) px"
        $script:pendingUpdate = $true
        $script:previewTimer.Stop()
        $script:previewTimer.Start()
    })

    $cmbPalette.Add_SelectedValueChanged({
        $Palette.Value = $cmbPalette.SelectedItem
        Update-Preview -inputImagePath $InputPath -width $trkWidth.Value -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem
    })
    
    $cmbDither.Add_SelectedValueChanged({
        $DitherMethod.Value = $cmbDither.SelectedItem
        Update-Preview -inputImagePath $InputPath -width $trkWidth.Value -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem
    })

    # Action Buttons
    $btnSave = New-Object System.Windows.Forms.Button
    $btnSave.Text = "Save Image"
    $btnSave.Location = New-Object System.Drawing.Point(10, 180)
    $btnSave.Size = New-Object System.Drawing.Size(130, 30)
    $btnSave.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
    $pnlSettings.Controls.Add($btnSave)

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = "Cancel"
    $btnCancel.Location = New-Object System.Drawing.Point(150, 180)
    $btnCancel.Size = New-Object System.Drawing.Size(130, 30)
    $btnCancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
    $pnlSettings.Controls.Add($btnCancel)
    
    # Initial preview update when form is shown
    $form.Add_Shown({ 
        Update-Preview -inputImagePath $InputPath -width $trkWidth.Value -palette $cmbPalette.SelectedItem -ditherMethod $cmbDither.SelectedItem
    })

    # Show the dialog and return result
    $result = $form.ShowDialog()
    
    # Dispose of the image in the picture box and the timer
    if ($picPreview.Image -ne $null) {
        $picPreview.Image.Dispose()
    }
    if ($script:previewTimer -ne $null) {
        $script:previewTimer.Dispose()
    }
    
    $form.Dispose()
    
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        $Width.Value = $trkWidth.Value
        $Palette.Value = $cmbPalette.SelectedItem
        $DitherMethod.Value = $cmbDither.SelectedItem
        return $true
    } else {
        return $false
    }
}

function Convert-Image {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [int]$Width,
        [string]$Palette,
        [string]$DitherMethod,
        [switch]$Silent
    )
    
    try {
        # Check if the persistent palette file exists, if not, create it
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
            if (-not $Silent) {
                throw $errorMsg
            }
            return
        }

        $newHeight = [math]::Round($origHeight * ($Width / $origWidth))

        # Build the magick arguments incrementally
        $magickArgs = @()
        $magickArgs += "$InputPath"
        $magickArgs += "-resize"
        $magickArgs += "${Width}x${newHeight}!"
        $magickArgs += "-remap"
        $magickArgs += "$script:previewPaletteFile"
        if ($DitherMethod -ne "None") {
            $magickArgs += "-dither"
            $magickArgs += $DitherMethod
        }
        $magickArgs += "-colors"
        $magickArgs += "4"
        $magickArgs += "$OutputPath"
        
        $magickOutput = & $magickPath $magickArgs 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            $errorMsg = "ImageMagick conversion failed with exit code $LASTEXITCODE. Output: $magickOutput"
            Write-Error $errorMsg
            if (-not $Silent) {
                throw $errorMsg
            }
        }
    }
    catch {
        Write-Error "Exception in Convert-Image: $($_.Exception.Message)"
        if (-not $Silent) {
            throw
        }
    }
}

try {
    
    # Initialize persistent temp file path outside the function
    $script:previewTempFile = [System.IO.Path]::GetTempFileName() + ".png"

    # Check if the 'Input' parameter was not provided on the command line
    if (-not $PSCmdlet.MyInvocation.BoundParameters.ContainsKey('Input')) {
        # GUI Mode
        $ofd = New-Object System.Windows.Forms.OpenFileDialog
        $ofd.Filter = "Image Files|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tiff"
        $ofd.Title = "Select Input Image"
        if ($ofd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { 
            exit 
        }
        
        $InputPath = (Resolve-Path $ofd.FileName).Path
        
        try {
            $InputImage = [System.Drawing.Image]::FromFile($InputPath)
        }
        catch {
            Write-Error "Failed to load input image: $($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show("Failed to load the selected image file.","Error",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
            exit
        }

        $w = [ref]$Width
        $p = [ref]$Palette
        $d = [ref]$DitherMethod
        
        if (-not (Show-OptionsDialog -Width $w -Palette $p -DitherMethod $d -InputPath $InputPath -InputImage $InputImage)) { 
            $InputImage.Dispose()
            exit 
        }
        
        $Width = $w.Value
        $Palette = $p.Value
        $DitherMethod = $d.Value
        
        $sfd = New-Object System.Windows.Forms.SaveFileDialog
        $sfd.Filter = "PNG Image|*.png"
        $sfd.Title = "Save Output Image"
        $sfd.FileName = [System.IO.Path]::GetFileNameWithoutExtension($InputPath) + "_cga.png"
        if ($sfd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { 
            $InputImage.Dispose()
            exit 
        }
        $OutputPath = $sfd.FileName
        
        # Dispose of the input image as we're done with it
        $InputImage.Dispose()
        
        # Final conversion for saving
        Convert-Image -InputPath $InputPath -OutputPath $OutputPath -Width $Width -Palette $Palette -DitherMethod $DitherMethod
        
        [System.Windows.Forms.MessageBox]::Show("Conversion successful!","Done",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information)
        Start-Process "$OutputPath"
        
    } else {
        # Command-Line Mode
        if (-not $Output) {
            Write-Error "The -Output parameter is required in command-line mode."
            throw "The -Output parameter is required when running in command-line mode."
        }
        
        if (-not (Test-Path $Input)) {
            Write-Error "Input file does not exist: $Input"
            throw "Input file does not exist: $Input"
        }
        
        $InputPath = (Resolve-Path $Input).Path
        $OutputPath = $Output
        
        # Perform command-line conversion
        Convert-Image -InputPath $InputPath -OutputPath $OutputPath -Width $Width -Palette $Palette -DitherMethod $DitherMethod
    }

} catch {
    Write-Error "Caught an exception: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show("Error during conversion: $($_.Exception.Message)","Error",[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
} finally {
    # Final cleanup of all persistent temporary files
    if (Test-Path $script:previewTempFile -ErrorAction SilentlyContinue) {
        Remove-Item $script:previewTempFile -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $script:previewPaletteFile -ErrorAction SilentlyContinue) {
        Remove-Item $script:previewPaletteFile -Force -ErrorAction SilentlyContinue
    }
}