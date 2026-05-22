'use strict';

// Smoke test: pulse-disabled gates in v0.4.0 + live-mute (v0.5.0).
// Run with: node pulse-disabled.test.js
// Exits 0 on success, 1 on any failed assertion.
//
// Sandboxes HOME to a temp dir BEFORE requiring the hooks so the
// load-settings loader resolves SETTINGS_PATH into the temp location.
// This isolates tests from the user's real ~/.claude/settings.json.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-disabled-test-'));
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
fs.mkdirSync(path.join(SANDBOX, '.claude'), { recursive: true });
const SETTINGS_FILE = path.join(SANDBOX, '.claude', 'settings.json');

// Require hooks AFTER setting HOME so the loader picks up the sandbox.
const notification = require('./notification-alert');
const stopNotify = require('./stop-notify');
const bashPermission = require('./bash-permission-alert');
const { _resetCacheForTests } = require('./lib/load-settings');

let failed = 0;
function eq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function withSettings(envObj, fn) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ env: envObj }, null, 2));
  _resetCacheForTests();
  try { fn(); } finally {
    try { fs.unlinkSync(SETTINGS_FILE); } catch {}
    _resetCacheForTests();
  }
}

// --- process.env path (settings.json absent) ---
// notification-alert.js — CLAUDE_NOTIFY_PULSE_DISABLED
_resetCacheForTests();
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', undefined, () => {
  _resetCacheForTests();
  eq(notification.isPulseDisabled(), false, 'notification: pulse enabled when env unset');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  _resetCacheForTests();
  eq(notification.isPulseDisabled(), true, 'notification: pulse disabled when env=1');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '0', () => {
  _resetCacheForTests();
  eq(notification.isPulseDisabled(), false, 'notification: pulse enabled when env=0');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', 'true', () => {
  _resetCacheForTests();
  eq(notification.isPulseDisabled(), false, 'notification: only "1" disables (string "true" does not)');
});

// stop-notify.js — CLAUDE_STOP_PULSE_DISABLED (separate namespace)
withEnv('CLAUDE_STOP_PULSE_DISABLED', undefined, () => {
  _resetCacheForTests();
  eq(stopNotify.isPulseDisabled(), false, 'stop: pulse enabled when env unset');
});
withEnv('CLAUDE_STOP_PULSE_DISABLED', '1', () => {
  _resetCacheForTests();
  eq(stopNotify.isPulseDisabled(), true, 'stop: pulse disabled when env=1');
});

// stop-notify must NOT react to CLAUDE_NOTIFY_PULSE_DISABLED
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  withEnv('CLAUDE_STOP_PULSE_DISABLED', undefined, () => {
    _resetCacheForTests();
    eq(stopNotify.isPulseDisabled(), false, 'stop: ignores CLAUDE_NOTIFY_PULSE_DISABLED');
  });
});

// bash-permission-alert.js shares CLAUDE_NOTIFY_PULSE_DISABLED
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', undefined, () => {
  _resetCacheForTests();
  eq(bashPermission.isPulseDisabled(), false, 'bash: pulse enabled when env unset');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  _resetCacheForTests();
  eq(bashPermission.isPulseDisabled(), true, 'bash: pulse disabled when CLAUDE_NOTIFY_PULSE_DISABLED=1 (shared namespace)');
});

// --- v0.5.0 live-mute path (settings.json wins over process.env) ---
// User runs /mute-tts mid-session, settings.json gets CLAUDE_NOTIFY_PULSE_DISABLED=1,
// but parent process.env still has the old value (or is unset). Hook should see "muted".
withSettings({ CLAUDE_NOTIFY_PULSE_DISABLED: '1' }, () => {
  withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', undefined, () => {
    eq(notification.isPulseDisabled(), true, 'live-mute: settings.json=1 + env unset -> pulse disabled');
  });
});
withSettings({ CLAUDE_NOTIFY_PULSE_DISABLED: '1' }, () => {
  withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '0', () => {
    eq(notification.isPulseDisabled(), true, 'live-mute: settings.json=1 + env=0 -> settings wins, pulse disabled');
  });
});
// And the unmute direction: settings.json explicitly empty -> falls to process.env
withSettings({ CLAUDE_NOTIFY_PULSE_DISABLED: '' }, () => {
  withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
    eq(notification.isPulseDisabled(), true, 'live-unmute via empty: empty settings.json -> falls through to env=1');
  });
});
// Stop hook also picks up settings.json
withSettings({ CLAUDE_STOP_PULSE_DISABLED: '1' }, () => {
  withEnv('CLAUDE_STOP_PULSE_DISABLED', undefined, () => {
    eq(stopNotify.isPulseDisabled(), true, 'live-mute: stop hook sees settings.json without env');
  });
});

// Cleanup
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
