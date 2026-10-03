/**
 * Split a native subprocess stream into console rows. Only the empty entry a
 * trailing newline produces is dropped; blank lines inside the output stay so
 * rows match what the program printed.
 */
export function splitOutputLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}
