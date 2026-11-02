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
/** A path (`src/app`, `./util.ts`) or a name ending in a source or data file extension (`main.py`). */
const PATH_LIKE = /^[\w.@~+-]*[\w.@~+-][/\\][\w.@~+/\\-]*$/u;
const NAMED_FILE = /^[\w.@~+-]+\.([A-Za-z][A-Za-z0-9]{0,7})$/u;
/** Not every dotted word is a file: `console.log` or `JSON.parse` stay searches. */
const FILE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'ipynb', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'swift', 'php', 'sh', 'bash', 'zsh', 'sql', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'md', 'mdx', 'txt',
  'html', 'htm', 'css', 'scss', 'vue', 'svelte', 'http', 'env', 'ini', 'lock', 'parquet',
]);

function looksLikeFile(query: string): boolean {
  if (/\s/u.test(query) || !/[A-Za-z]/u.test(query)) return false;
  if (PATH_LIKE.test(query)) return true;
  const extension = NAMED_FILE.exec(query)?.[1];
  return extension !== undefined && FILE_EXTENSIONS.has(extension.toLowerCase());
}

export function detectPaletteIntent(raw: string): PaletteIntent {
  const query = raw.trim();
  if (query.startsWith(FORCE_COMMAND)) return { kind: 'command', query: query.slice(1).trim() };
  if (query.length === 0) return { kind: 'command', query };
  if (looksLikeFile(query)) return { kind: 'file', query };
  const words = query.split(/\s+/u);
  const first = words[0]!.toLowerCase().replace(/^¿/u, '');
  const asks = query.endsWith('?') ? words.length >= 2 : words.length >= 3 && QUESTION_WORDS.has(first);
  return asks ? { kind: 'question', query } : { kind: 'command', query };
}
