import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { LspProcess } from '../../../src/main/lsp/lspProcess';
import { GoLanguageIntelligenceAdapter } from '../../../src/renderer/languageIntelligence/go';
import { RustLanguageIntelligenceAdapter } from '../../../src/renderer/languageIntelligence/rust';
import { readLspNavigationCapabilities } from '../../../src/shared/lspNavigation';
for (const language of ['go', 'rust'] as const) {
  describe(`${language} real stdio navigation fixture`, () => {
    it('handshakes the project context and carries dirty-buffer navigation and references', async () => {
      const lsp = new LspProcess({
        command: process.execPath,
        args: [path.resolve('tests/__fixtures__/lsp/navigation-server.mjs'), language],
      });
      lsp.start();
      const Adapter =
        language === 'go' ? GoLanguageIntelligenceAdapter : RustLanguageIntelligenceAdapter;
      const adapter = new Adapter({
        request: async (method, params) => ({
          ok: true,
          data: await lsp.sendRequest(method, params),
        }),
        notify: (method, params) => lsp.sendNotification(method, params),
        onNotification: () => () => {},
      });
      try {
        const initialized = await lsp.sendRequest('initialize', {
          rootUri: 'file:///approved%20project/',
        });
        expect(readLspNavigationCapabilities(initialized)).toEqual({
          definition: true,
          references: true,
        });
        lsp.sendNotification('initialized', {});
        const uri = `file:///approved%20project/main.${language === 'go' ? 'go' : 'rs'}`;
        adapter.openDocument(uri, 'first');
        adapter.changeDocument(uri, 'dirty latest buffer');
        const definitions = await adapter.provideDefinition(uri, 1, 1);
        expect(definitions).toHaveLength(1);
        expect(definitions[0]?.uri).toBe(
          `file:///approved%20project/helper.${language === 'go' ? 'go' : 'rs'}`
        );
        expect(await adapter.provideReferences(uri, 1, 1, true)).toEqual(definitions);
      } finally {
        adapter.dispose();
        lsp.dispose();
        await lsp.whenExited();
      }
    });
  });
}
