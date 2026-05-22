'use strict';

const { readClaudeEnv } = require('./load-settings');

/**
 * Build a PowerShell snippet that pauses any active media-transport
 * session (Spotify, YouTube, VLC, podcast apps — anything that
 * implements Windows' SMTC contract), runs the inner action, then
 * resumes playback. Idempotent and silent if no media is playing.
 *
 * The escape '\`1' is intentional — the embedded PowerShell needs the
 * literal IAsyncOperation`1 (backtick-1 is .NET generic-arity notation).
 *
 * env: CLAUDE_NOTIFY_DUCK_DISABLED=1 skips ducking entirely.
 */
function buildDuckWrappedAction(innerActionLine) {
  if (String(readClaudeEnv('CLAUDE_NOTIFY_DUCK_DISABLED') || '').toLowerCase() === '1') {
    return innerActionLine;
  }
  return [
    `try { Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop } catch { }`,
    `$duckSession = $null`,
    `try {`,
    `  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null`,
    `  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]`,
    `  $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()`,
    `  $t = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($op))`,
    `  $t.Wait(800) | Out-Null`,
    `  $mgr = $t.Result`,
    `  $s = $mgr.GetCurrentSession()`,
    `  if ($s -and $s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {`,
    `    $pauseOp = $s.TryPauseAsync()`,
    `    $pt = $asTask.MakeGenericMethod([bool]).Invoke($null, @($pauseOp))`,
    `    $pt.Wait(500) | Out-Null`,
    `    $duckSession = $s`,
    `  }`,
    `} catch { }`,
    innerActionLine,
    `if ($duckSession) {`,
    `  try {`,
    `    $resumeOp = $duckSession.TryPlayAsync()`,
    `    $rt = $asTask.MakeGenericMethod([bool]).Invoke($null, @($resumeOp))`,
    `    $rt.Wait(500) | Out-Null`,
    `  } catch { }`,
    `}`,
  ].join('; ');
}

module.exports = { buildDuckWrappedAction };
