/** `text` cut to `max` UTF-16 units with an ellipsis, never splitting a surrogate pair. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end -= 1;
  return `${text.slice(0, end)}…`;
}
