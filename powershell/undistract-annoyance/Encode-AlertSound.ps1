# Encode-AlertSound.ps1
# Encodes an MP3 file to a base64 string and copies it to the clipboard.
#
# Usage:  .\Encode-AlertSound.ps1 "C:\APPS\Scripts\assets\alarm.mp3"

param(
    [Parameter(Mandatory)]
    [string]$Path
)

if (-not (Test-Path $Path)) {
    Write-Host "File not found: $Path" -ForegroundColor Red
    exit 1
}

$bytes  = [IO.File]::ReadAllBytes($Path)
$base64 = [Convert]::ToBase64String($bytes)

$sizeKB = [math]::Round($bytes.Length / 1024, 1)
$b64KB  = [math]::Round($base64.Length / 1024, 1)

Write-Host "File   : $Path"
Write-Host "Size   : $sizeKB KB  ->  $b64KB KB base64"
Write-Host ""

Set-Clipboard -Value $base64
Write-Host "Base64 copied to clipboard." -ForegroundColor Green
Write-Host "Paste it between the quotes of `$AlertSoundBase64 in your script."
