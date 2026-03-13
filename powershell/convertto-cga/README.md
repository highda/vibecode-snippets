# Convert-ToCGA

Converts images to a retro CGA-style palette using ImageMagick. Supports both a GUI mode and CLI mode, with live preview and batch processing.

## Requirements

- `magick.exe` (ImageMagick) placed in the same folder as the script

## Usage

### GUI Mode

Run the script with no parameters. A file picker opens, then a settings dialog with live preview.

```powershell
.\Convert-ToCGA.ps1
```

In GUI mode you can select multiple files for batch conversion. Settings are applied to all files in the batch.

### CLI Mode

```powershell
.\Convert-ToCGA.ps1 -Input <path> -Output <path> [options]
```

### Help

```powershell
.\Convert-ToCGA.ps1 -Help
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `-Input` | string | — | Path to the source image (required in CLI mode) |
| `-Output` | string | — | Path for the output image (required in CLI mode) |
| `-Factor` | double | `0.5` | Downscale factor (0.01–1.0) |
| `-Palette` | string | `HighIntensity` | Color palette to use |
| `-DitherMethod` | string | `FloydSteinberg` | Dithering algorithm |
| `-Filter` | string | `Point` | Downscale filter (ignored when `-ProcessingPath` is `FirstRecolor`) |
| `-ProcessingPath` | string | `FirstDownscale` | Order of processing steps |

## Options

### Palettes

| Value | Colors |
|---|---|
| `LowIntensity` | Black, Cyan, Magenta, White (low intensity) |
| `HighIntensity` | Black, Bright Cyan, Bright Magenta, White |
| `RedCGA` | Black, Dark Red, Brown, White |
| `CGA16Color` | Full 16-color CGA palette |

### Dither Methods

`None`, `FloydSteinberg`, `Riemersma`, `Jarvis`, `Stucki`

### Filters

`Point`, `Bartlett`, `Blackman`, `Bohman`, `Box`, `Catrom`, `Cubic`, `Gaussian`, `Hamming`, `Hanning`, `Hermite`, `Jinc`, `Kaiser`, `Lagrange`, `Lanczos`, `LanczosSharp`, `Lanczos2`, `Lanczos2Sharp`, `Mitchell`, `Parzen`, `Quadratic`, `Robidoux`, `Sinc`, `SincFast`, `Triangle`, `Welsh`

### Processing Paths

| Value | Pipeline |
|---|---|
| `FirstDownscale` | Downscale → Recolor → Upscale |
| `FirstRecolor` | Recolor → Downscale → Upscale (always uses Point filter) |

## Examples

```powershell
# Convert with 25% scale and RedCGA palette
.\Convert-ToCGA.ps1 -Input image.png -Output converted.png -Factor 0.25 -Palette RedCGA

# Convert with Stucki dithering, recolor before downscaling
.\Convert-ToCGA.ps1 -Input photo.jpg -Output converted.png -DitherMethod Stucki -ProcessingPath FirstRecolor
```

## Output

- Single file mode: prompts for save path, opens the result when done
- Batch mode: prompts for an output folder, saves files as `<name>_cga.png`
