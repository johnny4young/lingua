const ERROR_NAME = /^\s*([A-Z][A-Za-z]*(?:Error|Exception))\b:?\s*/;

/** The error's name, from the message or the first stack line, and the message with that name in front. */
export function describeError(error: { message: string; stack?: string }): { name: string | null; text: string; full: string } {
  const inMessage = ERROR_NAME.exec(error.message);
  if (inMessage) return { name: inMessage[1]!, text: error.message.slice(inMessage[0].length), full: error.message };
  const name = ERROR_NAME.exec(error.stack?.split('\n')[0] ?? '')?.[1] ?? null;
  return { name, text: error.message, full: name ? `${name}: ${error.message}` : error.message };
}

const TRAILING_ERROR_NAME = /^\s*(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*(?:Error|Exception|Interrupt|Exit))\b/;

/** `KeyError` from a traceback's last line or `TypeError` from a JS message; null when none reads as one. */
export function errorNameOf(text: string | undefined): string | null {
  if (!text) return null;
  const lines = text.slice(-4000).split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = TRAILING_ERROR_NAME.exec(lines[index]!);
    if (match) return match[1]!.slice(0, 40);
  }
  return null;
}
