import type { LineResult } from '../stores/resultStore';

/** Hide baseline undefined output without erasing an explicitly pinned watch. */
export function isHiddenUndefinedLineResult(result: LineResult): boolean {
  if (result.type === 'watch') return false;
  if (result.type === 'autoLog' && result.value === 'undefined') return true;
  return result.type === 'result' && result.value === 'undefined';
}
