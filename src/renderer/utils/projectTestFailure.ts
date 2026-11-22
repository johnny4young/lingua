import { truncateText } from '../../shared/truncateText';

const HEADLINE_LIMIT = 120;

/** First meaningful line of the runner message, without the error class or a `file:line:` prefix. */
export function projectTestFailureHeadline(message: string | undefined): string | null {
  const line = (message ?? '').split('\n').map(text => text.trim()).find(Boolean);
  if (!line) return null;
  const headline = line.replace(/^(?:\w*Error:\s*)/u, '').replace(/^[\w./-]+\.\w+:\d+:\s*/u, '').trim();
  return truncateText(headline, HEADLINE_LIMIT);
}
