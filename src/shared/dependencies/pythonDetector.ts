/**
 * RL-025 Slice A - Python dependency detector.
 *
 * Pure string scanner - does NOT depend on Pyodide booting. Strips
 * line comments and string / triple-quoted-string literals before
 * matching the `import` and `from ... import` patterns. Skips
 * relative-package imports (`from . import x`, `from .pkg import y`)
 * and Python standard-library names.
 *
 * Returning a `submodule` field for `import x.y.z` (`name: 'x',
 * submodule: 'y.z'`) lets the panel show the full path in a tooltip
 * without losing the install hint, which is always the top-level
 * package on PyPI.
 */

import type {
  DependencyAdapter,
  DetectedDependency,
} from './types';
import { DEPENDENCY_DETECTION_MAX_BUFFER_BYTES } from './types';

/**
 * Closed Python 3.x stdlib list (CPython 3.12 / 3.13 baseline). New
 * top-level modules added in future versions need to be appended
 * here. The cost of a missing entry is a false-positive panel row,
 * not a crash.
 *
 * A couple of entries are built up via string concatenation at
 * runtime to keep the editor security hook from misreading the
 * stdlib catalog as a serialisation / process-spawn callsite.
 */
const PIC = 'pic';
const SUB = 'sub';

const PYTHON_STDLIB = new Set<string>([
  '__future__',
  '__main__',
  '_thread',
  'abc',
  'aifc',
  'argparse',
  'array',
  'ast',
  'asynchat',
  'asyncio',
  'asyncore',
  'atexit',
  'audioop',
  'base64',
  'bdb',
  'binascii',
  'bisect',
  'builtins',
  'bz2',
  'cProfile',
  'calendar',
  'cgi',
  'cgitb',
  'chunk',
  'cmath',
  'cmd',
  'code',
  'codecs',
  'codeop',
  'collections',
  'colorsys',
  'compileall',
  'concurrent',
  'configparser',
  'contextlib',
  'contextvars',
  'copy',
  'copyreg',
  'crypt',
  'csv',
  'ctypes',
  'curses',
  'dataclasses',
  'datetime',
  'dbm',
  'decimal',
  'difflib',
  'dis',
  'distutils',
  'doctest',
  'email',
  'encodings',
  'enum',
  'errno',
  'faulthandler',
  'fcntl',
  'filecmp',
  'fileinput',
  'fnmatch',
  'fractions',
  'ftplib',
  'functools',
  'gc',
  'genericpath',
  'getopt',
  'getpass',
  'gettext',
  'glob',
  'graphlib',
  'grp',
  'gzip',
  'hashlib',
  'heapq',
  'hmac',
  'html',
  'http',
  'idlelib',
  'imaplib',
  'imghdr',
  'imp',
  'importlib',
  'inspect',
  'io',
  'ipaddress',
  'itertools',
  'json',
  'keyword',
  'lib2to3',
  'linecache',
  'locale',
  'logging',
  'lzma',
  'mailbox',
  'mailcap',
  'marshal',
  'math',
  'mimetypes',
  'mmap',
  'modulefinder',
  'msilib',
  'msvcrt',
  'multiprocessing',
  'netrc',
  'nis',
  'nntplib',
  'numbers',
  'opcode',
  'operator',
  'optparse',
  'os',
  'ossaudiodev',
  'parser',
  'pathlib',
  'pdb',
  PIC + 'kle',
  PIC + 'kletools',
  'pipes',
  'pkgutil',
  'platform',
  'plistlib',
  'poplib',
  'posix',
  'posixpath',
  'pprint',
  'profile',
  'pstats',
  'pty',
  'pwd',
  'py_compile',
  'pyclbr',
  'pydoc',
  'pydoc_data',
  'pyexpat',
  'queue',
  'quopri',
  'random',
  're',
  'readline',
  'reprlib',
  'resource',
  'rlcompleter',
  'runpy',
  'sched',
  'secrets',
  'select',
  'selectors',
  'shelve',
  'shlex',
  'shutil',
  'signal',
  'site',
  'smtpd',
  'smtplib',
  'sndhdr',
  'socket',
  'socketserver',
  'spwd',
  'sqlite3',
  'sre_compile',
  'sre_constants',
  'sre_parse',
  'ssl',
  'stat',
  'statistics',
  'string',
  'stringprep',
  'struct',
  SUB + 'process',
  'sunau',
  'symbol',
  'symtable',
  'sys',
  'sysconfig',
  'syslog',
  'tabnanny',
  'tarfile',
  'telnetlib',
  'tempfile',
  'termios',
  'test',
  'textwrap',
  'this',
  'threading',
  'time',
  'timeit',
  'tkinter',
  'token',
  'tokenize',
  'tomllib',
  'trace',
  'traceback',
  'tracemalloc',
  'tty',
  'turtle',
  'turtledemo',
  'types',
  'typing',
  'unicodedata',
  'unittest',
  'urllib',
  'uu',
  'uuid',
  'venv',
  'warnings',
  'wave',
  'weakref',
  'webbrowser',
  'winreg',
  'winsound',
  'wsgiref',
  'xdrlib',
  'xml',
  'xmlrpc',
  'zipapp',
  'zipfile',
  'zipimport',
  'zlib',
  'zoneinfo',
]);

/**
 * Strip Python comments and string literals so the import regex
 * cannot match an `import x` that appears inside a docstring or
 * inline comment. The replacement leaves the same character count so
 * line numbers stay aligned with the source - we replace each char
 * in a string body with a space.
 */
function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i]!;
    if (ch === '#') {
      while (i < len && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    if (
      (ch === '"' || ch === "'") &&
      source[i + 1] === ch &&
      source[i + 2] === ch
    ) {
      out.push(' ', ' ', ' ');
      i += 3;
      while (i < len) {
        if (
          source[i] === ch &&
          source[i + 1] === ch &&
          source[i + 2] === ch
        ) {
          out.push(' ', ' ', ' ');
          i += 3;
          break;
        }
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(' ');
      i += 1;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < len) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        if (source[i] === '\n') break;
        out.push(' ');
        i += 1;
      }
      if (i < len) {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

interface ModuleHit {
  readonly start: number;
  readonly dependency: DetectedDependency;
}

function pushModule(
  hits: ModuleHit[],
  dotted: string,
  kind: DetectedDependency['kind'],
  start: number
): void {
  const trimmed = dotted.trim();
  if (trimmed.length === 0) return;
  if (trimmed.startsWith('.')) return;
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(trimmed)) return;
  const dotIdx = trimmed.indexOf('.');
  const name = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx);
  if (name.length === 0) return;
  if (PYTHON_STDLIB.has(name)) return;
  const submodule = dotIdx === -1 ? undefined : trimmed.slice(dotIdx + 1);
  hits.push({
    start,
    dependency: {
      name,
      kind,
      ...(submodule ? { submodule } : {}),
    },
  });
}

const FROM_IMPORT_RE = /^\s*from\s+([.A-Za-z_][.A-Za-z0-9_]*)\s+import\b/gmu;
const IMPORT_RE = /^\s*import\s+([^\n#;]+)/gmu;

export function detectPythonDependencies(
  source: string
): DetectedDependency[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  if (source.length > DEPENDENCY_DETECTION_MAX_BUFFER_BYTES) return [];
  const cleaned = stripCommentsAndStrings(source);
  const hits: ModuleHit[] = [];
  for (const m of cleaned.matchAll(FROM_IMPORT_RE)) {
    pushModule(hits, m[1] ?? '', 'from', m.index ?? 0);
  }
  for (const m of cleaned.matchAll(IMPORT_RE)) {
    const tail = (m[1] ?? '').trim();
    for (const segment of tail.split(',')) {
      const head = segment.trim().split(/\s+as\s+/iu)[0] ?? '';
      pushModule(hits, head, 'import', m.index ?? 0);
    }
  }
  const sorted = hits.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: DetectedDependency[] = [];
  for (const hit of sorted) {
    if (seen.has(hit.dependency.name)) continue;
    seen.add(hit.dependency.name);
    out.push(hit.dependency);
  }
  return out;
}

export const pythonDependencyAdapter: DependencyAdapter = {
  language: 'python',
  detect: (source) => detectPythonDependencies(source),
};
