import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';

const PUBLIC_ID = 'virtual:lingua-node-typing-url';
const RESOLVED_ID = `\0${PUBLIC_ID}`;
const source = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/renderer/monacoNodeTypes.ts'
);

/** Expose the trusted lazy chunk URL so failed native imports can use a fresh URL. */
export function nodeTypingChunkPlugin(): Plugin {
  let build = false;
  let base = '/';
  return {
    name: 'lingua-node-typing-chunk',
    configResolved(config) {
      build = config.command === 'build';
      base = config.base;
    },
    resolveId(id) {
      if (id === PUBLIC_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      if (!build) {
        // The dev server transforms the source/globs; never serve raw TS as an asset.
        const url = `${base}@fs/${normalizePath(path.resolve(source))}`;
        return `export default ${JSON.stringify(url)};`;
      }
      const reference = this.emitFile({
        type: 'chunk',
        id: source,
        name: 'monacoNodeTypes',
        preserveSignature: 'strict',
      });
      // Bundler-generated, chunk-relative URL works for root/subpath web bases
      // and packaged file:// renderers without hardcoded asset hashes.
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
