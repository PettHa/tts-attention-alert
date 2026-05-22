#!/usr/bin/env node
/**
 * Bash Permission Alert Hook
 *
 * Fires when Claude Code is about to show the "Allow this bash command?"
 * modal. Wired to the native PermissionRequest hook event, matcher
 * "Bash" — Claude Code emits this exactly when the permission dialog
 * would be shown to the user, with no false positives or prediction
 * required.
 *
 * Behavior:
 *   - Speaks "Bash permission needed: <verb>" via Windows System.Speech
 *   - Triggers the gold edge-pulse overlay with escalation
 *   - Auto-ducks Spotify/YouTube around speech
 *   - Logs every event to ~/.claude/cache/notifications.log
 *
 * Disabled outside Windows.
 *
 * Disable everything: CLAUDE_NOTIFY_DISABLED=1 (shared with notification-alert)
 *                     CLAUDE_BASH_ALERT_DISABLED=1 (this hook only)
 * Disable just TTS:   CLAUDE_NOTIFY_TTS_DISABLED=1
 * Disable just pulse: CLAUDE_NOTIFY_PULSE_DISABLED=1 (shared with notification-alert)
 * Override phrase:    CLAUDE_NOTIFY_TTS_TEXT="..."
 *
 * Trigger: PermissionRequest, matcher Bash
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readClaudeEnv } = require('./lib/load-settings');

const MAX_STDIN = 1024 * 1024;
const THROTTLE_MS = 5000;

const STATE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude',
  'cache'
);
const STATE_FILE = path.join(STATE_DIR, 'bash-permission-alert-last.json');
const LOG_FILE = path.join(STATE_DIR, 'notifications.log');

const { buildDuckWrappedAction } = require('./lib/audio-duck');
const { buildPlayWavAction } = require('./lib/play-wav');

function isDisabled() {
  if (String(readClaudeEnv('CLAUDE_NOTIFY_DISABLED') || '').toLowerCase() === '1') return true;
  if (String(readClaudeEnv('CLAUDE_BASH_ALERT_DISABLED') || '').toLowerCase() === '1') return true;
  return false;
}

function isPulseDisabled() {
  return String(readClaudeEnv('CLAUDE_NOTIFY_PULSE_DISABLED') || '').toLowerCase() === '1';
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

function pickPhrase(command) {
  const first = (command.trim().split(/\s+/)[0] || '').toLowerCase();
  if (!first) return 'Bash permission needed';
  return `Bash permission needed: ${first}`;
}

function buildPowerShellScript(command) {
  if (String(readClaudeEnv('CLAUDE_NOTIFY_TTS_DISABLED') || '').toLowerCase() === '1') return null;
  const ttsOverride = readClaudeEnv('CLAUDE_NOTIFY_TTS_TEXT');
  const ttsRaw = ttsOverride || pickPhrase(command);
  const ttsText = escapeSingleQuotes(ttsRaw.slice(0, 140));
  // Prefer pre-baked Supertonic WAV for known verbs; fall back to bare
  // "Bash permission needed" WAV for unknown verbs (via slug fallback in
  // play-wav.js), or live SAPI for the env-var override.
  const wavAction = ttsOverride
    ? null
    : buildPlayWavAction(ttsRaw) || buildPlayWavAction('Bash permission needed');
  const speakAction = wavAction
    || `Add-Type -AssemblyName System.Speech | Out-Null; $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer; $tts.Speak('${ttsText}'); $tts.Dispose()`;
  return buildDuckWrappedAction(speakAction);
}

function logEvent(command) {
  const safe = String(command || '').replace(/\s+/g, ' ').slice(0, 500);
  const line = `${new Date().toISOString()}\tPermissionRequest:Bash\t${safe}\n`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* logging is best-effort */ }
}

function triggerEdgePulse(color) {
  const vbsPath = path.join(__dirname, 'run-hidden.vbs');
  const pulsePath = path.join(__dirname, 'edge-pulse.ps1');
  const child = spawn(
    'wscript.exe',
    [
      vbsPath, 'powershell.exe', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', pulsePath,
      '-Color', color,
      '-SeedPid', String(process.ppid),
      '-Escalate',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}

function notifyWindows(command) {
  const script = buildPowerShellScript(command);
  if (!script) return;
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

  let command = '';
  try {
    const data = JSON.parse(rawInput);
    if (data && data.tool_name !== 'Bash') return { exitCode: 0 };
    command = (data && data.tool_input && data.tool_input.command) || '';
  } catch { return { exitCode: 0 }; }

  logEvent(command);
  if (shouldThrottle()) return { exitCode: 0 };

  try {
    notifyWindows(command);
    if (!isPulseDisabled()) triggerEdgePulse('Gold');
  } catch (err) {
    return { exitCode: 0, stderr: `[bash-permission-alert] failed: ${err.message}` };
  }

  return { exitCode: 0 };
}

module.exports = { run, pickPhrase, isPulseDisabled };

if (require.main === module) {
  let raw = '';
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
