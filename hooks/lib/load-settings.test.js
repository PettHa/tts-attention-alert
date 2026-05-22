'use strict';

// Unit tests for load-settings.js.
// Run with: node load-settings.test.js
// Exits 0 on success, 1 on any failed assertion.
//
// Strategy: each test writes a temp settings.json, points the loader
// there via HOME override (the loader resolves the file via
// process.env.HOME || USERPROFILE || /tmp), resets the loader cache,
// and runs the assertion.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Set up a sandbox HOME dir BEFORE requiring load-settings, so the
// loader resolves SETTINGS_PATH to our temp location.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'load-settings-test-'));
const ORIG_HOME = process.env.HOME;
const ORIG_USERPROFILE = process.env.USERPROFILE;
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
fs.mkdirSync(path.join(SANDBOX, '.claude'), { recursive: true });
const SETTINGS_FILE = path.join(SANDBOX, '.claude', 'settings.json');

const { readClaudeEnv, _resetCacheForTests } = require('./load-settings');

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

function writeSettings(envObj) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ env: envObj }, null, 2));
  _resetCacheForTests();
}

function deleteSettings() {
  try { fs.unlinkSync(SETTINGS_FILE); } catch {}
  _resetCacheForTests();
}

function withProcEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// 1. settings.json value returned when present
writeSettings({ TEST_KEY_A: '1' });
withProcEnv('TEST_KEY_A', undefined, () => {
  eq(readClaudeEnv('TEST_KEY_A'), '1', 'settings.json value returned when present');
});

// 2. process.env value returned when key absent from settings.json
writeSettings({ OTHER_KEY: '1' });
withProcEnv('TEST_KEY_B', 'env-value', () => {
  eq(readClaudeEnv('TEST_KEY_B'), 'env-value', 'process.env fallback when key absent from settings.json');
});

// 3. process.env value returned when settings.json missing
deleteSettings();
withProcEnv('TEST_KEY_C', 'fallback', () => {
  eq(readClaudeEnv('TEST_KEY_C'), 'fallback', 'process.env fallback when settings.json missing');
});

// 4. process.env value returned when settings.json unparseable
fs.writeFileSync(SETTINGS_FILE, '{ not valid json');
_resetCacheForTests();
withProcEnv('TEST_KEY_D', 'fallback2', () => {
  eq(readClaudeEnv('TEST_KEY_D'), 'fallback2', 'process.env fallback when settings.json malformed');
});

// 5. settings.json wins over process.env (the live-mute scenario)
writeSettings({ TEST_KEY_E: '1' });
withProcEnv('TEST_KEY_E', '0', () => {
  eq(readClaudeEnv('TEST_KEY_E'), '1', 'settings.json wins over process.env');
});

// 6. Empty string in settings.json falls through to process.env
writeSettings({ TEST_KEY_F: '' });
withProcEnv('TEST_KEY_F', 'real-value', () => {
  eq(readClaudeEnv('TEST_KEY_F'), 'real-value', 'empty string in settings.json falls through to process.env');
});

// 7. Cache: same value returned across reads within one fire (no re-read of file)
writeSettings({ TEST_KEY_G: 'first' });
const first = readClaudeEnv('TEST_KEY_G');
// Mutate the file but DON'T reset cache — loader should not re-read
fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ env: { TEST_KEY_G: 'second' } }, null, 2));
const second = readClaudeEnv('TEST_KEY_G');
eq(first, 'first', 'cache: first read returned first value');
eq(second, 'first', 'cache: second read after file mutation still returns first value (cached per fire)');

// 8. settings.json with no env block at all -> falls through to process.env
fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ permissions: {} }, null, 2));
_resetCacheForTests();
withProcEnv('TEST_KEY_H', 'fallback3', () => {
  eq(readClaudeEnv('TEST_KEY_H'), 'fallback3', 'no env block -> falls through to process.env');
});

// Restore HOME for any subsequent processes
process.env.HOME = ORIG_HOME;
if (ORIG_USERPROFILE === undefined) delete process.env.USERPROFILE;
else process.env.USERPROFILE = ORIG_USERPROFILE;
// Best-effort sandbox cleanup
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
