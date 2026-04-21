/**
 * Thin wrapper around `navigator.clipboard.writeText` so components can
 * mock clipboard writes in tests without touching the global. Returns a
 * boolean instead of throwing — clipboard writes can fail on insecure
 * contexts, inside iframes without permission, or when focus isn't on
 * the document. The caller decides whether to surface a notice.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      return false;
    }
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
