#!/usr/bin/env node
/**
 * implementation — bundle src/cli/lingua.ts into dist/cli/lingua.cjs.
 *
 * Single CJS file, Node 22+ target, everything bundled (the 5
 * utility adapters + the capsule schema + the registry). No
 * Electron, no React — the ESLint rule + this bundle's
 * shape-check at the end of the run keep it that way.
 *
 * implementation note — the bundled artifact is prefixed with `#!/usr/bin/env node`
 * and gets `chmod +x` so it is directly executable on Unix shells.
 *
 * The `__LINGUA_CLI_VERSION__` placeholder in `src/cli/lingua.ts`
 * is replaced with the `package.json` version at build time so the
 * bundle does not need to read its own package metadata at runtime.
 */

import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const cliVersion = pkg.version;

const outDir = path.join(repoRoot, 'dist', 'cli');
const outFile = path.join(outDir, 'lingua.cjs');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, 'src/cli/lingua.ts')],
  outfile: outFile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  // Tree-shake aggressively; the shared adapters + capsule schema
  // are small but no reason to ship dead code.
  minify: false,
  sourcemap: false,
  // Replace the build-time version placeholder + drop any
  // accidental references to renderer-only globals (defensive — the
  // ESLint rule should catch leaks first but the define keeps the
  // bundle valid even if a leak slips through).
  define: {
    __LINGUA_CLI_VERSION__: JSON.stringify(cliVersion),
  },
  // Banner ensures the artifact starts with the shebang so
  // `chmod +x` makes it directly runnable.
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Everything inline. If a transitive import requires a Node
  // built-in (`fs`, `crypto`), esbuild leaves it as a `require(...)`
  // call automatically — that's fine for the CJS bundle.
  external: [],
  logLevel: 'info',
});

// implementation note — make the bundle directly executable on Unix.
try {
  chmodSync(outFile, 0o755);
} catch (err) {
  // chmod can fail on Windows; that's fine, the user invokes the
  // bundle via `node dist/cli/lingua.cjs` there.
  console.warn(`[build-cli] chmod skipped: ${err instanceof Error ? err.message : String(err)}`);
}

const stats = statSync(outFile);
const sizeKb = (stats.size / 1024).toFixed(1);
console.log(`[build-cli] wrote ${path.relative(repoRoot, outFile)} (${sizeKb} KiB)`);

// Defensive bundle-size budget: warn loudly if the artifact grows
// past 500 KiB. The realistic implementation size is ~35 KiB.
const SOFT_CAP_BYTES = 500 * 1024;
if (stats.size > SOFT_CAP_BYTES) {
  console.warn(
    `[build-cli] WARNING: bundle exceeds ${SOFT_CAP_BYTES.toLocaleString()} byte soft cap. ` +
      'A transitive import probably dragged in renderer-only code; ' +
      'audit with `node --inspect-brk dist/cli/lingua.cjs --help` or rerun ' +
      '`pnpm run lint` to check the src/cli/** → src/renderer/** ban.'
  );
}
