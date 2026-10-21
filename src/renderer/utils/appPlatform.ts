/**
 * Which shell the renderer runs in. The desktop preload exposes the OS
 * (`darwin`, `win32`, `linux`) as `window.lingua.platform`, never the
 * literal `desktop`, so only the web adapter's `web` value is checked.
 */
export function appPlatform(): 'desktop' | 'web' {
  if (typeof window === 'undefined' || !window.lingua) return 'web';
  return window.lingua.platform === 'web' ? 'web' : 'desktop';
}
