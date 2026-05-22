'use strict';
/**
 * load-settings.js — live env-var resolution for hook subprocesses.
 *
 * Why this exists: Claude Code reads `~/.claude/settings.json` env block
 * once at startup and caches it into the parent process. When the user
 * runs `/mute-tts` mid-session it updates the file, but already-running
 * sessions' hooks still inherit the stale env. This helper makes every
 * CLAUDE_* lookup re-read the file on the *next* hook fire, so mute
 * propagates everywhere without a window reload.
 *
 * Resolution: settings.json env block wins when set, falls through to
 * process.env otherwise. Empty string in settings.json is treated as
 * "not set" so users can clear a key by emptying its value.
 *
 * File read is cached for the hook process lifetime (one read per fire)
 * since hooks make multiple lookups but live ~milliseconds total.
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude',
  'settings.json'
);

let cached = null;

function loadEnvBlock() {
  if (cached !== null) return cached;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const obj = JSON.parse(raw);
    cached = (obj && typeof obj.env === 'object' && obj.env) || {};
  } catch {
    cached = {};
  }
  return cached;
}

function readClaudeEnv(key) {
  const fileVal = loadEnvBlock()[key];
  if (fileVal !== undefined && fileVal !== '') return fileVal;
  return process.env[key];
}

// For tests only — lets a test reset the per-process cache between
// scenarios. Production hooks never call this.
function _resetCacheForTests() {
  cached = null;
}

module.exports = { readClaudeEnv, _resetCacheForTests, SETTINGS_PATH };
