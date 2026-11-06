import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editor, languages, Uri } from 'monaco-editor/esm/vs/editor/editor.api.js';
import { DiagnosticsAdapter } from 'monaco-editor/esm/vs/language/typescript/languageFeatures.js';

// Lingua's patch drops a diagnostics result that finishes after its model left the adapter. The
// TypeScript worker gate holds the first validation until an editor is used, so a JavaScript
// validation started before a tab switches to TypeScript used to land as duplicate markers.

const typeError = { start: 6, length: 5, messageText: 'stale', code: 2322, category: 1 };
const noSubscription = () => ({ dispose: () => {} });
// Own language ids, so Monaco's real TypeScript contribution never starts a worker here.
const [SCRIPT, OTHER] = ['lingua-test-script', 'lingua-test-other'];
for (const id of [SCRIPT, OTHER]) languages.register({ id });

function adapterWithHeldWorker() {
  let release: (worker: unknown) => void = () => {};
  const held = new Promise(resolve => {
    release = resolve;
  });
  const adapter = new DiagnosticsAdapter(
    { fetchLibFilesIfNecessary: async () => {} },
    {
      getDiagnosticsOptions: () => ({}),
      onDidChange: noSubscription,
      onDidExtraLibsChange: noSubscription,
    },
    SCRIPT,
    () => held
  );
  const worker = {
    getSyntacticDiagnostics: async () => [],
    getSemanticDiagnostics: async () => [typeError],
    getSuggestionDiagnostics: async () => [],
  };
  return { adapter, releaseWorker: () => release(worker) };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const adapterMarkers = (model: editor.ITextModel) =>
  editor.getModelMarkers({ resource: model.uri, owner: SCRIPT });

describe('Monaco diagnostics adapter patch', () => {
  it('is in the patch file', () => {
    expect(readFileSync('patches/monaco-editor@0.55.1.patch', 'utf8')).toContain(
      'this._generations[key] = (this._generations[key] ?? 0) + 1;'
    );
  });

  it('publishes a held validation for a model that kept its language', async () => {
    const { adapter, releaseWorker } = adapterWithHeldWorker();
    const model = editor.createModel('const count = 1;', SCRIPT, Uri.parse('inmemory://model/kept'));
    releaseWorker();
    await settle();
    expect(adapterMarkers(model)).toHaveLength(1);
    model.dispose();
    adapter.dispose();
  });

  it('drops a held validation once the model switched to another language', async () => {
    const { adapter, releaseWorker } = adapterWithHeldWorker();
    const model = editor.createModel('const count = 1;', SCRIPT, Uri.parse('inmemory://model/switched'));
    editor.setModelLanguage(model, OTHER);
    releaseWorker();
    await settle();
    expect(adapterMarkers(model)).toHaveLength(0);
    model.dispose();
    adapter.dispose();
  });
});
