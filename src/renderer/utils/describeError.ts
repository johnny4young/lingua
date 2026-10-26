const ERROR_NAME = /^\s*([A-Z][A-Za-z]*(?:Error|Exception))\b:?\s*/;

/** The error's name, from the message or the first stack line, and the message with that name in front. */
export function describeError(error: { message: string; stack?: string }): { name: string | null; text: string; full: string } {
  const inMessage = ERROR_NAME.exec(error.message);
  if (inMessage) return { name: inMessage[1]!, text: error.message.slice(inMessage[0].length), full: error.message };
  const name = ERROR_NAME.exec(error.stack?.split('\n')[0] ?? '')?.[1] ?? null;
  return { name, text: error.message, full: name ? `${name}: ${error.message}` : error.message };
}
