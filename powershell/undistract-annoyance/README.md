# Watch-DistractingWindows

A PowerShell script that monitors the active window title and punishes you when it matches a list of distracting sites. When triggered, it:

1. **Minimizes** the offending window instantly
2. **Flings your cursor** to the bottom-right corner of the screen
3. **Shows a toast notification** identifying the distraction
4. **Plays an alarm sound**

A per-keyword cooldown prevents repeated triggers, and a separate global grace period keeps the minimize + cursor hijack from firing back-to-back while you're closing the window.

## How it works

The script polls the foreground window title every second using the Win32 API (`GetForegroundWindow` + `GetWindowText`) and matches it case-insensitively against a keyword list. No external dependencies — just native Windows APIs called via P/Invoke.

## Setup

### 1. Configure keywords

Edit the `$Keywords` array at the top of `Watch-DistractingWindows.ps1`:

```powershell
$Keywords = @(
    "messenger",
    "instagram",
    "facebook",
    "youtube",
    "reddit",
    ...
)
```

These are matched as substrings against the window title, so `"facebook"` will catch any browser tab with Facebook in the title.

### 2. Embed the alert sound

The alarm MP3 is stored inline as base64 at the end of the script — no external file dependency. To encode your sound:

```powershell
.\Encode-AlertSound.ps1 "C:\path\to\alarm.mp3"
```

This copies the base64 string to your clipboard. Then open `Watch-DistractingWindows.ps1` and paste it between the marker lines at the bottom:

```
#BEGIN_SOUND_BASE64
PASTE_BASE64_HERE
#END_SOUND_BASE64
```

At startup, the script reads its own source file and decodes the sound to `%TEMP%\distraction_alert.mp3`.

### 3. Run

```powershell
.\Watch-DistractingWindows.ps1
```

Stop with `Ctrl+C`.

## Configuration reference

| Variable               | Default | Description                                        |
|------------------------|---------|----------------------------------------------------|
| `$Keywords`            | —       | Window title substrings that trigger the alert      |
| `$PollIntervalSeconds` | `1`     | How often the active window is checked              |
| `$CooldownSeconds`     | `20`    | Per-keyword cooldown before the same keyword re-fires |
| `$HijackGraceSeconds`  | `10`    | Global cooldown for minimize + cursor hijack        |
| `$AlertSoundRepeats`   | `1`     | How many times the alarm sound plays per trigger    |

## Files

| File                              | Description                                      |
|-----------------------------------|--------------------------------------------------|
| `Watch-DistractingWindows.ps1`    | Main script — run this                           |
| `Encode-AlertSound.ps1`           | Helper to base64-encode an MP3 for inline embedding |

## Requirements

- Windows 10/11
- PowerShell 5.1+
