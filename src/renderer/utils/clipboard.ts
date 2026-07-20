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

/**
 * implementation — read the clipboard once. Returns null on missing
 * permission, missing API, empty contents, or any other failure. Never
 * throws — callers treat null as "no clipboard content available" and
 * stay silent rather than nagging the user with a permission prompt.
 *
 * The function is intentionally NOT cached — every focus event reads
 * fresh so a paste between focus events is observed. There is no
 * background polling — the caller decides when to invoke this.
 */
export async function readFromClipboard(): Promise<string | null> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.readText !== 'function') {
      return null;
    }
    const value = await clipboard.readText();
    if (typeof value !== 'string' || value.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}
