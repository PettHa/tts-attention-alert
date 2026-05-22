---
description: Mute the tts-attention-alert plugin. Accepts an optional scope arg — `all` (default), `voice`, or `visual`. Writes the corresponding env vars to ~/.claude/settings.json so the hooks pick them up after Developer:Reload Window. Use when the user wants quiet (meeting, recording, sleeping baby, etc.).
---

The user wants to mute the tts-attention-alert plugin. The scope is `$ARGUMENTS` (treat empty / whitespace as `all`).

## Step 1 — Resolve the scope to env-var keys

Normalize `$ARGUMENTS` to lowercase. The three valid scopes map to these env-var keys (each set to `"1"`):

| Scope | Keys to set |
|---|---|
| `all` (or empty) | `CLAUDE_NOTIFY_DISABLED`, `CLAUDE_STOP_NOTIFY_DISABLED`, `CLAUDE_BASH_ALERT_DISABLED` |
| `voice` | `CLAUDE_NOTIFY_TTS_DISABLED`, `CLAUDE_STOP_TTS_DISABLED` |
| `visual` | `CLAUDE_NOTIFY_PULSE_DISABLED`, `CLAUDE_STOP_PULSE_DISABLED` |

If the user passed anything else (e.g. `pulse`, `everything`, a typo), tell them the valid scopes and stop.

## Step 2 — Update `~/.claude/settings.json`

Read `~/.claude/settings.json`. If the top-level `env` object does not exist, add it. Set each key from Step 1 to the string `"1"` (do not delete other env keys — leave them alone). Write the file back with 2-space indentation matching the existing format.

If the file does not exist or is unreadable, create a minimal one: `{ "env": { ... } }` with only the keys from Step 1.

## Step 3 — Confirm to the user

Tell the user (Norwegian or English depending on their language):
- Which scope you muted (`all` / `voice` / `visual`)
- That the mute takes effect on the next hook fire (next prompt completion, next permission request, etc.) — no window reload required, even for other already-open Claude Code sessions. The hooks re-read `~/.claude/settings.json` on every event.
- That `/unmute-tts` restores it, `/mute-tts-status` shows current state
