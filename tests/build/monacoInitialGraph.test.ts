/**
 * Keeps Monaco out of the initial download.
 *
 * Monaco is ~3.7 MiB raw / ~950 KiB gzip — larger than everything else in the
 * initial graph combined. It has regressed into that graph before, silently,
 * because two independent mechanisms can put it there and neither shows up in
 * a code review of the diff that caused it:
 *
 *   1. A module reachable by STATIC import from the web entry importing the
 *      `src/renderer/monaco` barrel. `useDocumentSymbols` did this while its
 *      own doc comment claimed the opposite, reached from `<AppOverlays>`.
 *   2. Vite's `\0vite/preload-helper.js` — a ~1 KiB shared module every chunk
 *      with a dynamic import needs — getting absorbed into the monaco chunk by
 *      automatic placement. The entry then statically imports that chunk for
 *      the helper and drags the editor along.
 *
 * These tests guard both. The bundle-size side is covered separately by the
 * performance budget in `docs/performance/baseline.json`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRendererViteAliases, createWebViteAliases } from '../../build/viteAliases.mts';
import {
  importChain,
  resolveSourceImport,
  staticSpecifiers,
  stripComments,
  walkStaticImportGraph,
} from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');

/** Entry module for each bundled surface, relative to the repo root. */
const ENTRIES = {
  web: 'src/web/main.tsx',
  renderer: 'src/renderer/main.tsx',
} as const;

/** The barrel that pulls monaco core, the five ?worker bundles and the React wrapper. */
const MONACO_BARREL = 'src/renderer/monaco.ts';

/**
 * Modules that must stay on the far side of a lazy boundary, with the reason
 * each one costs real bytes at boot. All of them are reached only through
 * `<AppOverlays>`, which `App` mounts unconditionally — so a plain `import`
 * there silently puts them in every visitor's first download.
 */
const MUST_STAY_LAZY: Array<{ module: string; why: string }> = [
  { module: 'src/renderer/data/changelog.ts', why: '77 KiB of release copy' },
  { module: 'src/renderer/components/Settings/SettingsModal.tsx', why: 'the whole Settings tree' },
  {
    module: 'src/renderer/components/CommandPalette/CommandPalette.tsx',
    why: 'the 30 KiB palette model',
  },
  {
    module: 'src/renderer/components/CapsuleList/CapsuleListOverlay.tsx',
    why: 'capsule browsing + comparison',
  },
  {
    module: 'src/renderer/components/ImportPreview/ImportPreviewOverlay.tsx',
    why: 'the Postman/Bruno importers',
  },
];

/**
 * Conditional shell regions that are absent from the default workspace. They
 * must not make their complete feature trees part of the first download.
 */
const ON_DEMAND_SHELL_MODULES: Array<{ module: string; why: string }> = [
  {
    module: 'src/renderer/components/Layout/BottomPanel.tsx',
    why: 'console, debugger, preview, stdin, variables, dependencies, git diff, and recipes',
  },
];

/**
 * Heavy implementation modules used only after an explicit action or an
 * accepted delayed workflow. These are not UI regions, but a static import
 * would still charge every startup before the work begins.
 */
const DEFERRED_IMPLEMENTATION_MODULES: Array<{
  module: string;
  why: string;
}> = [
  {
    module: 'src/renderer/data/keyboardShortcutReference.ts',
    why: 'localized shortcut labels, descriptions, and search keywords used only by lazy Settings surfaces',
  },
  {
    module: 'src/renderer/data/developerUtilities.ts',
    why: 'developer utility action labels, descriptions, aliases, and search keywords used only by lazy reference surfaces',
  },
  {
    module: 'src/renderer/stores/utilityHistoryStore.ts',
    why: 'utility history limits, favorites, entitlement persistence, and upsell behavior used only by lazy Utilities surfaces',
  },
  {
    module: 'src/renderer/hooks/dependencyDetectionRuntime.ts',
    why: 'dependency parser loading and platform classification used only after source may reference a package',
  },
  {
    module: 'src/renderer/stores/workspaceToolStore.ts',
    why: 'persisted HTTP collection state used only by HTTP workspace and importer surfaces',
  },
  {
    module: 'src/renderer/stores/workspaceSqlStore.ts',
    why: 'persisted SQL collection state used only by SQL workspace surfaces',
  },
  {
    module: 'src/shared/projectBundle.ts',
    why: 'the fflate project archive codec used only by bundle export/import',
  },
  {
    module: 'src/renderer/hooks/projectBundleRuntime.ts',
    why: 'project traversal, archive choreography, and bundle telemetry used only after explicit export/import',
  },
  {
    module: 'src/renderer/runtime/executeTabManually.ts',
    why: 'manual runner orchestration used only after Run, Debug, replay, or smoke starts',
  },
  {
    module: 'src/renderer/runtime/manualRunController.ts',
    why: 'manual-run entitlement checks, native trust gating, lifecycle, announcements, and telemetry used only after Run or Debug starts',
  },
  {
    module: 'src/renderer/hooks/autoRunExecution.ts',
    why: 'runner orchestration used only after a Scratchpad debounce is accepted',
  },
  {
    module: 'src/shared/dependencies/javascriptDetector.ts',
    why: 'the Acorn-backed dependency scanner used only when JS/TS source may reference a package',
  },
  {
    module: 'src/shared/dependencies/pythonDetector.ts',
    why: 'the Python dependency scanner used only when source may reference a package',
  },
  {
    module: 'src/renderer/utils/magicComments.ts',
    why: 'magic-comment transforms used only by editor providers and execution',
  },
  {
    module: 'src/renderer/testing/RichConsoleE2eFixture.tsx',
    why: 'the Playwright-only rich console gallery and its complete Console panel tree',
  },
  {
    module: 'src/renderer/data/developerUtilityDetectors.ts',
    why: 'utility input detectors used only after a Developer Utilities panel opens',
  },
  {
    module: 'src/renderer/utils/developerUtilityDetection.ts',
    why: 'synchronous utility predicates used only by Smart Paste or an open utility panel',
  },
  {
    module: 'src/renderer/utils/developerUtilities.ts',
    why: 'JSON, URL, JWT, color, cron, and text analyzers used by utility panels',
  },
  {
    module: 'src/renderer/utils/jwt.ts',
    why: 'JWT decoding and verification used only by the JWT utility panel',
  },
  {
    module: 'src/renderer/utils/telemetryEmitter.ts',
    why: 'consent-gated telemetry delivery, trust capture, and base-field resolution',
  },
  {
    module: 'src/shared/telemetry.ts',
    why: 'the complete telemetry event catalog, property allowlist, and redactor',
  },
  {
    module: 'src/renderer/languageIntelligence/python.ts',
    why: 'the Python local analyzer used only after a Python tab activates diagnostics',
  },
  {
    module: 'src/renderer/languageIntelligence/ruby.ts',
    why: 'the Ruby local analyzer used only after a Ruby tab activates diagnostics',
  },
  {
    module: 'src/renderer/languageIntelligence/go.ts',
    why: 'the desktop-only gopls adapter used only after gopls reports ready',
  },
  {
    module: 'src/renderer/languageIntelligence/rust.ts',
    why: 'the desktop-only rust-analyzer adapter used only after rust-analyzer reports ready',
  },
  {
    module: 'src/renderer/runtime/runLedger.ts',
    why: 'the opt-in local run ledger used only after an enabled manual run or explicit Settings action',
  },
  {
    module: 'src/renderer/runtime/duckdbClient.ts',
    why: 'the DuckDB wrapper used only by SQL surfaces and the opt-in run ledger',
  },
  {
    module: 'src/renderer/hooks/desktopSmokeRunner.ts',
    why: 'the Electron-only release and runtime smoke harness',
  },
  {
    module: 'src/renderer/components/GuidedTour/GuidedTourRuntime.tsx',
    why: 'the guided tour engine used only after auto-start or an explicit user request',
  },
  {
    module: 'src/renderer/components/GuidedTour/guidedTourSteps.ts',
    why: 'the translated guided-tour steps used only by the on-demand tour engine',
  },
  {
    module: 'src/renderer/components/GuidedTour/guidedTourSelectors.ts',
    why: 'the guided-tour target polling used only by the on-demand tour engine',
  },
  {
    module: 'src/renderer/components/AI/ExplainCodeDialog.tsx',
    why: 'the paid explain-code consent and result UI used only after an explicit request',
  },
  {
    module: 'src/renderer/runtime/aiClient.ts',
    why: 'the user-configured AI transport used only after consent and Send',
  },
  {
    module: 'src/shared/ai/explainCode.ts',
    why: 'the explain-code payload builder used only by the on-demand consent dialog',
  },
  {
    module: 'src/shared/sharePayload.ts',
    why: 'the gzip/JSON share codec used only after a share command or matching URL fragment',
  },
  {
    module: 'src/renderer/utils/shareLink.ts',
    why: 'share encoding, clipboard, telemetry, and trust capture used only by active sharing',
  },
  {
    module: 'src/renderer/hooks/shareLinkImport.ts',
    why: 'the incoming share decoder and tab importer used only by a matching URL fragment',
  },
  {
    module: 'src/renderer/components/Share/ShareLinkFlow.tsx',
    why: 'the outgoing share preparation and clipboard flow used only after an explicit request',
  },
  {
    module: 'src/renderer/components/Share/ShareConfirmationModal.tsx',
    why: 'the source and stdin preview shown only after an outgoing share is prepared',
  },
  {
    module: 'src/renderer/components/Editor/CompareResultsPanel.tsx',
    why: 'the opt-in comparison renderer used only after Compare is enabled',
  },
  {
    module: 'src/renderer/hooks/useComputedDiff.ts',
    why: 'the comparison diff hook used only by on-demand comparison surfaces',
  },
  {
    module: 'src/renderer/runtime/utilityComputeClient.ts',
    why: 'the heavy-diff worker client used only after a comparison surface opens',
  },
  {
    module: 'src/shared/lessonRunner.ts',
    why: 'the recipe assertion composer and parser used only by lazy Recipes surfaces',
  },
  {
    module: 'src/renderer/components/Editor/FloatingVariablesCard.tsx',
    why: 'the draggable Variables portal used only after the inspector is enabled with a matching scope',
  },
  {
    module: 'src/renderer/components/Editor/RecentRunsPopover.tsx',
    why: 'the per-tab history rows and replay controls used only after Recent Runs opens',
  },
  {
    module: 'src/renderer/components/Editor/EditorTabContextMenu.tsx',
    why: 'the tab action portal used only after right-click or a keyboard context-menu request',
  },
  {
    module: 'src/renderer/components/Editor/RunCapsuleExportButton.tsx',
    why: 'the result-header export control used only after a Run Capsule exists',
  },
  {
    module: 'src/renderer/utils/exportCapsule.ts',
    why: 'capsule sanitizing, clipboard export, telemetry, and trust capture used only by an export action',
  },
  {
    module: 'src/renderer/components/FileTree/FileTree.tsx',
    why: 'the project explorer used only after the sidebar or compact drawer opens',
  },
  {
    module: 'src/renderer/components/FileTree/FileTreeNode.tsx',
    why: 'recursive project rows used only by the on-demand project explorer',
  },
  {
    module: 'src/renderer/components/FileTree/FileTreeContextMenu.tsx',
    why: 'project-row actions used only inside the on-demand project explorer',
  },
  {
    module: 'src/renderer/components/FileTree/FileTreeOpenTabs.tsx',
    why: 'the explorer open-tabs footer used only while the sidebar is visible',
  },
  {
    module: 'src/renderer/hooks/useListWindow.ts',
    why: 'the project-tree windower used only after the explorer opens',
  },
];

/**
 * Convert the canonical absolute Vite replacements into the repo-relative
 * paths used by this graph walker.
 *
 * Order is preserved because Vite matches in declaration order, and the two
 * surfaces genuinely differ: web redirects `@/plugins/catalog` at
 * `src/web/plugin-catalog.ts` before the generic `@` -> `src/renderer`.
 */
function normalizeAliases(aliases: Readonly<Record<string, string>>): Array<[string, string]> {
  return Object.entries(aliases).map(([find, replacement]) => [
    find,
    path.relative(repoRoot, replacement).split(path.sep).join('/'),
  ]);
}

const SURFACE_ALIASES: Record<keyof typeof ENTRIES, Array<[string, string]>> = {
  web: normalizeAliases(createWebViteAliases(repoRoot)),
  renderer: normalizeAliases(createRendererViteAliases(repoRoot)),
};

/**
 * Bare (package) specifiers that must never appear on a statically-reachable
 * path. These are the on-demand halves of the editor: a syntax tokenizer or a
 * language worker belongs to the language the user actually selected, not to
 * everyone's first download.
 */
const FORBIDDEN_BARE_PREFIXES = [
  'monaco-editor/esm/vs/basic-languages/',
  'monaco-editor/esm/vs/language/',
];

/**
 * Every source file reachable from `entry` following static imports only.
 * Dynamic `import()` calls terminate a branch, which is exactly the lazy
 * boundary the bundler honours.
 */
function staticallyReachable(
  entry: string,
  bareHits?: Map<string, string>,
  aliases: Array<[string, string]> = []
): Map<string, string | null> {
  const graph = walkStaticImportGraph({ repoRoot, entry, aliases });
  if (bareHits) {
    for (const [specifier, importers] of graph.bareImporters) {
      if (!FORBIDDEN_BARE_PREFIXES.some(prefix => specifier.startsWith(prefix))) {
        continue;
      }
      if (!bareHits.has(specifier) && importers[0]) {
        bareHits.set(specifier, importers[0]);
      }
    }
  }
  return graph.parents;
}

describe('Monaco stays out of the initial graph', () => {
  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: no statically-reachable module imports the monaco barrel`, () => {
      const aliases = SURFACE_ALIASES[surface as keyof typeof ENTRIES];
      const reachable = staticallyReachable(entry, undefined, aliases);
      // Sanity: the walker actually walked. Without this a resolution bug
      // would make the real assertion below pass on an empty graph.
      expect(reachable.size).toBeGreaterThan(50);
      expect(reachable.has('src/renderer/App.tsx')).toBe(true);

      if (reachable.has(MONACO_BARREL)) {
        throw new Error(
          `${MONACO_BARREL} is statically reachable from ${entry}, which parks ` +
            `~950 KiB gzip of editor in the initial download. Make the ` +
            `dependency dynamic (await import('../monaco')) or move the ` +
            `consumer behind a lazy boundary.\n\nChain:\n  ` +
            importChain(reachable, MONACO_BARREL).join('\n  -> ')
        );
      }
    });
  }

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: overlay-only modules stay behind a lazy boundary`, () => {
      const reachable = staticallyReachable(
        entry,
        undefined,
        SURFACE_ALIASES[surface as keyof typeof ENTRIES]
      );
      const leaked = MUST_STAY_LAZY.filter(target => reachable.has(target.module));
      if (leaked.length > 0) {
        throw new Error(
          leaked
            .map(
              target =>
                `${target.module} (${target.why}) is statically reachable from ${entry}.\n` +
                `Chain:\n  ${importChain(reachable, target.module).join('\n  -> ')}`
            )
            .join('\n\n')
        );
      }
    });
  }

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: closed shell regions stay behind a lazy boundary`, () => {
      const reachable = staticallyReachable(
        entry,
        undefined,
        SURFACE_ALIASES[surface as keyof typeof ENTRIES]
      );
      const leaked = ON_DEMAND_SHELL_MODULES.filter(target => reachable.has(target.module));
      if (leaked.length > 0) {
        throw new Error(
          leaked
            .map(
              target =>
                `${target.module} (${target.why}) is statically reachable from ${entry}.\n` +
                `Chain:\n  ${importChain(reachable, target.module).join('\n  -> ')}`
            )
            .join('\n\n')
        );
      }
    });
  }

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: deferred implementation stays out of startup`, () => {
      const reachable = staticallyReachable(
        entry,
        undefined,
        SURFACE_ALIASES[surface as keyof typeof ENTRIES]
      );
      const leaked = DEFERRED_IMPLEMENTATION_MODULES.filter(target => reachable.has(target.module));
      if (leaked.length > 0) {
        throw new Error(
          leaked
            .map(
              target =>
                `${target.module} (${target.why}) is statically reachable from ${entry}.\n` +
                `Chain:\n  ${importChain(reachable, target.module).join('\n  -> ')}`
            )
            .join('\n\n')
        );
      }
    });
  }

  it('Smart Paste loads the share codec only after an accepted share-link intent', () => {
    const entry = 'src/renderer/clipboard/applyPasteIntent.ts';
    const target = 'src/shared/sharePayload.ts';
    const reachable = staticallyReachable(entry);
    if (reachable.has(target)) {
      throw new Error(
        `${target} is statically reachable from ${entry}, so opening the editor ` +
          `downloads the share codec before a share-link paste is accepted.\n\nChain:\n  ` +
          importChain(reachable, target).join('\n  -> ')
      );
    }
  });

  it('Smart Paste loads HTTP collection state only after an accepted cURL intent', () => {
    const entry = 'src/renderer/hooks/useSmartPaste.ts';
    const target = 'src/renderer/stores/workspaceToolStore.ts';
    const reachable = staticallyReachable(entry);
    if (reachable.has(target)) {
      throw new Error(
        `${target} is statically reachable from ${entry}, so mounting Monaco ` +
          `downloads persisted HTTP collection state before a cURL import is accepted.\n\nChain:\n  ` +
          importChain(reachable, target).join('\n  -> ')
      );
    }
  });

  for (const [surface, entry] of Object.entries(ENTRIES)) {
    it(`${surface}: syntax tokenizers and language workers load on demand`, () => {
      // Verified in a production build: switching a tab to Python fetches the
      // tokenizer, its three providers and the worker at that moment, and
      // none of them ships at boot.
      //
      // Scope: this polices the BOOT path. `basicLanguageLoaders` itself sits
      // behind the Monaco boundary and is not statically reachable, so a
      // static import there costs nothing and is not what this catches. What
      // it catches is a boot-path module — App, a store, a always-mounted
      // component — reaching for a tokenizer or worker directly.
      const bareHits = new Map<string, string>();
      staticallyReachable(entry, bareHits, SURFACE_ALIASES[surface as keyof typeof ENTRIES]);
      if (bareHits.size > 0) {
        throw new Error(
          [...bareHits]
            .map(([specifier, importer]) => `${specifier}\n    imported by ${importer}`)
            .join('\n') +
            `\n\nThese must stay behind import() so a visitor only downloads the ` +
            `syntax they selected.`
        );
      }
    });
  }

  describe('the walker itself', () => {
    it('ignores an import that is commented out on its own line', () => {
      expect(
        staticSpecifiers("// import { X } from '../monaco';\nimport { cn } from './cn';\n")
      ).toEqual(['./cn']);
    });

    it('ignores a comment inside a multi-line import statement', () => {
      // Regression: the lazy `[\s\S]*?` used to scan past this comment and
      // capture `../monaco` as the specifier of the real import below it.
      expect(
        staticSpecifiers("import {\n  a,\n  // b from '../monaco'\n} from './real';\n")
      ).toEqual(['./real']);
    });

    it('ignores a block comment wrapping an import', () => {
      expect(
        staticSpecifiers("/*\nimport { X } from '../monaco';\n*/\nimport { cn } from './cn';\n")
      ).toEqual(['./cn']);
    });

    it('does not mistake a // inside a string for a comment', () => {
      expect(staticSpecifiers("import { a } from 'https://example.com/x.js';\n")).toEqual([
        'https://example.com/x.js',
      ]);
    });

    it('still sees the imports it is supposed to see', () => {
      expect(
        staticSpecifiers(
          "import './side-effect';\nimport type { T } from './types';\nexport { z } from './z';\n"
        )
      ).toEqual(['./side-effect', './z']);
    });

    it('does not count dynamic imports as static edges', () => {
      expect(staticSpecifiers("const m = await import('../monaco');\n")).toEqual([]);
    });

    it('does not count named type-only imports or re-exports as runtime edges', () => {
      expect(
        staticSpecifiers(
          "import { type A, type B as C } from './types';\n" +
            "export { type D } from './other-types';\n"
        )
      ).toEqual([]);
    });

    it('keeps mixed named imports and re-exports in the runtime graph', () => {
      expect(
        staticSpecifiers(
          "import { type A, value } from './mixed';\n" +
            "export { type B, runtimeValue } from './other-mixed';\n"
        )
      ).toEqual(['./mixed', './other-mixed']);
    });

    it('follows Vite aliases, per surface', () => {
      // The two surfaces resolve `@/plugins/catalog` differently: web
      // redirects it into src/web, renderer falls through to src/renderer.
      // A walker that ignored aliases stopped at the import and never saw
      // what lies beyond it.
      const web = SURFACE_ALIASES.web;
      const renderer = SURFACE_ALIASES.renderer;
      expect(
        resolveSourceImport(
          repoRoot,
          'src/renderer/stores/pluginStore.ts',
          '@/plugins/catalog',
          web
        )
      ).toBe('src/web/plugin-catalog.ts');
      expect(
        resolveSourceImport(
          repoRoot,
          'src/renderer/stores/pluginStore.ts',
          '@/plugins/catalog',
          renderer
        )
      ).toBe('src/renderer/plugins/catalog.ts');
      // A more specific alias must win over the generic prefix, which is the
      // order Vite itself matches in.
      expect(web[0]![0]).toBe('@/plugins/catalog');
      // Bare package specifiers still resolve to nothing.
      expect(resolveSourceImport(repoRoot, 'src/renderer/App.tsx', 'react', web)).toBeNull();
    });
  });

  it('both bundled configs pin the Vite preload helper to its own chunk', () => {
    // Without this group rolldown folds `\0vite/preload-helper.js` into the
    // monaco chunk, and the entry's need for a 1 KiB helper becomes a static
    // edge onto the whole editor. `manualChunks` cannot express it: the
    // rollup-compat layer never sees virtual module ids.
    // Comments are stripped first, and the group has to match INSIDE the
    // advancedChunks block in a single pattern. Two independent regexes would
    // both pass on prose that merely mentions the two strings — which is the
    // exact shape of the explanatory comment sitting above this config.
    for (const config of ['vite.web.config.mts', 'vite.renderer.config.mts']) {
      const source = stripComments(readFileSync(path.join(repoRoot, config), 'utf8'));
      expect(source, `${config} lost its advancedChunks preload-helper group`).toMatch(
        /advancedChunks:\s*\{[^}]*groups:\s*\[[^\]]*test:\s*\/preload-helper\//
      );
    }
  });
});
