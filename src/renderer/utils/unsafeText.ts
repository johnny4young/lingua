// Control and format characters (bidi, zero-width, C0/C1) and line separators would reorder, hide or break the text around them.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** Program output made safe to show in the editor or write into the source: each unsafe character becomes a space. */
export function replaceUnsafeText(text: string): string {
  return text.replace(UNSAFE_TEXT, ' ');
}
