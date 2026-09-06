/**
 * Closed list of Node.js built-ins. A package with the same name
 * (e.g. someone publishing a `path` shim) would be hidden — that is
 * the right trade since the user almost never installs over a
 * built-in name in practice and the false negative cost is small.
 *
 * The `node:` prefix is handled separately by stripping the prefix
 * before this lookup.
 */
export const NODE_BUILTINS = new Set<string>([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

export const NODE_PROTOCOL_ONLY_BUILTINS = new Set<string>([
  'sea',
  'sqlite',
  'test',
  'test/reporters',
]);
