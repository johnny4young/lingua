/** What the command palette guesses a query is; `!` first always means a command. */
export type PaletteIntent =
  | { kind: 'command'; query: string }
  | { kind: 'file'; query: string }
  | { kind: 'question'; query: string };

const FORCE_COMMAND = '!';
const QUESTION_WORDS = new Set([
  'why', 'how', 'what', "what's", 'whats', 'when', 'where', 'which', 'who', 'is', 'are', 'does', 'do', 'did', 'can',
  'could', 'should', 'would', 'will', 'explain',
  'por', 'porqué', 'cómo', 'como', 'qué', 'que', 'cuándo', 'cuando', 'dónde', 'donde', 'cuál', 'cuáles', 'quién',
  'explica', 'explícame', 'puedo', 'debo',
]);
/** A path, or a name with an extension: `main.py`, `src/app`, `./util.ts`. */
const FILE_LIKE = /^[\w.@~+-]*(?:[\w.@~+-][/\\][\w.@~+/\\-]*|\.[A-Za-z][A-Za-z0-9]{0,7})$/u;

export function detectPaletteIntent(raw: string): PaletteIntent {
  const query = raw.trim();
  if (query.startsWith(FORCE_COMMAND)) return { kind: 'command', query: query.slice(1).trim() };
  if (query.length === 0) return { kind: 'command', query };
  if (!/\s/u.test(query) && FILE_LIKE.test(query) && /[A-Za-z]/u.test(query)) return { kind: 'file', query };
  const words = query.split(/\s+/u);
  const first = words[0]!.toLowerCase().replace(/^¿/u, '');
  const asks = query.endsWith('?') ? words.length >= 2 : words.length >= 3 && QUESTION_WORDS.has(first);
  return asks ? { kind: 'question', query } : { kind: 'command', query };
}
