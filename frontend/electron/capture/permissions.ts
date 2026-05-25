/**
 * ARKI Capture Engine — Permission Manager
 *
 * Abstracts macOS screen-recording permission checks behind a uniform API.
 * Windows and Linux always return 'granted' — desktopCapturer works there
 * without an explicit OS-level permission dialog.
 */

import { systemPreferences, shell } from 'electron';
import { CaptureError, type PermissionStatus } from './types';

export class PermissionManager {
  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns the current screen-recording permission status for the running OS.
   *
   * macOS: queries TCC (Transparency, Consent, and Control) via
   *        systemPreferences.getMediaAccessStatus('screen').
   * Windows / Linux: desktopCapturer requires no OS-level grant, so we
   *                  return 'granted' immediately.
   */
  async check(): Promise<PermissionStatus> {
    try {
      if (process.platform === 'darwin') {
        const raw = systemPreferences.getMediaAccessStatus('screen');
        return raw as PermissionStatus;
      }

      if (process.platform === 'win32') {
        // WASAPI screen capture is available without explicit permission.
        return 'granted';
      }

      // Linux (X11 + Wayland via PipeWire): no discrete permission gate.
      return 'granted';
    } catch (err) {
      console.error('[PermissionManager] check() threw:', err);
      return 'unknown';
    }
  }

  /**
   * Attempts to trigger a permission prompt or opens the OS settings page.
   *
   * macOS: opens System Settings → Privacy → Screen Recording.
   *        (There is no programmatic way to show the TCC prompt directly for
   *         screen recording — the user must toggle the switch manually.)
   * Other platforms: no-op.
   */
  async request(): Promise<void> {
    if (process.platform === 'darwin') {
      console.log(
        '[PermissionManager] Opening macOS Screen Recording privacy pane. ' +
        'User must grant access manually.'
      );
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
      return;
    }

    if (process.platform === 'win32') {
      console.log(
        '[PermissionManager] Windows does not require screen recording permission. ' +
        'No action taken.'
      );
      return;
    }

    // Linux
    console.log(
      '[PermissionManager] Linux does not require screen recording permission. ' +
      'No action taken.'
    );
  }

  /**
   * Asserts that screen recording is permitted, throwing a CaptureError if not.
   *
   * On macOS:
   *   - 'denied' | 'restricted' → throws CaptureError (not recoverable by retry)
   *   - 'unknown'               → throws CaptureError (recoverable: user can fix)
   *   - 'granted' | 'not-determined' → no-op
   *
   * On Windows / Linux: always passes through (permission is implicit).
   */
  async assert(): Promise<void> {
    if (process.platform !== 'darwin') {
      return; // No gate on Windows / Linux.
    }

    const status = await this.check();

    switch (status) {
      case 'denied':
        throw new CaptureError(
          'PERMISSION_DENIED',
          'Screen recording permission is denied. ' +
          'Open System Settings → Privacy & Security → Screen Recording and ' +
          'enable the toggle for this application.',
          false // Not recoverable without user action in Settings.
        );

      case 'restricted':
        throw new CaptureError(
          'PERMISSION_DENIED',
          'Screen recording is restricted by a system policy (MDM or parental controls). ' +
          'Contact your system administrator.',
          false
        );

      case 'unknown':
        throw new CaptureError(
          'PERMISSION_UNKNOWN',
          'Could not determine screen recording permission status. ' +
          'Try restarting the application or checking System Settings → Privacy.',
          true // Recoverable: may resolve on next launch or after settings change.
        );

      case 'granted':
      case 'not-determined':
        // 'not-determined' means the TCC prompt has not been shown yet.
        // desktopCapturer will trigger it on the first actual capture attempt.
        break;
    }
  }

  // ── User-facing messages ──────────────────────────────────────────────────

  /**
   * Maps a PermissionStatus to a short, human-readable message suitable for
   * display in a tooltip, alert dialog, or settings panel.
   */
  statusToUserMessage(status: PermissionStatus): string {
    switch (status) {
      case 'granted':
        return 'Screen recording permission granted.';

      case 'denied':
        return (
          'Screen recording permission denied. ' +
          'Please enable it in System Preferences → Privacy → Screen Recording.'
        );

      case 'not-determined':
        return (
          'Screen recording permission not yet requested. ' +
          'Please grant access when prompted.'
        );

      case 'restricted':
        return (
          'Screen recording is restricted by system policy ' +
          '(MDM/parental controls).'
        );

      case 'unknown':
        return 'Could not determine screen recording permission status.';
    }
  }
}
