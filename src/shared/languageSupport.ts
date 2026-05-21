/**
 * RL-095 Slice 1 — Language Support Scorecard typed matrix.
 *
 * "Language support" in Lingua is not a single bit. RL-042 surfaced
 * nine distinct axes that vary per language across platforms (web vs
 * desktop). Without a typed matrix, each new language slice invented
 * its own status field and `docs/CAPABILITY_MATRIX.md` drifted with
 * every commit.
 *
 * This module pins the contract:
 *
 *   - `LanguageCapability` — the nine axes (`syntax` / `autocomplete` /
 *     `lsp` / `webRuntime` / `desktopRuntime` / `packages` / `stdin` /
 *     `richOutput` / `debugger`). Adding a tenth axis is a deliberate
 *     decision that requires editing every profile, every locale, and
 *     the docs guard test.
 *   - `LanguageCapabilityStatus` — closed enum of six states. The
 *     order is significant: `available` is best, `unsupported` is
 *     worst, and the render layer maps each state to a fixed color
 *     token so dashboards and users read the same signal.
 *   - `LanguageSupportProfile` — one row per language. `capabilities`
 *     is the default per-axis status; `perPlatform` (fold C) records
 *     web/desktop overrides only for axes that differ.
 *   - `LANGUAGE_SUPPORT_PROFILES` — seven entries (JS, TS, Python,
 *     Go, Rust, Ruby, Lua) covering every supported language in
 *     scope today.
 *
 * Coupled invariants enforced at CI time:
 *   - `tests/shared/languageSupport.test.ts` asserts every
 *     `LanguagePack` whose `execution !== 'view'` has exactly one
 *     profile entry, and every profile references a real pack id.
 *   - `tests/docs/capabilityMatrixDrift.test.ts` regenerates the
 *     auto-derived section of `CAPABILITY_MATRIX.md` and byte-
 *     compares against the doc.
 *   - The `Record<LanguageCapability, ...>` shape forces TypeScript
 *     to fail any profile that omits an axis.
 */

import type { LanguagePackId } from './languagePacks';

/**
 * Six-state status enum. Ordering is informational (best → worst):
 *
 *   - `available` — first-class support; works end-to-end.
 *   - `partial` — implemented with caveats. Notes are mandatory.
 *   - `desktop-only` — ships only in the Electron build.
 *   - `web-only` — ships only in the browser build.
 *   - `planned` — on the roadmap; no shipping code.
 *   - `unsupported` — explicitly out of scope or blocked.
 */
export type LanguageCapabilityStatus =
  | 'available'
  | 'partial'
  | 'desktop-only'
  | 'web-only'
  | 'planned'
  | 'unsupported';

/**
 * The nine capability axes.
 *
 *   - `syntax` — tokenizer + theme highlighting in the editor.
 *   - `autocomplete` — Monaco built-in word completer / keyword
 *     suggestions. Not LSP-level.
 *   - `lsp` — bidirectional language server with diagnostics + hover
 *     + go-to-def. Desktop-only in most cases (gopls, rust-analyzer).
 *   - `webRuntime` — runs in the browser worker (WASM, interpreter).
 *   - `desktopRuntime` — runs as a desktop child process.
 *   - `packages` — explicit dependency resolution (npm, pip, gem).
 *   - `stdin` — runtime supports pre-set stdin buffer.
 *   - `richOutput` — chart / image / html / table payloads via the
 *     `lingua.*` bridge.
 *   - `debugger` — breakpoints + step + watch via the RL-027 surface.
 */
export type LanguageCapability =
  | 'syntax'
  | 'autocomplete'
  | 'lsp'
  | 'webRuntime'
  | 'desktopRuntime'
  | 'packages'
  | 'stdin'
  | 'richOutput'
  | 'debugger';

/** Ordered list (for table column rendering + docs generation). */
export const LANGUAGE_CAPABILITIES: readonly LanguageCapability[] = [
  'syntax',
  'autocomplete',
  'lsp',
  'webRuntime',
  'desktopRuntime',
  'packages',
  'stdin',
  'richOutput',
  'debugger',
] as const;

/** Ordered list (for status-legend rendering). */
export const LANGUAGE_CAPABILITY_STATUSES: readonly LanguageCapabilityStatus[] = [
  'available',
  'partial',
  'desktop-only',
  'web-only',
  'planned',
  'unsupported',
] as const;

/**
 * Per-platform override. RL-095 Slice 1 fold C — for axes whose
 * status differs between web and desktop (e.g. Ruby's `webRuntime`
 * is `partial` via wasm-wasi while `desktopRuntime` is `available`
 * via system gem). When `perPlatform[capability]` is absent, the
 * default `capabilities[capability]` applies to both platforms.
 */
export interface LanguagePlatformStatus {
  web?: LanguageCapabilityStatus;
  desktop?: LanguageCapabilityStatus;
}

export interface LanguageSupportProfile {
  /** Stable id — matches `LanguagePackId`. */
  languageId: LanguagePackId;
  /** Display name for the scorecard column. Plain English ASCII. */
  displayName: string;
  /** Default status per capability axis. Renderer uses this on the cell. */
  capabilities: Record<LanguageCapability, LanguageCapabilityStatus>;
  /** Optional per-axis tooltip explaining a `partial` or caveat. */
  notes?: Partial<Record<LanguageCapability, string>>;
  /** Optional per-axis platform overrides (fold C). */
  perPlatform?: Partial<Record<LanguageCapability, LanguagePlatformStatus>>;
}

/**
 * The scorecard. Ordered by stability of support so senior users
 * read "what works best" first.
 *
 * Adding a new language: add the profile here AND extend
 * `LANGUAGE_PACKS` accordingly. The guard test in
 * `tests/shared/languageSupport.test.ts` enforces bidirectional
 * parity.
 */
export const LANGUAGE_SUPPORT_PROFILES: readonly LanguageSupportProfile[] = [
  {
    languageId: 'javascript',
    displayName: 'JavaScript',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'available',
      webRuntime: 'available',
      desktopRuntime: 'available',
      packages: 'desktop-only',
      stdin: 'available',
      richOutput: 'available',
      debugger: 'partial',
    },
    notes: {
      lsp: 'Monaco built-in TypeScript service powers JS too.',
      packages:
        'Desktop Node runner resolves node_modules on the host. Web build runs in a sealed worker with no package install.',
      debugger:
        'RL-027 Slice 1.5 shipped breakpoints + step. Conditional breakpoints + watch expressions gated under Slice 1.5b security review.',
    },
  },
  {
    languageId: 'typescript',
    displayName: 'TypeScript',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'available',
      webRuntime: 'available',
      desktopRuntime: 'available',
      packages: 'desktop-only',
      stdin: 'available',
      richOutput: 'available',
      debugger: 'partial',
    },
    notes: {
      lsp: 'Monaco built-in TypeScript service.',
      packages:
        'Desktop Node runner pre-transpiles via esbuild-wasm and resolves node_modules on the host.',
      debugger:
        'Source-map composition via @jridgewell/trace-mapping pauses at user line. Conditional breakpoints + watch expressions gated under RL-027 Slice 1.5b.',
    },
  },
  {
    languageId: 'python',
    displayName: 'Python',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'planned',
      webRuntime: 'available',
      desktopRuntime: 'available',
      packages: 'partial',
      stdin: 'available',
      richOutput: 'available',
      debugger: 'planned',
    },
    notes: {
      lsp: 'Pyright-in-a-worker is planned; see docs/BACKLOG.md.',
      desktopRuntime:
        'Desktop runs the same Pyodide renderer worker as web (no native subprocess yet).',
      packages:
        'micropip works for pure-Python wheels at runtime. No persistent venv yet.',
      richOutput:
        'RL-044 Slice 2b-beta-beta-alpha shipped chart / image / html via __lingua.* bridge.',
      debugger:
        'No Pyodide debugger integration yet. Tracked under RL-027 follow-ups.',
    },
  },
  {
    languageId: 'go',
    displayName: 'Go',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'desktop-only',
      webRuntime: 'unsupported',
      desktopRuntime: 'available',
      packages: 'desktop-only',
      stdin: 'desktop-only',
      richOutput: 'unsupported',
      debugger: 'planned',
    },
    notes: {
      lsp: 'gopls bridged via src/main/lsp/lspProcess.ts.',
      webRuntime:
        'Browser Go would need TinyGo + a WASM toolchain shipped in the bundle. Not on the roadmap.',
      richOutput:
        'lingua.chart / image / html bridge ships only in JS / TS / Python today.',
    },
  },
  {
    languageId: 'rust',
    displayName: 'Rust',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'desktop-only',
      webRuntime: 'unsupported',
      desktopRuntime: 'available',
      packages: 'desktop-only',
      stdin: 'desktop-only',
      richOutput: 'unsupported',
      debugger: 'planned',
    },
    notes: {
      lsp: 'rust-analyzer bridged via src/main/lsp/lspProcess.ts.',
      packages:
        'Cargo workflows expected on the host; Lingua does not vendor cargo.',
    },
  },
  {
    languageId: 'ruby',
    displayName: 'Ruby',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'unsupported',
      webRuntime: 'partial',
      desktopRuntime: 'available',
      packages: 'desktop-only',
      stdin: 'desktop-only',
      richOutput: 'unsupported',
      debugger: 'unsupported',
    },
    notes: {
      webRuntime:
        'Web uses @ruby/wasm-wasi; slower bootstrap and missing C extensions.',
      desktopRuntime:
        'Desktop shells out to the host ruby binary via src/main/ruby-runner.ts.',
    },
    perPlatform: {
      webRuntime: { web: 'partial' },
      desktopRuntime: { desktop: 'available' },
    },
  },
  {
    languageId: 'lua',
    displayName: 'Lua',
    capabilities: {
      syntax: 'available',
      autocomplete: 'available',
      lsp: 'unsupported',
      webRuntime: 'available',
      desktopRuntime: 'web-only',
      packages: 'unsupported',
      stdin: 'unsupported',
      richOutput: 'unsupported',
      debugger: 'unsupported',
    },
    notes: {
      webRuntime: 'Fengari runs Lua in the browser worker.',
      desktopRuntime:
        'Same Fengari worker on desktop; no native lua subprocess integration.',
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Markdown renderer (used by docs guard test + Fold F palette command)
// ---------------------------------------------------------------------------

/**
 * RL-095 Slice 1 — single source of truth for the scorecard
 * markdown representation. `tests/docs/capabilityMatrixDrift.test.ts`
 * regenerates the fenced section of `docs/CAPABILITY_MATRIX.md` from
 * this function and asserts byte equality; the palette command "Copy
 * language scorecard as Markdown" (fold F) consumes the same output
 * so the clipboard payload matches the doc verbatim.
 *
 * Output uses GitHub-flavored markdown tables with one column per
 * `LanguageCapability` plus a leading "Language" column. Status
 * cells render as inline-code text so the fixed-width chips are
 * legible in source-rendered markdown. Profile order matches
 * `LANGUAGE_SUPPORT_PROFILES` (stability-ordered, not alphabetical).
 */
export function renderLanguageScorecardMarkdown(
  profiles: readonly LanguageSupportProfile[] = LANGUAGE_SUPPORT_PROFILES
): string {
  const header = ['Language', ...LANGUAGE_CAPABILITIES.map(capabilityLabel)];
  const separator = header.map(() => '---');
  const rows = profiles.map((profile) => [
    profile.displayName,
    ...LANGUAGE_CAPABILITIES.map(
      (cap) => '`' + profile.capabilities[cap] + '`'
    ),
  ]);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Human-friendly label for the markdown header. The component
 * renderer uses i18n keys; this helper exists so the markdown stays
 * locale-neutral (docs are EN; the palette command also ships an EN
 * payload regardless of the user's UI locale to keep shared
 * snippets reproducible).
 */
function capabilityLabel(cap: LanguageCapability): string {
  switch (cap) {
    case 'syntax':
      return 'Syntax';
    case 'autocomplete':
      return 'Autocomplete';
    case 'lsp':
      return 'LSP';
    case 'webRuntime':
      return 'Web runtime';
    case 'desktopRuntime':
      return 'Desktop runtime';
    case 'packages':
      return 'Packages';
    case 'stdin':
      return 'Stdin';
    case 'richOutput':
      return 'Rich output';
    case 'debugger':
      return 'Debugger';
  }
}
