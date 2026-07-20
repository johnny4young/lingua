/**
 * implementation — Language Support Scorecard typed matrix.
 *
 * "Language support" in Lingua is not a single bit. internal surfaced
 * nine distinct axes that vary per language across platforms (web vs
 * desktop). Without a typed matrix, each new language implementation invented
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
 *     is the default per-axis status; `perPlatform` (implementation note) records
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
 *   - `debugger` — breakpoints + step + watch via the internal surface.
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
 * Per-platform override. implementation note — for axes whose
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
  /** Optional per-axis platform overrides (implementation note). */
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
        'Breakpoints and stepping ship. Conditional breakpoints and watch expressions await security review.',
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
        'Source-map composition pauses at the user line. Conditional breakpoints and watch expressions await security review.',
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
      lsp: 'Pyright-in-a-worker is planned.',
      desktopRuntime:
        'Desktop runs the same Pyodide renderer worker as web (no native subprocess yet).',
      packages:
        'micropip works for pure-Python wheels at runtime. No persistent venv yet.',
      richOutput:
        'Chart, image, and HTML helpers ship via __lingua.*.',
      debugger:
        'No Pyodide debugger integration yet. Tracked under internal follow-ups.',
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
// implementation — per-platform resolution (Web | Desktop toggle)
// ---------------------------------------------------------------------------

/**
 * The scorecard's platform filter. `all` is the default cross-platform
 * view (every cell shows its declared status, plus the W/D override pills
 * where a profile sets `perPlatform`). `web` / `desktop` collapse each row
 * to the effective status for that one platform via
 * {@link resolveCapabilityStatus}.
 */
export const SCORECARD_PLATFORMS = ['all', 'web', 'desktop'] as const;
export type ScorecardPlatform = (typeof SCORECARD_PLATFORMS)[number];

/** The two concrete platforms a status can be resolved against. */
export type ResolvablePlatform = Exclude<ScorecardPlatform, 'all'>;

/**
 * The two capability axes that are inherently per-platform already —
 * `webRuntime` describes the browser, `desktopRuntime` the native host.
 * They are NEVER remapped by {@link resolveCapabilityStatus} (only a
 * `perPlatform` override can change them): remapping `desktopRuntime`'s
 * `web-only` value — Lua reuses the browser engine on desktop, so it DOES
 * run there — would wrongly read as "unsupported on desktop".
 */
export const RUNTIME_CAPABILITIES: ReadonlySet<LanguageCapability> = new Set<LanguageCapability>(
  ['webRuntime', 'desktopRuntime']
);

/**
 * implementation — resolve a capability's effective status for ONE
 * platform. Precedence:
 *
 *   1. An explicit `perPlatform[capability][platform]` override wins
 *      (e.g. Ruby's `webRuntime` is `partial` on web only).
 *   2. The two runtime axes pass through unchanged (see
 *      {@link RUNTIME_CAPABILITIES}).
 *   3. The cross-platform descriptors collapse to concrete availability:
 *      `desktop-only` is `unsupported` on web / `available` on desktop;
 *      `web-only` is the mirror.
 *   4. Every other status (`available` / `partial` / `planned` /
 *      `unsupported`) is platform-agnostic and returned as-is.
 *
 * Pure + total; drives both the toggle UI and the per-platform markdown.
 */
export function resolveCapabilityStatus(
  profile: LanguageSupportProfile,
  capability: LanguageCapability,
  platform: ResolvablePlatform
): LanguageCapabilityStatus {
  const override = profile.perPlatform?.[capability]?.[platform];
  if (override !== undefined) return override;
  const base = profile.capabilities[capability];
  if (RUNTIME_CAPABILITIES.has(capability)) return base;
  if (base === 'desktop-only') {
    return platform === 'web' ? 'unsupported' : 'available';
  }
  if (base === 'web-only') {
    return platform === 'web' ? 'available' : 'unsupported';
  }
  return base;
}

// ---------------------------------------------------------------------------
// Markdown renderer (used by docs guard test + implementation note palette command)
// ---------------------------------------------------------------------------

/**
 * implementation — single source of truth for the scorecard
 * markdown representation. `tests/docs/capabilityMatrixDrift.test.ts`
 * regenerates the fenced section of `docs/CAPABILITY_MATRIX.md` from
 * this function and asserts byte equality; the palette command "Copy
 * language scorecard as Markdown" (implementation note) consumes the same output
 * so the clipboard payload matches the doc verbatim.
 *
 * Output uses GitHub-flavored markdown tables with one column per
 * `LanguageCapability` plus a leading "Language" column. Status
 * cells render as inline-code text so the fixed-width chips are
 * legible in source-rendered markdown. Profile order matches
 * `LANGUAGE_SUPPORT_PROFILES` (stability-ordered, not alphabetical).
 */
export function renderLanguageScorecardMarkdown(
  profiles: readonly LanguageSupportProfile[] = LANGUAGE_SUPPORT_PROFILES,
  platform: ScorecardPlatform = 'all'
): string {
  const header = ['Language', ...LANGUAGE_CAPABILITIES.map(capabilityLabel)];
  const separator = header.map(() => '---');
  const rows = profiles.map((profile) => [
    profile.displayName,
    ...LANGUAGE_CAPABILITIES.map((cap) => {
      // implementation — `all` keeps the declared cross-platform status;
      // `web` / `desktop` collapse to the resolved per-platform status.
      const status =
        platform === 'all'
          ? profile.capabilities[cap]
          : resolveCapabilityStatus(profile, cap, platform);
      return '`' + status + '`';
    }),
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
