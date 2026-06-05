/**
 * RL-128 (AUDIT-08) structure guard — locks the editorStore split so a future
 * edit cannot silently regress it.
 *
 * - fold C (public API barrel): the assembled store exposes EXACTLY the
 *   `EditorState` surface (3 state fields + 33 actions), and `editorStore.ts`
 *   re-exports EXACTLY the helper/selector symbols the 120+ consumers import.
 *   Catches an accidentally-dropped action during the split AND an accidental
 *   new public export sneaking in.
 * - fold D (size budget): the assembly point stays thin and no extracted module
 *   grows back toward a monolith.
 * - fold E (import acyclicity): no split module imports the store assembly, and
 *   the pure helper leaves import neither the store nor any action factory — so
 *   `editorStore.ts` is the only place the graph converges.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as editorStoreModule from '../../src/renderer/stores/editorStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';

const STORES_DIR = resolve(__dirname, '../../src/renderer/stores');

/** The complete `EditorState` surface — 3 state fields + 33 actions. */
const EXPECTED_STORE_KEYS = [
  // state
  'tabs',
  'activeTabId',
  'pendingReveal',
  // tab lifecycle
  'addTab',
  'restoreTabs',
  'removeTab',
  'setActiveTab',
  'setTabLanguage',
  'duplicateActiveTab',
  'markSaved',
  // workspace openers
  'addNotebookTab',
  'addSqlTab',
  'addHttpTab',
  // content writes
  'updateContent',
  'setTabContentFromDisk',
  'setTabExecutionState',
  'clearRecipeBinding',
  'setTabNextRunTimeoutOverride',
  // mode + capability toggles
  'setTabRuntimeMode',
  'setTabWorkflowMode',
  'setTabAutoLogEnabled',
  'setTabStdinBuffer',
  'setTabCompareEnabled',
  'setTabVariableInspectorEnabled',
  // open / save
  'openFile',
  'openFileFromDisk',
  'saveActiveTab',
  'saveActiveTabAs',
  'saveTabById',
  // close / rename
  'closeTab',
  'renameTab',
  'closeOtherTabs',
  'closeTabsToRight',
  'closeAllTabs',
  // reveal
  'requestReveal',
  'clearPendingReveal',
].sort();

/** Symbols `editorStore.ts` must expose for its existing consumers. */
const EXPECTED_MODULE_EXPORTS = [
  'useEditorStore',
  'createDefaultTab',
  'isVariableInspectorSupportedLanguage',
  'SQL_WORKSPACE_TAB_ID',
  'HTTP_WORKSPACE_TAB_ID',
  'getActiveTab',
  'getActiveTabIndex',
  'languageFromPath',
].sort();

/** The assembly point — must stay thin. */
const ASSEMBLY_FILE = 'editorStore.ts';
const ASSEMBLY_MAX_LINES = 100;

/** Every extracted editor* module that backs the split. */
const SPLIT_MODULES = [
  'editorStoreContext.ts',
  'editorModeHelpers.ts',
  'editorTabUtils.ts',
  'editorPersistence.ts',
  'editorSelectors.ts',
  'editorTabActions.ts',
  'editorWorkspaceActions.ts',
  'editorContentActions.ts',
  'editorModeActions.ts',
  'editorSaveActions.ts',
  'editorCloseActions.ts',
];
const MODULE_MAX_LINES = 300;

/**
 * Pure leaf helpers — must not reach the store OR any action factory, so they
 * stay importable from anywhere without dragging the world (or a cycle) in.
 */
const PURE_LEAF_MODULES = [
  'editorStoreContext.ts',
  'editorModeHelpers.ts',
  'editorTabUtils.ts',
  'editorPersistence.ts',
  'editorSelectors.ts',
];
const ACTION_FACTORY_MODULES = [
  'editorTabActions.ts',
  'editorWorkspaceActions.ts',
  'editorContentActions.ts',
  'editorModeActions.ts',
  'editorSaveActions.ts',
  'editorCloseActions.ts',
];

function read(file: string): string {
  return readFileSync(resolve(STORES_DIR, file), 'utf8');
}

function lineCount(file: string): number {
  return read(file).split('\n').length;
}

describe('RL-128 editorStore split — public API barrel (fold C)', () => {
  it('the assembled store exposes exactly the EditorState surface', () => {
    const keys = Object.keys(useEditorStore.getState()).sort();
    expect(keys).toEqual(EXPECTED_STORE_KEYS);
  });

  it('every action on the store is a function and state fields keep their initial shape', () => {
    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.pendingReveal).toBeNull();
    const actionKeys = EXPECTED_STORE_KEYS.filter(
      (k) => !['tabs', 'activeTabId', 'pendingReveal'].includes(k)
    );
    for (const key of actionKeys) {
      expect(typeof (state as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('editorStore.ts re-exports exactly the public helper/selector symbols', () => {
    const exported = Object.keys(editorStoreModule).sort();
    expect(exported).toEqual(EXPECTED_MODULE_EXPORTS);
  });

  it('the re-exported workspace ids keep their stable values', () => {
    expect(editorStoreModule.SQL_WORKSPACE_TAB_ID).toBe('lingua:workspace:sql');
    expect(editorStoreModule.HTTP_WORKSPACE_TAB_ID).toBe('lingua:workspace:http');
  });
});

describe('RL-128 editorStore split — size budget (fold D)', () => {
  it('the assembly point stays thin', () => {
    expect(lineCount(ASSEMBLY_FILE)).toBeLessThanOrEqual(ASSEMBLY_MAX_LINES);
  });

  it.each(SPLIT_MODULES)('%s stays under the per-module budget', (file) => {
    expect(lineCount(file)).toBeLessThanOrEqual(MODULE_MAX_LINES);
  });
});

describe('RL-128 editorStore split — import acyclicity (fold E)', () => {
  it.each([...SPLIT_MODULES])('%s does not import the store assembly', (file) => {
    expect(read(file)).not.toMatch(/from\s+['"]\.\/editorStore['"]/);
  });

  it.each(PURE_LEAF_MODULES)('%s is a leaf — no action-factory imports', (file) => {
    const source = read(file);
    for (const factory of ACTION_FACTORY_MODULES) {
      const moduleName = factory.replace(/\.ts$/, '');
      expect(source).not.toMatch(
        new RegExp(`from\\s+['"]\\./${moduleName}['"]`)
      );
    }
  });
});
