---
description: Report which tts-attention-alert mute scopes are currently active by reading ~/.claude/settings.json. Use when the user asks if TTS is muted, or wants to verify mute state before/after `/mute-tts`.
---

Read `~/.claude/settings.json` and inspect the top-level `env` object (if it exists). Report which of these seven TTS-related keys are set to `"1"`:

- `CLAUDE_NOTIFY_DISABLED`
- `CLAUDE_STOP_NOTIFY_DISABLED`
- `CLAUDE_BASH_ALERT_DISABLED`
- `CLAUDE_NOTIFY_TTS_DISABLED`
- `CLAUDE_STOP_TTS_DISABLED`
- `CLAUDE_NOTIFY_PULSE_DISABLED`
- `CLAUDE_STOP_PULSE_DISABLED`

Then derive the active scopes:

- **Voice muted** = both `CLAUDE_NOTIFY_TTS_DISABLED=1` AND `CLAUDE_STOP_TTS_DISABLED=1`
- **Visual (edge-pulse) muted** = both `CLAUDE_NOTIFY_PULSE_DISABLED=1` AND `CLAUDE_STOP_PULSE_DISABLED=1`
- **Everything muted** = all three of `CLAUDE_NOTIFY_DISABLED=1`, `CLAUDE_STOP_NOTIFY_DISABLED=1`, `CLAUDE_BASH_ALERT_DISABLED=1`
- **Partial mute** = any key set that does not satisfy a complete scope above (call it out explicitly)
- **Nothing muted** = none of the seven keys are set to `"1"`

Report back in this shape:

```
Active mute scopes: <list, or "none">
Raw keys set: <list, or "none">

If the user is on a known scope, mention the corresponding `/unmute-tts <scope>` command they can run.
```

If `~/.claude/settings.json` does not exist or has no `env` object, report "Nothing muted — no env block in settings.json."
