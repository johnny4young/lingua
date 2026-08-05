/**
 * Bundled-runtime dependency audit gate, pure logic.
 *
 * What this closes: `check:prod-audit` runs `pnpm audit --prod`, which only
 * inspects `dependencies`. But Vite BUNDLES the main and preload graphs, so a
 * package imported by `src/main/**` ships inside `.vite/build/main.js` whether
 * or not it is declared as a production dependency. Two such packages are
 * declared as devDependencies today:
 *
 *   - `undici`  — `src/main/httpProxy.ts`, the SSRF-guarded HTTP proxy
 *   - `ws`      — `src/main/httpWebSocket.ts`, the live WebSocket transport
 *
 * Both parse untrusted remote input inside the Node-privileged main process,
 * and both were invisible to the blocking production gate. `undici` sat on
 * 7.28.0 against an advisory requiring >= 7.29.0 with CI green the whole time.
 *
 * This module is the testable core of the second gate: derive the packages the
 * desktop bundles actually inline, then judge the FULL (dev-inclusive) audit
 * payload against that set. Anything outside the set stays advisory-only, so
 * the documented dev-tooling exceptions in docs/RELEASE_SECURITY.md (the
 * node-tar / ip-address chain under Electron Forge, sharp under Wrangler) do
 * not start red-CI-ing the repository.
 *
 * Scope: main + preload only. Those run with full OS privileges outside the
 * browser sandbox, which is what makes a shipped advisory there materially
 * different from one in the renderer graph.
 *
 * Mirrors the pure-lib + CLI + fixture-test shape of
 * `scripts/lib/prodAudit.mjs`, and reuses its severity vocabulary.
 */

import { SEVERITY_RANK, DEFAULT_AUDIT_LEVEL } from './prodAudit.mjs';

export { SEVERITY_RANK, DEFAULT_AUDIT_LEVEL };

const AUDIT_SEVERITIES = Object.freeze(Object.keys(SEVERITY_RANK));

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAuditSeverity(value) {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_RANK, value);
}

/**
 * Characters that end a value expression. A `/` following one of these is a
 * division operator, not the start of a regex literal.
 */
const VALUE_ENDING_CHARS = new Set([')', ']', '}', '"', "'", '`']);

/**
 * Remove comments from TypeScript/JavaScript source without touching string
 * or template contents.
 *
 * This matters more than it looks: `src/main/node-runner.ts` documents the
 * module-resolution walk with a JSDoc line containing `require('lodash')`. A
 * naive regex sweep reports lodash as a bundled dependency, which is both
 * wrong and the kind of false positive that trains people to ignore the gate.
 *
 * Handles single/double-quoted strings, template literals, line comments,
 * block comments, and regex literals (detected from the previous significant
 * character, the standard heuristic — a `/` after a value cannot start one).
 *
 * @param {string} source
 * @returns {string} the source with every comment replaced by a space
 */
export function stripComments(source) {
  let out = '';
  let index = 0;
  let previousSignificant = '';
  const length = source.length;

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') index += 1;
      out += ' ';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        // Preserve line structure so line-anchored patterns keep working.
        out += source[index] === '\n' ? '\n' : '';
        index += 1;
      }
      index += 2;
      out += ' ';
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      index += 1;
      while (index < length) {
        const inner = source[index];
        if (inner === '\\') {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += inner;
        index += 1;
        if (inner === quote) break;
      }
      previousSignificant = quote;
      continue;
    }

    // A `/` can only open a regex literal where a value cannot appear.
    if (
      char === '/' &&
      !VALUE_ENDING_CHARS.has(previousSignificant) &&
      !/[\w$]/u.test(previousSignificant)
    ) {
      out += char;
      index += 1;
      while (index < length) {
        const inner = source[index];
        if (inner === '\\') {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += inner;
        index += 1;
        if (inner === '/') break;
        if (inner === '\n') break;
      }
      previousSignificant = '/';
      continue;
    }

    out += char;
    if (!/\s/u.test(char)) previousSignificant = char;
    index += 1;
  }

  return out;
}

/**
 * `from '...'` covers every static import and re-export, including the
 * multi-line named-import form Prettier produces. Anchoring to the start of
 * the statement instead would miss those, and a missed import means a
 * silently narrower gate — the one failure direction that matters here.
 *
 * `from` cannot precede a string literal anywhere else in TypeScript:
 * `Array.from(` is followed by a parenthesis and `{ from: 'x' }` by a colon.
 */
const FROM_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]/gu;
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/gu;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;
const REQUIRE_CALL = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gu;

/** `import type {...} from 'x'` is erased before bundling, so it ships nothing. */
const TYPE_ONLY_CLAUSE = /\b(?:import|export)\s+type\b/u;
const TYPE_ONLY_LOOKBEHIND = 400;

function isTypeOnlyImport(code, matchIndex) {
  const start = Math.max(0, matchIndex - TYPE_ONLY_LOOKBEHIND);
  const clause = code.slice(start, matchIndex);
  // Only the nearest preceding import/export keyword governs this specifier.
  const keyword = Math.max(clause.lastIndexOf('import'), clause.lastIndexOf('export'));
  if (keyword === -1) return false;
  return TYPE_ONLY_CLAUSE.test(clause.slice(keyword));
}

/**
 * Every module specifier the source references at runtime, with comments and
 * type-only imports excluded.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function collectImportSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = [];
  for (const pattern of [FROM_SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (pattern === FROM_SPECIFIER && isTypeOnlyImport(code, match.index)) continue;
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Package name for a bare specifier, or null for a relative/absolute path, a
 * Node builtin, or a URL. `lodash/debounce` -> `lodash`;
 * `@scope/pkg/sub` -> `@scope/pkg`.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
export function toPackageName(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0) return null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(specifier)) return null;

  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (segments.length < 2) return null;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

/**
 * Package names the bundler must inline for these sources: every bare import
 * that is not a Node builtin and not declared external in the Vite config.
 *
 * @param {{ sources: string[], externals: Iterable<string> }} input
 * @returns {string[]} sorted, deduplicated
 */
export function collectBundledPackages({ sources, externals }) {
  const external = new Set(externals);
  const packages = new Set();
  for (const source of sources) {
    for (const specifier of collectImportSpecifiers(source)) {
      const name = toPackageName(specifier);
      if (name === null) continue;
      if (external.has(name)) continue;
      packages.add(name);
    }
  }
  return [...packages].sort();
}

/**
 * Transitive closure over runtime `dependencies`. A bundled package drags its
 * own dependency tree into the same output file, so auditing only the directly
 * imported names would leave the same class of hole one level down.
 *
 * @param {Iterable<string>} roots
 * @param {(name: string) => string[]} readDependencies Dependency names for a package, or [] when unresolvable.
 * @returns {string[]} sorted, deduplicated closure including the roots
 */
export function expandRuntimeClosure(roots, readDependencies) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop();
    if (typeof name !== 'string' || seen.has(name)) continue;
    seen.add(name);
    for (const dependency of readDependencies(name)) {
      if (!seen.has(dependency)) queue.push(dependency);
    }
  }
  return [...seen].sort();
}

/**
 * @typedef {Object} BundledAuditResult
 * @property {boolean} ok True when no bundled package carries an advisory at/above the threshold.
 * @property {string | null} error Named failure when the payload is unusable (`malformed`); null otherwise.
 * @property {string} level The threshold applied.
 * @property {{id:string,module:string,severity:string,title:string,url:string}[]} offending Worst-first.
 * @property {string[]} audited The bundled package closure this gate judged.
 */

function malformed(level, audited, message) {
  return { ok: false, error: 'malformed', level, offending: [], audited, message };
}

/**
 * Judge a parsed FULL `pnpm audit --json` payload, restricted to packages the
 * desktop bundles inline. Pure — no I/O, no process exit. Fail-closed on a
 * payload we cannot read, exactly like the production gate: a gate that cannot
 * see the graph must never report success.
 *
 * @param {unknown} audit Parsed JSON from `pnpm audit --json`.
 * @param {Iterable<string>} bundledPackages
 * @param {{ level?: string }} [options]
 * @returns {BundledAuditResult}
 */
export function evaluateBundledAudit(audit, bundledPackages, { level = DEFAULT_AUDIT_LEVEL } = {}) {
  const audited = [...bundledPackages].sort();
  const threshold = SEVERITY_RANK[level];

  if (threshold === undefined) {
    return malformed(
      level,
      audited,
      `Unknown audit level "${level}". Use one of: ${AUDIT_SEVERITIES.join(', ')}.`
    );
  }

  if (!isPlainRecord(audit) || !isPlainRecord(audit.advisories)) {
    return malformed(
      level,
      audited,
      'Audit payload has no advisories object; cannot verify the bundled graph.'
    );
  }

  if (audited.length === 0) {
    return malformed(
      level,
      audited,
      'No bundled packages were resolved; the scanner found nothing to audit, which means it is broken rather than clean.'
    );
  }

  const bundled = new Set(audited);
  const offending = [];

  for (const [id, advisory] of Object.entries(audit.advisories)) {
    if (!isPlainRecord(advisory)) {
      return malformed(level, audited, `Audit advisory ${id} is not an object.`);
    }
    const { severity } = advisory;
    if (!isAuditSeverity(severity)) {
      return malformed(
        level,
        audited,
        `Audit advisory ${id} has unknown severity ${JSON.stringify(severity)}.`
      );
    }
    const module = typeof advisory.module_name === 'string' ? advisory.module_name : '';
    if (!bundled.has(module)) continue;
    if (SEVERITY_RANK[severity] < threshold) continue;
    offending.push({
      id,
      module,
      severity,
      title: typeof advisory.title === 'string' ? advisory.title : '',
      url: typeof advisory.url === 'string' ? advisory.url : '',
    });
  }

  offending.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  return { ok: offending.length === 0, error: null, level, offending, audited };
}

/**
 * Human-facing failure report. Names the packaged file the dependency lands
 * in, because the whole point of this gate is that "it is only a
 * devDependency" is not a reason to ignore the advisory.
 *
 * @param {BundledAuditResult} result
 * @returns {string}
 */
export function formatBundledAuditFailure(result) {
  if (result.offending.length === 0) return '';
  const lines = [
    `Bundled-dependency audit found ${result.offending.length} advisory(ies) at or above "${result.level}".`,
    'These packages are inlined into the packaged desktop main/preload bundles, so their code ships to users regardless of how they are declared in package.json:',
  ];
  for (const adv of result.offending) {
    lines.push('');
    lines.push(`  [${adv.severity}] ${adv.module} — ${adv.title || adv.id}`);
    if (adv.url) lines.push(`    ${adv.url}`);
    lines.push(`    trace: pnpm why ${adv.module}`);
  }
  lines.push('');
  lines.push(
    'Fix: pin the patched version in the pnpm-workspace.yaml overrides (the list pnpm actually enforces; keep the package.json mirror in sync), or document a vendored exception per docs/RELEASE_SECURITY.md.'
  );
  return lines.join('\n');
}
