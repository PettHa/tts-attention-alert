'use strict';

// Smoke test: the new CLAUDE_*_PULSE_DISABLED env-var gates in v0.4.0.
// Run with: node pulse-disabled.test.js
// Exits 0 on success, 1 on any failed assertion.

const notification = require('./notification-alert');
const stopNotify = require('./stop-notify');
const bashPermission = require('./bash-permission-alert');

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

// notification-alert.js — CLAUDE_NOTIFY_PULSE_DISABLED
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', undefined, () => {
  eq(notification.isPulseDisabled(), false, 'notification: pulse enabled when env unset');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  eq(notification.isPulseDisabled(), true, 'notification: pulse disabled when env=1');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '0', () => {
  eq(notification.isPulseDisabled(), false, 'notification: pulse enabled when env=0');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', 'true', () => {
  eq(notification.isPulseDisabled(), false, 'notification: only "1" disables (string "true" does not)');
});

// stop-notify.js — CLAUDE_STOP_PULSE_DISABLED (separate namespace)
withEnv('CLAUDE_STOP_PULSE_DISABLED', undefined, () => {
  eq(stopNotify.isPulseDisabled(), false, 'stop: pulse enabled when env unset');
});
withEnv('CLAUDE_STOP_PULSE_DISABLED', '1', () => {
  eq(stopNotify.isPulseDisabled(), true, 'stop: pulse disabled when env=1');
});

// stop-notify must NOT react to CLAUDE_NOTIFY_PULSE_DISABLED (independent namespace)
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  withEnv('CLAUDE_STOP_PULSE_DISABLED', undefined, () => {
    eq(stopNotify.isPulseDisabled(), false, 'stop: ignores CLAUDE_NOTIFY_PULSE_DISABLED');
  });
});

// bash-permission-alert.js shares CLAUDE_NOTIFY_PULSE_DISABLED with notification-alert
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', undefined, () => {
  eq(bashPermission.isPulseDisabled(), false, 'bash: pulse enabled when env unset');
});
withEnv('CLAUDE_NOTIFY_PULSE_DISABLED', '1', () => {
  eq(bashPermission.isPulseDisabled(), true, 'bash: pulse disabled when CLAUDE_NOTIFY_PULSE_DISABLED=1 (shared namespace)');
});

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
