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
