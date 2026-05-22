# tts-attention-alert

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)](https://github.com/PettHa/tts-attention-alert)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-da7756)](https://code.claude.com/docs/en/plugins)
[![Version](https://img.shields.io/github/v/release/PettHa/tts-attention-alert?include_prereleases&label=version)](https://github.com/PettHa/tts-attention-alert/releases)
[![GitHub stars](https://img.shields.io/github/stars/PettHa/tts-attention-alert?style=social)](https://github.com/PettHa/tts-attention-alert/stargazers)

A Claude Code plugin that demands your attention when Claude pauses, asks a question, or finishes a response — even when you're in another window or away from the desk.

**Windows only.** The plugin uses Windows-native APIs (System.Speech.Synthesis, WPF, GlobalSystemMediaTransportControlsSessionManager). On macOS / Linux all hooks short-circuit on `process.platform !== 'win32'`.

## What it does

When Claude:

- **Pauses for permission** (e.g. you're about to run `git push`)
- **Wants to run a Bash command not in your allowlist** — the "Allow this bash command?" modal
- **Asks a question** via `AskUserQuestion` or **presents a plan** via `ExitPlanMode`
- **Finishes a response**

…the plugin fires three reinforcing channels at once:

1. **🗣️ TTS speech** — plays a pre-baked [Supertonic](https://github.com/supertone-inc/supertonic) WAV for known phrases (no model download for end-users), falls back to Windows `System.Speech` for env-var overrides and unbaked text. Messages are mapped to a short action phrase via keywords:
   - "permission" / "approve" / "allow" → *"Permission needed"*
   - "waiting" → *"Claude is waiting"*
   - "idle" → *"Claude is idle"*
   - "?" / "question" / "elicit" → *"Claude has a question"*
   - otherwise speaks the raw message
2. **🟡 Edge-pulse frame** — a thin colored band around your primary monitor pulses to grab your peripheral vision:
   - **Notification**: gold, loops until the VSCode window running this Claude session gets foreground focus (60s safety cap). Escalates **Gold → DarkOrange → Red** at 20s / 40s with a fresh TTS phrase ("Claude still needs you").
   - **Stop**: blue, three quick pulses then closes.
3. **🎵 Auto-duck media** — pauses Spotify, YouTube, VLC, podcast apps around the TTS speak call (Windows `GlobalSystemMediaTransportControlsSessionManager`) so the spoken phrase is audible even mid-song. Resumes automatically. Silent no-op if nothing is playing.

A forensic log of every event is appended to `~/.claude/cache/notifications.log` with timestamp, type, and message — so you can scroll back "what fired while I was in a meeting?".

## Why no balloon toast?

Windows' built-in toast system plays a default notification chime that can't be easily suppressed. We dropped the toast and rely on TTS + visual edge-pulse instead, giving full control over the audio.

## Why edge-pulse instead of FlashWindowEx?

`FlashWindowEx` is unreliable on Windows 11 + Electron windows (VSCode, Windows Terminal) — see [microsoft/terminal#8713](https://github.com/microsoft/terminal/issues/8713). The plugin renders its own WPF overlay so the visual cue is guaranteed to display.

## Install

Requires Claude Code with plugin support (`/plugin` command available).

```text
/plugin marketplace add PettHa/tts-attention-alert
/plugin install tts-attention-alert@tts-attention-alert
```

Then reload the window (`Developer: Reload Window` or restart Claude Code) so settings re-register the hooks.

To test locally before installing from GitHub:

```bash
claude --plugin-dir /path/to/tts-attention-alert
```

## Choose your TTS engine

The plugin ships with two voices side-by-side:

| Engine | Quality | How it sounds | When it's used |
| :--- | :--- | :--- | :--- |
| **Supertonic** (default) | High — neural, on-device | Natural human cadence, F1 (female) voice | All built-in phrases (`Permission needed`, `Claude is done`, `Bash permission needed: git`, …) |
| **Windows SAPI** (fallback) | Standard — robotic system voice | Whatever your `System.Speech.Synthesis` default is set to | `CLAUDE_NOTIFY_TTS_TEXT` / `CLAUDE_STOP_TTS_TEXT` overrides, and any phrase not in the pre-baked set |

**To force SAPI everywhere** (e.g. you don't like the F1 voice or want a system-consistent feel):

```bash
export CLAUDE_NOTIFY_WAV_DISABLED=1
```

**To switch the Supertonic voice** (e.g. M1 male instead of F1):

```bash
.venv-supertonic/Scripts/python.exe scripts/generate-audio.py --voice M1
```

This overwrites `audio/*.wav` with the new voice. Voices: `M1`–`M5` (male), `F1`–`F5` (female). See [Audio assets](#audio-assets) for setup details.

## Configuration (environment variables)

All optional. Set in your shell or `.env`:

| Variable | Effect |
| :--- | :--- |
| `CLAUDE_NOTIFY_DISABLED=1` | Disable the Notification + AskUserQuestion hook entirely |
| `CLAUDE_NOTIFY_TTS_DISABLED=1` | Disable just TTS for Notification (edge-pulse still fires) |
| `CLAUDE_NOTIFY_PULSE_DISABLED=1` | Disable just the edge-pulse for Notification + Bash (TTS still fires). Shared with bash-permission-alert |
| `CLAUDE_NOTIFY_TTS_TEXT="..."` | Override the spoken phrase (skips keyword mapping) |
| `CLAUDE_STOP_NOTIFY_DISABLED=1` | Disable the Stop hook entirely |
| `CLAUDE_STOP_TTS_DISABLED=1` | Disable just TTS for Stop |
| `CLAUDE_STOP_PULSE_DISABLED=1` | Disable just the edge-pulse for Stop (TTS still fires) |
| `CLAUDE_STOP_TTS_TEXT="..."` | Override the Stop spoken phrase (default: *"Claude is done"*) |
| `CLAUDE_NOTIFY_DUCK_DISABLED=1` | Skip pausing Spotify/YouTube/etc around TTS |
| `CLAUDE_BASH_ALERT_DISABLED=1` | Disable just the Bash permission alert (other hooks still fire) |
| `CLAUDE_NOTIFY_WAV_DISABLED=1` | Skip the pre-baked Supertonic WAVs and always use Windows SAPI |

### Mute via slash-commands (v0.4.0+)

Three slash-commands ship with the plugin so you can toggle mute scopes without editing env vars by hand:

| Command | What it does |
| :--- | :--- |
| `/mute-tts [all\|voice\|visual]` | Sets the corresponding env keys to `"1"` in `~/.claude/settings.json` (defaults to `all`). |
| `/unmute-tts [all\|voice\|visual]` | Removes the corresponding env keys. `all` clears every TTS-related key. |
| `/mute-tts-status` | Reports which mute scopes are currently active by inspecting `~/.claude/settings.json`. |

Scope semantics:

- **`all`** — flips `CLAUDE_NOTIFY_DISABLED`, `CLAUDE_STOP_NOTIFY_DISABLED`, `CLAUDE_BASH_ALERT_DISABLED`. Total silence.
- **`voice`** — flips `CLAUDE_NOTIFY_TTS_DISABLED`, `CLAUDE_STOP_TTS_DISABLED`. Edge-pulse still fires; media-duck does not (it's tied to TTS).
- **`visual`** — flips `CLAUDE_NOTIFY_PULSE_DISABLED`, `CLAUDE_STOP_PULSE_DISABLED`. TTS still fires.

### Live config (v0.5.0+) — no reload required

Slash-command edits take effect on the **next hook fire** in every open Claude Code session — no `Developer: Reload Window`, no restart, no per-window setup. Hooks read `~/.claude/settings.json` on every event, with `process.env` as a fallback. Shell-set env vars (PowerShell `$PROFILE`, `.envrc`, etc.) still work for dev — `settings.json` only overrides them when explicitly set.

## Bash permission alert (v0.2.0+)

Claude Code's `Notification` event does **not** fire for the in-window "Allow this bash command?" modal. To catch it, the plugin wires Claude Code's native [`PermissionRequest`](https://code.claude.com/docs/en/hooks) hook event with matcher `Bash` — the event fires exactly when the dialog is about to display, with the full payload:

```jsonc
{
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf node_modules", "description": "..." },
  "permission_mode": "default",      // or "acceptEdits" / "bypassPermissions"
  "permission_suggestions": [ ... ]
}
```

No prediction, no allow-list simulation, no dangerous-pattern heuristics — just fire the alert. Spoken phrase is *"Bash permission needed: \<verb\>"* so urgent prompts are recognizable by ear without reading the full command aloud.

## Architecture

```
tts-attention-alert/
├── .claude-plugin/
│   ├── plugin.json                  ← manifest
│   └── marketplace.json             ← marketplace registration
├── audio/                           ← pre-baked Supertonic WAVs (committed, no runtime download)
│   ├── permission-needed.wav        ← one per static phrase + one per common bash verb
│   └── …
├── hooks/
│   ├── hooks.json                   ← Notification + Stop + PreToolUse + PermissionRequest wiring
│   ├── notification-alert.js        ← Notification + AskUserQuestion + ExitPlanMode
│   ├── bash-permission-alert.js     ← PermissionRequest:Bash, fires on the actual modal
│   ├── stop-notify.js               ← fires when response ends
│   ├── edge-pulse.ps1               ← 4-edge WPF overlay (looping + escalation)
│   ├── run-hidden.vbs               ← `wscript` shim so PowerShell launches without a console flash
│   └── lib/
│       ├── audio-duck.js            ← builds the WinRT pause-resume PowerShell snippet
│       └── play-wav.js              ← maps phrase → slug → pre-baked WAV path
├── scripts/
│   └── generate-audio.py            ← dev-only: regenerate audio/*.wav via Supertonic
└── README.md
```

### Audio assets

`audio/*.wav` is pre-baked once on the dev machine using [Supertonic](https://github.com/supertone-inc/supertonic) and checked into the repo. End-users get high-quality on-device speech with **zero** runtime model download and no Python dependency.

To regenerate (e.g. to switch voice or add phrases):

```bash
python -m venv .venv-supertonic
.venv-supertonic/Scripts/python.exe -m pip install supertonic
HF_HUB_DISABLE_XET=1 .venv-supertonic/Scripts/python.exe scripts/generate-audio.py --voice F1
```

The first run downloads the ~99 MB Supertonic ONNX model into your Hugging Face cache. `HF_HUB_DISABLE_XET=1` is needed because the Xet CDN endpoint can fail DNS resolution on some networks — vanilla HTTPS works fine. Available voices: `M1`–`M5` (male), `F1`–`F5` (female).

Phrases the plugin pre-bakes are listed in `scripts/generate-audio.py`. If you add a new phrase to a hook script, also add it to `STATIC_PHRASES` (or `BASH_VERBS`) there and to `PHRASE_TO_SLUG` in `hooks/lib/play-wav.js`, then rerun the script. Unknown phrases fall through to live SAPI synthesis at runtime — nothing crashes.

Hook scripts spawn PowerShell via a VBScript shim (`run-hidden.vbs` → `WScript.Shell.Run cmd, 0, False`) so nothing flashes a console on launch. The PowerShell script is passed base64-encoded via `-EncodedCommand` to avoid quoting headaches through `cmd` → `wscript` → `powershell`.

## License

MIT — see [LICENSE](LICENSE).
