#!/usr/bin/env node
/**
 * Notification Alert Hook (GAIN-MSP)
 *
 * On Claude's Notification event (waiting for input, permission prompt,
 * idle, auth), plays a short sound + speaks a TTS phrase + shows a
 * Windows balloon-toast.
 *
 * Distinguished from Stop-notify by:
 *   - TTS phrase: keyword-mapped from message (vs "Claude is done")
 *   - Toast title shows the message from payload when available
 *   - Edge-pulse color: Gold (vs DodgerBlue for Stop)
 *   - Escalates with TTS reminders at 20s/40s
 *   - Shorter throttle (10s) since pauses can cluster
 *
 * Disabled outside Windows.
 *
 * Disable everything: CLAUDE_NOTIFY_DISABLED=1
 * Disable just TTS:   CLAUDE_NOTIFY_TTS_DISABLED=1
 * Disable just pulse: CLAUDE_NOTIFY_PULSE_DISABLED=1
 * Custom TTS phrase:  CLAUDE_NOTIFY_TTS_TEXT="Whatever you want"
 *
 * Trigger: Notification
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const THROTTLE_MS = 10000;

const STATE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude',
  'cache'
);
const STATE_FILE = path.join(STATE_DIR, 'notification-alert-last.json');
const LOG_FILE = path.join(STATE_DIR, 'notifications.log');

let raw = '';

function isDisabled() {
  return String(process.env.CLAUDE_NOTIFY_DISABLED || '').toLowerCase() === '1';
}

function isPulseDisabled() {
  return String(process.env.CLAUDE_NOTIFY_PULSE_DISABLED || '').toLowerCase() === '1';
}

function shouldThrottle() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Date.now() - (state.last || 0) < THROTTLE_MS) return true;
    }
  } catch { /* ignore */ }
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ last: Date.now() }), 'utf8');
  } catch { /* ignore */ }
  return false;
}

function escapeSingleQuotes(s) {
  return String(s).replace(/'/g, "''");
}

const { buildDuckWrappedAction } = require('./lib/audio-duck');
const { buildPlayWavAction } = require('./lib/play-wav');

// Map a notification message to a short distinct TTS phrase. Order
// matters: most-actionable keywords first. Falls back to the message
// itself for unknown notification types.
function pickPhrase(message) {
  const m = String(message || '').toLowerCase();
  if (!m) return 'Claude needs input';
  // "plan ready" is matched first because the synthesized ExitPlanMode
  // message contains "accept", which would otherwise fall into the
  // permission bucket (wrong semantics — accepting a plan ≠ approving
  // a destructive action).
  if (/\bplan\b/.test(m)) return 'Plan ready';
  if (/permission|approve|approval|allow/.test(m)) return 'Permission needed';
  if (/\bidle\b|inactive/.test(m)) return 'Claude is idle';
  if (/waiting/.test(m)) return 'Claude is waiting';
  if (/\?|question|elicit/.test(m)) return 'Claude has a question';
  return message;
}

function buildPowerShellScript(message) {
  const ttsDisabled = String(process.env.CLAUDE_NOTIFY_TTS_DISABLED || '').toLowerCase() === '1';
  if (ttsDisabled) return null;
  // Keyword-map the message to a short action phrase so urgent prompts
  // are instantly recognizable by ear. Falls back to speaking the full
  // message if no keyword matches. CLAUDE_NOTIFY_TTS_TEXT overrides
  // everything.
  const ttsRaw = process.env.CLAUDE_NOTIFY_TTS_TEXT || pickPhrase(message);
  const ttsText = escapeSingleQuotes(ttsRaw.slice(0, 140));
  // Prefer pre-baked Supertonic WAV; fall back to live SAPI synthesis
  // for the env-var override path and any phrase we did not bake.
  const wavAction = process.env.CLAUDE_NOTIFY_TTS_TEXT ? null : buildPlayWavAction(ttsRaw);
  const speakAction = wavAction
    || `Add-Type -AssemblyName System.Speech | Out-Null; $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer; $tts.Speak('${ttsText}'); $tts.Dispose()`;
  return buildDuckWrappedAction(speakAction);
}

function logEvent(message) {
  const line = `${new Date().toISOString()}\tNotification\t${(message || '').replace(/\s+/g, ' ').slice(0, 500)}\n`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* logging is best-effort */ }
}

function triggerEdgePulse(color) {
  // 4-edge pulse frame around the primary monitor — pulses until user
  // focuses the VSCode running this Claude session (capped at 60s as a
  // safety so it never runs forever if user is away from PC).
  //
  // Why our own WPF window instead of FlashWindowEx: Electron windows
  // (VSCode, Windows Terminal) silently ignore FlashWindowEx on Win11.
  // Silent flag skips the duplicate Question sound — the toast hook PS
  // already plays it.
  const vbsPath = path.join(__dirname, 'run-hidden.vbs');
  const pulsePath = path.join(__dirname, 'edge-pulse.ps1');
  const child = spawn(
    'wscript.exe',
    [
      vbsPath, 'powershell.exe', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', pulsePath,
      '-Color', color,
      '-SeedPid', String(process.ppid),
      // Notification is blocking — escalate Gold → Orange → Red if user
      // doesn't focus VSCode within 20s / 40s. Edge-pulse speaks an
      // escalation TTS phrase on each stage to renew attention.
      '-Escalate',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}

function notifyWindows(message) {
  const script = buildPowerShellScript(message);
  if (!script) return; // TTS disabled — no audio to play, edge-pulse handles visual.
  // Why this dance: PowerShell shown via plain spawn flashes a console.
  // `cmd /c start /b` removed the Job-Object kill but still flashed cmd.
  // VBS shim (`run-hidden.vbs` calling WScript.Shell.Run cmd, 0, False)
  // is the well-known Windows pattern that NEVER shows a window.
  // Pass the PS script base64-encoded (-EncodedCommand) so we don't fight
  // quoting through cmd → wscript → powershell.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const vbsPath = path.join(__dirname, 'run-hidden.vbs');
  const child = spawn(
    'wscript.exe',
    [vbsPath, 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}

function run(rawInput) {
  if (isDisabled()) return { exitCode: 0 };
  if (process.platform !== 'win32') return { exitCode: 0 };

  let message = '';
  try {
    const data = JSON.parse(rawInput);
    // Native Notification event payload.
    if (data && typeof data.message === 'string') {
      message = data.message;
    }
    // Synthesize a "Claude has a question" message from a PreToolUse:
    // AskUserQuestion payload. Claude Code's native Notification event
    // does NOT fire for in-window questions — only for OS-level
    // permission prompts — so we piggyback on PreToolUse instead.
    if (data && data.tool_name === 'AskUserQuestion') {
      const q = data.tool_input && Array.isArray(data.tool_input.questions)
        ? data.tool_input.questions[0]
        : null;
      message = q && q.question
        ? `Claude has a question: ${q.question}`
        : 'Claude has a question';
    }
    // Plan mode acceptance — agent presents a plan and the user must
    // click "Accept this plan" before work begins. Same pattern: the
    // UI doesn't fire a native Notification event, so we piggyback on
    // PreToolUse:ExitPlanMode.
    if (data && data.tool_name === 'ExitPlanMode') {
      message = 'Plan ready, accept to proceed';
    }
  } catch { /* still notify even if payload is unparseable */ }

  // Log every event regardless of throttle — log is for after-the-fact
  // forensics ("did the permission prompt fire while I was in a meeting?").
  logEvent(message);

  if (shouldThrottle()) return { exitCode: 0 };

  try {
    notifyWindows(message);
    if (!isPulseDisabled()) triggerEdgePulse('Gold');
  } catch (err) {
    return { exitCode: 0, stderr: `[notification-alert] failed: ${err.message}` };
  }

  return { exitCode: 0 };
}

module.exports = { run, shouldThrottle, buildPowerShellScript, isPulseDisabled };

if (require.main === module) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) raw += chunk.substring(0, MAX_STDIN - raw.length);
  });
  process.stdin.on('end', () => {
    const result = run(raw);
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    process.exit(result.exitCode || 0);
  });
}
