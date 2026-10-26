/**
 * Chromium switches that keep an automated Electron run off the OS credential
 * store. safeStorage otherwise reads the real keychain, and a changed Electron
 * binary makes macOS block the main process on an access prompt.
 */
export function isolatedCredentialStoreArgs(platform = process.platform) {
  if (platform === 'darwin') return ['--use-mock-keychain'];
  if (platform === 'linux') return ['--password-store=basic'];
  return [];
}
