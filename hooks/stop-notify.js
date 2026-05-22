#!/usr/bin/env node
/**
 * Stop Notification Hook (GAIN-MSP)
 *
 * On Stop event, plays a short sound + speaks a TTS phrase + shows a
 * non-blocking Windows balloon-toast so Petter knows Claude finished
 * while away from the terminal.
 *
 * Disabled outside Windows (cloud routines on Linux are headless).
 * Throttled to one notification per 30s.
 *
 * Disable everything: CLAUDE_STOP_NOTIFY_DISABLED=1
 * Disable just TTS:   CLAUDE_STOP_TTS_DISABLED=1
 * Disable just pulse: CLAUDE_STOP_PULSE_DISABLED=1
 * Custom TTS phrase:  CLAUDE_STOP_TTS_TEXT="Whatever you want"
 *
 * Trigger: Stop
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const THROTTLE_MS = 30000;

const STATE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude',
  'cache'
);
const STATE_FILE = path.join(STATE_DIR, 'stop-notify-last.json');
const LOG_FILE = path.join(STATE_DIR, 'notifications.log');

let raw = '';

function isDisabled() {
  return String(process.env.CLAUDE_STOP_NOTIFY_DISABLED || '').toLowerCase() === '1';
}

function isPulseDisabled() {
  return String(process.env.CLAUDE_STOP_PULSE_DISABLED || '').toLowerCase() === '1';
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

const { buildDuckWrappedAction } = require('./lib/audio-duck');
const { buildPlayWavAction } = require('./lib/play-wav');

function buildPowerShellScript() {
  const ttsDisabled = String(process.env.CLAUDE_STOP_TTS_DISABLED || '').toLowerCase() === '1';
  if (ttsDisabled) return null;
  const ttsRaw = process.env.CLAUDE_STOP_TTS_TEXT || 'Claude is done';
  const ttsText = ttsRaw.replace(/'/g, "''").slice(0, 140);
  // Prefer pre-baked Supertonic WAV; fall back to live SAPI synthesis for
  // the env-var override path and any unbaked phrase.
  const wavAction = process.env.CLAUDE_STOP_TTS_TEXT ? null : buildPlayWavAction(ttsRaw);
  const speakAction = wavAction
    || `Add-Type -AssemblyName System.Speech | Out-Null; $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer; $tts.Speak('${ttsText}'); $tts.Dispose()`;
  return buildDuckWrappedAction(speakAction);
}

function logEvent() {
  const line = `${new Date().toISOString()}\tStop\t(response finished)\n`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* logging is best-effort */ }
}

function triggerEdgePulse(color) {
  // Stop is less urgent than Notification, so we use a fixed 3-pulse
  // window instead of looping-until-focus. Different color too
  // (DodgerBlue) so it's visually distinct from the gold Notification
  // pulse. Silent — toast hook PS already plays the Asterisk sound.
  const vbsPath = path.join(__dirname, 'run-hidden.vbs');
  const pulsePath = path.join(__dirname, 'edge-pulse.ps1');
  const child = spawn(
    'wscript.exe',
    [
      vbsPath, 'powershell.exe', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', pulsePath,
      '-Color', color,
      '-DurationMs', '2400',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}

function notifyWindows() {
  const script = buildPowerShellScript();
  if (!script) return; // TTS disabled — edge-pulse handles visual.
  // Same VBS-shim pattern as notification-alert.js — silently launches
  // PowerShell outside the parent Node's Job Object so toast renders
  // reliably with no console flash.
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

  // Bail on subagent stops — only the main agent's Stop should alert.
  // Some Claude Code versions fire SubagentStop through Stop-hook
  // handlers when no explicit SubagentStop matcher is registered, so
  // we filter defensively on hook_event_name from the payload.
  try {
    const data = JSON.parse(rawInput);
    if (data && data.hook_event_name === 'SubagentStop') return { exitCode: 0 };
  } catch { /* unparseable payload -> treat as main Stop */ }

  // Log every Stop regardless of throttle — log is forensic record.
  logEvent();

  if (shouldThrottle()) return { exitCode: 0 };

  try {
    notifyWindows();
    if (!isPulseDisabled()) triggerEdgePulse('DodgerBlue');
  } catch (err) {
    return { exitCode: 0, stderr: `[stop-notify] failed: ${err.message}` };
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
