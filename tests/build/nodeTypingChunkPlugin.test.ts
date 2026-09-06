// @vitest-environment node
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build, createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { nodeTypingChunkPlugin } from '../../build/nodeTypingChunkPlugin.mts';

const repoRoot = path.resolve(__dirname, '../..');
const publicId = 'virtual:lingua-node-typing-url';

describe('Node typing chunk URL', () => {
  it.each(['/', '/lingua/', './'])('emits one independent lazy chunk for base %s', async base => {
    const result = await build({
      configFile: false,
      base,
      logLevel: 'silent',
      plugins: [
        nodeTypingChunkPlugin(),
        {
          name: 'typing-chunk-fixture',
          resolveId(id) {
            if (id === 'entry') return '\0entry';
          },
          load(id) {
            if (id === '\0entry') return `export { default as url } from '${publicId}';`;
            if (id.endsWith('/monacoNodeTypes.ts')) {
              return 'export const NODE_TYPE_DEFINITIONS = { fixture: "lazy-declarations" }; export const UNDICI_TYPE_DEFINITIONS = {};';
            }
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: 'entry', preserveEntrySignatures: 'strict' },
      },
    });
    if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one output');
    const chunks = result.output.filter(item => item.type === 'chunk');
    expect(chunks).toHaveLength(2);
    const entry = chunks.find(chunk => chunk.facadeModuleId === '\0entry')!;
    const declarations = chunks.find(chunk => chunk.fileName.includes('monacoNodeTypes'))!;
    expect(entry.imports).toEqual([]);
    expect(entry.code).not.toContain('lazy-declarations');
    expect(entry.code).toContain(path.posix.basename(declarations.fileName));
    expect(entry.code).toContain('import.meta.url');
    expect(declarations.imports).toEqual([]);
    expect(declarations.code).toContain('lazy-declarations');
    expect(declarations.exports).toEqual(['NODE_TYPE_DEFINITIONS', 'UNDICI_TYPE_DEFINITIONS']);
  });

  it('recovers from a cached native ESM rejection without reloading the page', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'lingua-typing-retry-'));
    try {
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
          nodeTypingChunkPlugin(),
          {
            name: 'typing-retry-fixture',
            resolveId(id) {
              if (id === 'entry') return '\0entry';
            },
            load(id) {
              if (id === '\0entry')
                return `export { loadNodeTypeDefinitions } from ${JSON.stringify(path.join(repoRoot, 'src/renderer/nodeTypeDefinitionsLoader.ts'))}; export { default as url } from '${publicId}';`;
              if (id.endsWith('/monacoNodeTypes.ts')) {
                return 'if (!globalThis.typingNetworkReady) throw new Error("offline"); export const NODE_TYPE_DEFINITIONS = { fixture: "recovered" }; export const UNDICI_TYPE_DEFINITIONS = {};';
              }
            },
          },
        ],
        build: {
          outDir,
          minify: false,
          rolldownOptions: {
            input: 'entry',
            preserveEntrySignatures: 'strict',
            output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
          },
        },
      });
      // A separate native module loader (not Vitest's mockable runner) retains
      // rejected module identities, just as Chromium does on a failed fetch.
      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one output');
      const entry = result.output.find(
        item => item.type === 'chunk' && item.facadeModuleId === '\0entry'
      )!;
      const stdout = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        // Vite dispatches preload errors on window; the module cache is native.
        globalThis.window = new EventTarget();
        const loader = await import(${JSON.stringify(pathToFileURL(path.join(outDir, entry.fileName)).href)});
        await assert.rejects(loader.loadNodeTypeDefinitions(), /offline/);
        globalThis.typingNetworkReady = true;
        await assert.rejects(import(loader.url), /offline/);
        const definitions = await loader.loadNodeTypeDefinitions();
        assert.equal(definitions.NODE_TYPE_DEFINITIONS.fixture, 'recovered');
        assert.equal(await loader.loadNodeTypeDefinitions(), definitions);
        console.log('recovered');
      `,
        ],
        { encoding: 'utf8', timeout: 10000 }
      );
      expect(stdout.trim()).toBe('recovered');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('routes dev imports through Vite source transformation under a subpath', async () => {
    const server = await createServer({
      configFile: false,
      root: repoRoot,
      base: '/lingua/',
      plugins: [nodeTypingChunkPlugin()],
      server: { middlewareMode: true },
    });
    try {
      const result = await server.environments.client!.pluginContainer.load(`\0${publicId}`);
      const code = typeof result === 'string' ? result : result?.code;
      expect(code).toContain('/lingua/@fs/');
      expect(code).toContain('/src/renderer/monacoNodeTypes.ts');
    } finally {
      await server.close();
    }
  });

  it.each(['vite.web.config.mts', 'vite.renderer.config.mts', 'vitest.config.mts'])(
    'wires the URL provider into %s',
    config => {
      expect(readFileSync(path.join(repoRoot, config), 'utf8')).toContain(
        'nodeTypingChunkPlugin()'
      );
    }
  );
});
