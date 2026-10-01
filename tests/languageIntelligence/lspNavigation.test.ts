import { describe, expect, it, vi } from 'vitest';
import { GoLanguageIntelligenceAdapter } from '../../src/renderer/languageIntelligence/go';
import { RustLanguageIntelligenceAdapter } from '../../src/renderer/languageIntelligence/rust';

const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } };
for (const Adapter of [GoLanguageIntelligenceAdapter, RustLanguageIntelligenceAdapter]) {
  describe(Adapter.name + ' navigation', () => {
    function setup() {
      let resolve!: (value: Result<unknown>) => void;
      const request = vi.fn(
        () =>
          new Promise<Result<unknown>>(r => {
            resolve = r;
          })
      );
      const adapter = new Adapter({ request, notify: vi.fn(), onNotification: () => () => {} });
      adapter.openDocument('file:///main', 'dirty buffer');
      return { adapter, request, answer: (data: unknown) => resolve({ ok: true, data }) };
    }
    it('normalizes definitions and preserves references declaration context', async () => {
      const { adapter, request, answer } = setup();
      const definition = adapter.provideDefinition('file:///main', 3, 4);
      expect(request).toHaveBeenCalledWith('textDocument/definition', {
        textDocument: { uri: 'file:///main' },
        position: { line: 2, character: 3 },
      });
      answer([
        {
          targetUri: 'file:///other',
          targetRange: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
          targetSelectionRange: range,
        },
      ]);
      expect(await definition).toEqual([{ uri: 'file:///other', range }]);
      const references = adapter.provideReferences('file:///main', 3, 4, true);
      expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
        context: { includeDeclaration: true },
      });
      answer({ uri: 'file:///other', range });
      expect(await references).toEqual([{ uri: 'file:///other', range }]);
      adapter.dispose();
    });
    it.each(['edit', 'close-reopen', 'project'] as const)(
      'discards a late response after %s',
      async mode => {
        const { adapter, answer } = setup();
        const result = adapter.provideDefinition('file:///main', 1, 1);
        if (mode === 'edit') adapter.changeDocument('file:///main', 'next');
        if (mode === 'close-reopen') {
          adapter.closeDocument('file:///main');
          adapter.openDocument('file:///main', 'dirty buffer');
        }
        if (mode === 'project') {
          adapter.resetProjectContext();
          adapter.openDocument('file:///main', 'dirty buffer');
        }
        answer({ uri: 'file:///other', range });
        expect(await result).toEqual([]);
        adapter.dispose();
      }
    );
  });
}
