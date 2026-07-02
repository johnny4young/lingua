/**
 * F-1 — Go / Rust / Ruby dependency detection + install-command planning.
 *
 * The existing `DependencyAdapter` registry (`registry.ts`) is a closed
 * enum scoped to JS/TS/Python and coupled to telemetry parity. Go, Rust,
 * and Ruby detection lives here as a separate, pure, self-contained module
 * so it can be tested in isolation and wired into the desktop install lane
 * later without churning that enum.
 *
 * Everything here is pure and dependency-free:
 *   - `detectGoImports` / `detectRustCrates` / `detectRubyGems` extract the
 *     third-party specifiers a user would install, filtering out the
 *     standard library and language built-ins.
 *   - `buildInstallCommand` turns detected specifiers into the exact
 *     `{ binary, args }` a desktop runner would spawn (no shell, argv only)
 *     — the shape the RL-025 install lane consumes.
 *
 * Running the install (spawning `go get` / `cargo add` / `bundle add`)
 * needs the host toolchain and network, so it belongs to a desktop slice;
 * this module is the toolchain-independent, unit-tested foundation.
 */

export type NativePackageLanguage = 'go' | 'rust' | 'ruby';

/** Dedupe preserving first-seen order. */
function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * Go: a third-party import path always has a dotted domain in its first
 * segment (`github.com/...`, `golang.org/x/...`, `gopkg.in/...`). Standard
 * library packages (`fmt`, `net/http`, `encoding/json`) never do, so the
 * "first segment contains a dot" test cleanly separates them. The returned
 * value is the MODULE path a user would `go get` — for a hosted repo that
 * is the first three segments (`host/org/repo`); deeper segments are the
 * package within the module.
 */
export function detectGoImports(source: string): string[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  const paths: string[] = [];
  const push = (raw: string) => {
    const path = raw.trim();
    if (path.length === 0) return;
    const firstSegment = path.split('/')[0] ?? '';
    if (!firstSegment.includes('.')) return; // stdlib
    const segments = path.split('/');
    // Hosted modules are host/org/repo; keep at most three segments as the
    // installable module path. Non-hosted (single dotted host) keep as-is.
    paths.push(segments.length >= 3 ? segments.slice(0, 3).join('/') : path);
  };

  // Grouped: import ( "a"\n "b/c" )
  const groupRe = /import\s*\(([\s\S]*?)\)/g;
  let group: RegExpExecArray | null;
  while ((group = groupRe.exec(source)) !== null) {
    const body = group[1] ?? '';
    const lineRe = /(?:[A-Za-z_.]\w*\s+)?"([^"]+)"/g;
    let line: RegExpExecArray | null;
    while ((line = lineRe.exec(body)) !== null) push(line[1] ?? '');
  }
  // Single-line: import "a" or import alias "a"
  const singleRe = /import\s+(?:[A-Za-z_.]\w*\s+)?"([^"]+)"/g;
  let single: RegExpExecArray | null;
  while ((single = singleRe.exec(source)) !== null) push(single[1] ?? '');

  return unique(paths);
}

const RUST_BUILTIN_ROOTS = new Set(['std', 'core', 'alloc', 'crate', 'self', 'super']);

/**
 * Rust: `use foo::bar;` and `extern crate foo;` reference the crate `foo`.
 * Crate names use underscores in code but hyphens on crates.io; both are
 * accepted by `cargo add`, so we return the identifier as written. Built-in
 * roots (`std`, `core`, `crate`, `self`, `super`, `alloc`) are filtered.
 */
export function detectRustCrates(source: string): string[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  const crates: string[] = [];
  const consider = (name: string) => {
    if (name.length === 0 || RUST_BUILTIN_ROOTS.has(name)) return;
    crates.push(name);
  };
  const externRe = /extern\s+crate\s+([A-Za-z_]\w*)/g;
  let ext: RegExpExecArray | null;
  while ((ext = externRe.exec(source)) !== null) consider(ext[1] ?? '');
  // `use foo::...;` — take the first path segment as the crate root.
  const useRe = /\buse\s+([A-Za-z_]\w*)\s*(?:::|;)/g;
  let use: RegExpExecArray | null;
  while ((use = useRe.exec(source)) !== null) consider(use[1] ?? '');
  return unique(crates);
}

// Ruby standard-library-ish requires that ship with the interpreter and
// should not be surfaced as installable gems.
const RUBY_STDLIB = new Set([
  'json', 'date', 'time', 'set', 'securerandom', 'digest', 'base64', 'uri',
  'net/http', 'openssl', 'fileutils', 'pathname', 'logger', 'csv', 'yaml',
  'erb', 'ostruct', 'stringio', 'tempfile', 'benchmark', 'optparse', 'pp',
]);

/**
 * Ruby: `require 'x'` / `require_relative` (skipped) and Bundler `gem 'x'`
 * declarations. Standard-library requires are filtered so only installable
 * gems remain. The gem name is the first path segment (`active_support/all`
 * → `active_support`, though the gem is `activesupport` — kept as-written
 * since Bundler resolves either for many gems and the user can adjust).
 */
export function detectRubyGems(source: string): string[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  const gems: string[] = [];
  const consider = (raw: string) => {
    const spec = raw.trim();
    if (spec.length === 0 || RUBY_STDLIB.has(spec)) return;
    gems.push(spec.split('/')[0] ?? spec);
  };
  // gem 'name' (Gemfile / inline bundler)
  const gemRe = /\bgem\s+['"]([^'"]+)['"]/g;
  let gem: RegExpExecArray | null;
  while ((gem = gemRe.exec(source)) !== null) consider(gem[1] ?? '');
  // require 'name' (not require_relative)
  const requireRe = /\brequire\s+['"]([^'"]+)['"]/g;
  let req: RegExpExecArray | null;
  while ((req = requireRe.exec(source)) !== null) consider(req[1] ?? '');
  return unique(gems);
}

export function detectNativeDependencies(
  language: NativePackageLanguage,
  source: string
): string[] {
  switch (language) {
    case 'go':
      return detectGoImports(source);
    case 'rust':
      return detectRustCrates(source);
    case 'ruby':
      return detectRubyGems(source);
    default: {
      const _exhaustive: never = language;
      void _exhaustive;
      return [];
    }
  }
}

export interface InstallCommand {
  binary: string;
  args: string[];
}

/**
 * Build the argv a desktop runner would spawn (no shell) to install the
 * given specifiers. Returns `null` for an empty specifier list or an
 * unknown language. Specifiers are validated to reject anything that is
 * not a plausible package path (defense in depth before argv assembly).
 */
export function buildInstallCommand(
  language: NativePackageLanguage,
  specifiers: readonly string[]
): InstallCommand | null {
  const safe = specifiers
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0 && /^[A-Za-z0-9._/@-]+$/.test(s));
  if (safe.length === 0) return null;

  switch (language) {
    case 'go':
      return { binary: 'go', args: ['get', ...safe] };
    case 'rust':
      return { binary: 'cargo', args: ['add', ...safe] };
    case 'ruby':
      return { binary: 'bundle', args: ['add', ...safe] };
    default: {
      const _exhaustive: never = language;
      void _exhaustive;
      return null;
    }
  }
}
