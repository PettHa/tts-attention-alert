---
description: Unmute the tts-attention-alert plugin. Accepts an optional scope arg — `all` (default), `voice`, or `visual`. Removes the corresponding env vars from ~/.claude/settings.json. Pair with `/mute-tts`.
---

The user wants to unmute the tts-attention-alert plugin. The scope is `$ARGUMENTS` (treat empty / whitespace as `all`).

## Step 1 — Resolve the scope to env-var keys

Normalize `$ARGUMENTS` to lowercase. The three valid scopes map to these env-var keys (which will be removed):

| Scope | Keys to remove |
|---|---|
| `all` (or empty) | ALL seven TTS-related keys: `CLAUDE_NOTIFY_DISABLED`, `CLAUDE_STOP_NOTIFY_DISABLED`, `CLAUDE_BASH_ALERT_DISABLED`, `CLAUDE_NOTIFY_TTS_DISABLED`, `CLAUDE_STOP_TTS_DISABLED`, `CLAUDE_NOTIFY_PULSE_DISABLED`, `CLAUDE_STOP_PULSE_DISABLED` |
| `voice` | `CLAUDE_NOTIFY_TTS_DISABLED`, `CLAUDE_STOP_TTS_DISABLED` |
| `visual` | `CLAUDE_NOTIFY_PULSE_DISABLED`, `CLAUDE_STOP_PULSE_DISABLED` |

If the user passed anything else, tell them the valid scopes and stop.

## Step 2 — Update `~/.claude/settings.json`

Read `~/.claude/settings.json`. If the top-level `env` object does not exist, there is nothing to do — tell the user "already unmuted" and stop.

Otherwise, delete each key from Step 1 from the `env` object (do not touch other env keys). If the resulting `env` object is empty, remove the `env` field entirely. Write the file back with 2-space indentation matching the existing format.

## Step 3 — Confirm to the user

Tell the user:
- Which scope you unmuted
- That the change takes effect on the next hook fire — no reload required, even for other open Claude Code sessions
- That `/mute-tts-status` shows the current state if they want to verify
