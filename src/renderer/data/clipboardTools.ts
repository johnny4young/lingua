import type { UtilitySuggestionId } from '../clipboard/pasteHandlers';
import type { DeveloperUtilityId } from './developerUtilityCatalog';

/** The tools marked for each kind; a JWT's segments are Base64 too. */
export const CLIPBOARD_TOOLS: Record<UtilitySuggestionId, readonly DeveloperUtilityId[]> = {
  jwt: ['jwt', 'base64'],
  uuid: ['uuid'],
  color: ['color'],
  timestamp: ['timestamp'],
  'cron-parser': ['cron-parser'],
  base64: ['base64'],
  json: ['json'],
};

/** Tools that take any text, after the kind's own tool. */
const TEXT_TOOLS: readonly DeveloperUtilityId[] = ['hash', 'base64', 'string-inspector', 'url', 'qr-code'];

/** The tools the launcher lists for a clipboard of this kind: its own tool first, then the text tools. */
export function clipboardGroup(kind: UtilitySuggestionId): DeveloperUtilityId[] {
  const [own, ...rest] = CLIPBOARD_TOOLS[kind];
  return [...new Set([...(own ? [own] : []), ...TEXT_TOOLS, ...rest])];
}
