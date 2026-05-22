# Changelog

All notable changes to `tts-attention-alert` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-05-22

### Changed

- **Slash-command mute now takes effect immediately across every open Claude Code session, with no `Developer: Reload Window` required.** Hooks re-read `~/.claude/settings.json` on every fire, so `/mute-tts visual` (or any toggle) propagates to every other already-running session on its next event. Cold-start sessions still inherit the persistent env block exactly as before.
- New helper `hooks/lib/load-settings.js` resolves CLAUDE_* env vars via settings.json first, falling back to `process.env`. All 17 `process.env.CLAUDE_*` reads in the plugin (across `notification-alert.js`, `stop-notify.js`, `bash-permission-alert.js`, `lib/audio-duck.js`, `lib/play-wav.js`) now route through it. Shell-set env vars (`$PROFILE`, `.envrc`) keep working as fallback for dev.

### Why

In v0.4.0 the `/mute-tts` command edited `~/.claude/settings.json` but `process.env` was cached by Claude Code at startup, so already-open windows didn't see the new state until each was reloaded individually. Reading the file at fire-time fixes the cross-window UX without introducing a new state file. File reads are cached for the hook process lifetime (one read per fire — hooks live milliseconds), so the perf hit is negligible.

### Tests

- New `hooks/lib/load-settings.test.js` — 9 assertions covering settings.json-wins / process.env-fallback / missing-file / malformed-JSON / empty-string / cache / no-env-block.
- `hooks/pulse-disabled.test.js` extended with 4 live-mute assertions confirming settings.json overrides process.env at fire-time.

## [0.4.0] - 2026-05-22

### Added

- **Granular mute via slash-commands.** Three new commands ship with the plugin: `/mute-tts [scope]`, `/unmute-tts [scope]`, `/mute-tts-status`. Scopes are `all` (default — silences every hook), `voice` (TTS off, edge-pulse stays), and `visual` (edge-pulse off, TTS stays). The commands edit the `env` block in `~/.claude/settings.json`; a `Developer: Reload Window` propagates the new env vars to the hook subprocesses.
- **`CLAUDE_NOTIFY_PULSE_DISABLED=1`** env var — suppresses the gold edge-pulse on Notification + Bash permission events while still letting TTS speak. Shared between `notification-alert.js` and `bash-permission-alert.js`, mirroring how those hooks already share `CLAUDE_NOTIFY_TTS_DISABLED`.
- **`CLAUDE_STOP_PULSE_DISABLED=1`** env var — same idea for the blue edge-pulse on the Stop hook.

### Why

Petter wanted "TTS but no flashing border" and "border but no voice" as independent toggles for meeting / recording scenarios. Previous releases only offered "everything off" (`*_DISABLED`) or "TTS off, pulse still fires" (`*_TTS_DISABLED`) — the inverse (pulse off, TTS on) did not exist. The new `*_PULSE_DISABLED` vars fill that gap, and the slash-commands give a one-command UX so users don't have to hand-edit settings.json.

## [0.3.0] - 2026-05-14

### Added

- **Pre-baked Supertonic WAVs replace Windows SAPI for built-in phrases.** `audio/*.wav` ships 21 neural-quality WAVs (F1 voice) generated via [Supertonic](https://github.com/supertone-inc/supertonic) ONNX TTS for every phrase the plugin emits: 7 static (`Permission needed`, `Plan ready`, `Claude is done`, …), 1 bare `Bash permission needed`, and 13 common bash-verb variants (`git`, `rm`, `npm`, `docker`, …). Played via `System.Media.SoundPlayer.PlaySync()` inside the existing Spotify/YouTube auto-duck wrapper. Zero runtime model download for end-users.
- `hooks/lib/play-wav.js` — phrase → slug → WAV path mapping, plus 7-test suite in `play-wav.test.js`.
- `scripts/generate-audio.py` — dev-only regeneration script. Voice selectable via `--voice <M1-M5/F1-F5>`. Requires `pip install supertonic` and `HF_HUB_DISABLE_XET=1` env var (HF Xet CDN has DNS-resolution issues on some networks).
- `CLAUDE_NOTIFY_WAV_DISABLED=1` env var — force Windows SAPI everywhere if the user prefers the system voice.
- README sections: "Choose your TTS engine" and "Audio assets".

### Changed

- `notification-alert.js`, `stop-notify.js`, `bash-permission-alert.js`, `edge-pulse.ps1` (`Invoke-EscalationTTS`) all now prefer pre-baked WAV with SAPI fallback. SAPI still handles `CLAUDE_NOTIFY_TTS_TEXT` / `CLAUDE_STOP_TTS_TEXT` overrides and any phrase not in the baked set.

## [0.2.1] - 2026-05-13

### Fixed

- **Stop hook no longer fires on subagent completion** — `stop-notify.js` now reads `hook_event_name` from the payload and bails when it equals `"SubagentStop"`. Some Claude Code versions route subagent stops through the `Stop` hook handler when no explicit `SubagentStop` matcher is registered, so this is a defensive in-script filter rather than a `hooks.json` change. Result: TTS + edge-pulse fire only when the main agent stops, not every time Claude finishes a delegated Agent/Explore/Plan subagent run.

## [0.2.0] - 2026-05-12

### Added

- **Bash permission alert** — TTS + edge-pulse now fires when Claude Code is about to show the "Allow this bash command?" modal. Wired to Claude Code's native [`PermissionRequest`](https://code.claude.com/docs/en/hooks) hook event with matcher `Bash`, so the alert fires exactly when the dialog would be shown — no prediction, no allow-list simulation, no false positives.
- **Spoken phrase includes command verb** — e.g. *"Bash permission needed: rm"* — recognizable by ear without reading the full command aloud.
- **`CLAUDE_BASH_ALERT_DISABLED=1`** env var to silence just this hook (the existing `CLAUDE_NOTIFY_DISABLED=1` still disables the whole notification stack).

### Why a dedicated hook event

Claude Code's `Notification` event does not fire for the in-window "Allow this bash command?" modal, and predicting which commands will trigger it from `permissions.allow`/`deny` is unreliable in `acceptEdits` / `bypassPermissions` modes (Claude's safety classifier intervenes on its own heuristics). The `PermissionRequest` event was added precisely for this case — it fires when the dialog is about to display, with the full `tool_name` + `tool_input` + `permission_mode` + `permission_suggestions` payload. We use it as a pure signal: fire alert, no decision logic.

## [0.1.1] - 2026-05-12

### Added

- **ExitPlanMode alert** — plan-mode "Accept this plan" prompt now triggers the same TTS + edge-pulse + auto-duck stack via PreToolUse hook. Spoken phrase: *"Plan ready"*.
- **Plan keyword in TTS phrase mapping** — `"plan"` in the message routes to *"Plan ready"* instead of incorrectly falling through to *"Permission needed"* (accepting a plan ≠ approving a destructive action).

### Fixed

- **`${CLAUDE_PLUGIN_ROOT}` now quoted in hooks.json** — paths with whitespace (e.g. Windows usernames like `John Doe`) would have broken shell parsing. Matches the format shown in Claude Code's plugin docs example.

### Marketplace metadata

- Plugin entry now declares `category`, `tags`, `author`, `homepage`, `license`, and a pinned `version` for better discoverability in plugin browsers.

## [0.1.0] - 2026-05-12

### Initial release

- **TTS speech** of the actual Claude notification message, with keyword-mapped short action phrases ("Permission needed", "Claude has a question", "Claude is waiting", etc.).
- **Edge-pulse overlay** — 4-edge WPF frame around the primary monitor, click-through, always-on-top.
  - Notification: gold, loops until VSCode (running this Claude session) gets foreground focus.
  - Stop: dodger blue, 3 quick pulses.
- **Escalation** for unresponded notifications — Gold → DarkOrange → Red at 20s/40s with a fresh TTS phrase.
- **Auto-duck media** — pauses Spotify, YouTube, VLC, podcast apps around the TTS speak call via Windows `GlobalSystemMediaTransportControlsSessionManager`. Resumes automatically.
- **PreToolUse:AskUserQuestion hook** — fires the same alert when Claude is about to ask an in-window question (Claude Code's native `Notification` event doesn't cover this).
- **Forensic log** of every event to `~/.claude/cache/notifications.log` with timestamp + type + message.
- **No Windows balloon toast** — avoids OS-side notification chime; only TTS-based audio.
- **VBS shim** (`run-hidden.vbs`) for launching PowerShell without a console flash and outside the parent Node Job Object.
- **PowerShell scripts** invoked via `-EncodedCommand` (base64) to sidestep cmd → wscript → powershell quoting issues.

### Environment variables

| Variable | Effect |
| :--- | :--- |
| `CLAUDE_NOTIFY_DISABLED=1` | Disable the Notification + AskUserQuestion hook entirely |
| `CLAUDE_NOTIFY_TTS_DISABLED=1` | Disable just TTS for Notification |
| `CLAUDE_NOTIFY_TTS_TEXT="..."` | Override the spoken phrase |
| `CLAUDE_STOP_NOTIFY_DISABLED=1` | Disable the Stop hook entirely |
| `CLAUDE_STOP_TTS_DISABLED=1` | Disable just TTS for Stop |
| `CLAUDE_STOP_TTS_TEXT="..."` | Override the Stop spoken phrase |
| `CLAUDE_NOTIFY_DUCK_DISABLED=1` | Skip pausing Spotify/YouTube/etc around TTS |

[Unreleased]: https://github.com/PettHa/tts-attention-alert/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.5.0
[0.4.0]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.4.0
[0.3.0]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.3.0
[0.2.1]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.2.1
[0.2.0]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.2.0
[0.1.1]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.1.1
[0.1.0]: https://github.com/PettHa/tts-attention-alert/releases/tag/v0.1.0
