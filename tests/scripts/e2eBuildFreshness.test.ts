import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_ASSETS } from '../../src/shared/runtimeAssets';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-e2e-cache-'));
  roots.push(root);
  for (const relative of ['scripts/run-playwright-web-validation.mjs', 'scripts/lib/e2ePreviewServer.mjs', 'src/shared/runtimeAssets.ts']) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    copyFileSync(path.join(repoRoot, relative), path.join(root, relative));
  }
  for (const [name, text] of Object.entries({
    'src/renderer/app.ts': 'export const value = 1;',
    'src/web/index.html': '<main>web fixture</main>',
    'index.html': '<main>desktop fixture</main>',
    'package.json': '{"version":"1.0.0"}',
    'CHANGELOG.md': '## [1.0.0] — 2026-01-01',
    'build/appBuildMetadata.mts': 'export const version = 1;',
    'public/icon.svg': '<svg/>',
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'pnpm-workspace.yaml': 'nodeLinker: hoisted',
    'tsconfig.json': '{}',
    'postcss.config.mjs': 'export default {};',
    'vite.web.config.mts': 'export default {};',
    'runtime-assets.lock.json': '{}',
    'patches/compiler.patch': 'synthetic dependency patch',
    '.env.production': 'VITE_FIXTURE=one',
    'node_modules/.modules.yaml': 'synthetic install metadata',
  })) write(root, name, text);
  for (const asset of Object.values(RUNTIME_ASSETS)) {
    for (const name of asset.copyFiles ?? asset.criticalFiles) write(root, path.join(asset.nodeModulesPath, name), 'synthetic asset');
  }
  // Intercept only child-process boundaries in a separate Node process. The
  // real runner and cache logic execute; no compiler, license signer, browser
  // or server is started. This works without executable shell fixtures.
  write(root, 'boundary-stubs.mjs', `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import path from 'node:path';
    import { EventEmitter } from 'node:events';
    import { syncBuiltinESMExports } from 'node:module';
    cp.execFileSync = (_file, args) => {
      if (args[0].endsWith('mint-dev-license.mjs')) return JSON.stringify({publicKeyJwk:'synthetic-key',token:'synthetic-token'});
      if (!args[0].endsWith(path.join('vite','bin','vite.js'))) throw new Error('Unexpected child process');
      const count = fs.existsSync('build-count.txt') ? Number(fs.readFileSync('build-count.txt','utf8')) : 0;
      fs.writeFileSync('build-count.txt', String(count+1));
      fs.mkdirSync('dist/web', {recursive:true});
      fs.writeFileSync('dist/web/index.html', '<main>synthetic build</main>');
      if (process.env.CACHE_TEST_MUTATE_INPUT) fs.writeFileSync('package.json','{"version":"1.0.2"}');
      return '';
    };
    cp.spawn = file => {
      if (!/^playwright(?:\\.cmd)?$/.test(path.basename(file))) throw new Error('Unexpected spawned command');
      const count = fs.existsSync('test-count.txt') ? Number(fs.readFileSync('test-count.txt','utf8')) : 0;
      fs.writeFileSync('test-count.txt', String(count+1));
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    };
    globalThis.fetch = () => { throw new Error('No network expected in cache tests'); };
    syncBuiltinESMExports();
  `);
  return root;
}

function run(root: string, env: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', './boundary-stubs.mjs', 'scripts/run-playwright-web-validation.mjs', ...args], {
    cwd: root,
    env: { PATH: path.dirname(process.execPath), CI: '1', LINGUA_E2E_PORT: '24388', ...env },
    encoding: 'utf8',
    timeout: 5000,
  });
}
function pass(root: string, env?: Record<string, string>, args?: string[]): void {
  const result = run(root, env, args);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}
function builds(root: string): string {
  return readFileSync(path.join(root, 'build-count.txt'), 'utf8');
}

describe('web E2E build input cache', () => {
  it('reuses an unchanged build and its cached synthetic license', () => {
    const root = fixture();
    pass(root);
    pass(root);
    expect(builds(root)).toBe('1');
  });

  it.each([
    ['src/renderer/app.ts', 'export const value = 2;'],
    ['package.json', '{"version":"1.0.1"}'],
    ['CHANGELOG.md', '## [1.0.1] — 2026-01-02'],
    ['build/appBuildMetadata.mts', 'export const version = 2;'],
    ['public/icon.svg', '<svg><path/></svg>'],
    ['pnpm-lock.yaml', 'lockfileVersion: 10'],
    ['pnpm-workspace.yaml', 'nodeLinker: isolated'],
    ['postcss.config.mjs', 'export default { plugins: {} };'],
    ['tsconfig.json', '{"compilerOptions":{"jsx":"preserve"}}'],
    ['runtime-assets.lock.json', '{"version":2}'],
    ['patches/compiler.patch', 'updated synthetic dependency patch'],
    ['.env.production', 'VITE_FIXTURE=two'],
    ['node_modules/.modules.yaml', 'changed install metadata'],
    ['node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm', 'changed synthetic WASM'],
    ['vendor/duckdb-extensions/v1.4.3/wasm_eh/json.duckdb_extension.wasm', 'changed synthetic extension'],
  ])('rebuilds after %s changes', (relative, contents) => {
    const root = fixture();
    pass(root);
    writeFileSync(path.join(root, relative), contents);
    const newer = (statSync(path.join(root, 'dist/web/index.html')).mtimeMs + 1000) / 1000;
    utimesSync(path.join(root, relative), newer, newer);

    pass(root);

    expect(builds(root)).toBe('2');
  });

  it('invalidates removal of an optional env input', () => {
    const root = fixture();
    pass(root);
    rmSync(path.join(root, '.env.production'));
    pass(root);
    expect(builds(root)).toBe('2');
  });

  it('invalidates creation of a previously absent optional env input', () => {
    const root = fixture();
    pass(root);
    write(root, '.env.local', 'VITE_FIXTURE=local');
    pass(root);
    expect(builds(root)).toBe('2');
  });

  it('invalidates a removed source even when its directory mtime is restored', () => {
    const root = fixture();
    pass(root);
    const directory = path.join(root, 'src/renderer');
    const before = statSync(directory);
    rmSync(path.join(directory, 'app.ts'));
    utimesSync(directory, before.atime, before.mtime);
    pass(root);
    expect(builds(root)).toBe('2');
  });

  it('invalidates a source edit even when its mtime is restored', () => {
    const root = fixture();
    pass(root);
    const file = path.join(root, 'src/renderer/app.ts');
    const before = statSync(file);
    writeFileSync(file, 'export const value = 2;');
    utimesSync(file, before.atime, before.mtime);
    pass(root);
    expect(builds(root)).toBe('2');
  });

  it.each([
    ['VITE_BASE_PATH', '/one/', '/two/'],
    ['VITE_NEW_FEATURE_FLAG', 'synthetic-option-one', 'synthetic-option-two'],
    ['LINGUA_WEBSITE_URL', 'https://one.invalid', 'https://two.invalid'],
    ['BROWSERSLIST', 'last 1 Chrome version', 'last 2 Chrome versions'],
    ['BROWSERSLIST_ENV', 'production', 'development'],
    ['NODE_OPTIONS', '--conditions=fixture-one', '--conditions=fixture-two'],
    ['NODE_ENV', 'production', 'development'],
  ])('invalidates a changed %s build override without persisting its value', (name, before, after) => {
    const root = fixture();
    pass(root, { [name]: before });
    pass(root, { [name]: after });
    expect(builds(root)).toBe('2');
    expect(readFileSync(path.join(root, '.cache/playwright-e2e/web-build-metadata.json'), 'utf8')).not.toContain(after);
  });

  it('treats the default and explicit production NODE_ENV as the same build context', () => {
    const root = fixture();
    pass(root);
    pass(root, { NODE_ENV: 'production' });
    pass(root, { NODE_ENV: '' });
    expect(builds(root)).toBe('1');
  });

  it.each(['.browserslistrc', 'browserslist'])('invalidates creation of a root Browserslist config %s', name => {
    const root = fixture();
    pass(root);
    write(root, name, 'last 2 Chrome versions');
    pass(root);
    expect(builds(root)).toBe('2');
  });

  it.each(['BROWSERSLIST_CONFIG', 'BROWSERSLIST_STATS'])('tracks the in-checkout file selected by %s', name => {
    const root = fixture();
    write(root, 'config/browser-data', 'synthetic browser configuration');
    pass(root, { [name]: 'config/browser-data' });
    write(root, 'config/browser-data', 'updated synthetic browser configuration');
    pass(root, { [name]: 'config/browser-data' });
    expect(builds(root)).toBe('2');
  });

  it('does not reuse a build with external Browserslist configuration', () => {
    const root = fixture();
    pass(root, { BROWSERSLIST_CONFIG: '../unread-external-config' });
    pass(root, { BROWSERSLIST_CONFIG: '../unread-external-config' });
    expect(builds(root)).toBe('2');
  });

  it('does not invalidate for test selection, preview port or unrelated environment values', () => {
    const root = fixture();
    pass(root);
    pass(root, { LINGUA_E2E_PORT: '24389', DEBUG: 'synthetic', SECRET_SENTINEL: 'never-persist-this' }, ['--grep', 'another test']);
    expect(builds(root)).toBe('1');
    expect(readFileSync(path.join(root, '.cache/playwright-e2e/web-build-metadata.json'), 'utf8')).not.toContain('never-persist-this');
  });

  it('ignores caller license/telemetry values which the E2E build overrides', () => {
    const root = fixture();
    pass(root, { VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: 'one', VITE_LINGUA_TELEMETRY_URL: 'one' });
    pass(root, { VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: 'two', VITE_LINGUA_TELEMETRY_URL: 'two' });
    expect(builds(root)).toBe('1');
  });

  it('keeps docs, tests, desktop HTML and Finder metadata outside web build inputs', () => {
    const root = fixture();
    pass(root);
    write(root, 'docs/notes.md', 'documentation only');
    write(root, 'tests/example.test.ts', 'test only');
    write(root, 'index.html', '<main>desktop-only change</main>');
    write(root, 'public/.DS_Store', 'Finder metadata');
    pass(root);
    expect(builds(root)).toBe('1');
  });

  it('retains explicit force-rebuild and no-rebuild behavior', () => {
    const root = fixture();
    pass(root);
    pass(root, {}, ['--force-rebuild']);
    writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.1"}');
    pass(root, {}, ['--no-rebuild']);
    expect(builds(root)).toBe('2');
  });

  it('rejects a build whose inputs change while the compiler runs', () => {
    const root = fixture();
    pass(root);
    const result = run(root, { CACHE_TEST_MUTATE_INPUT: '1' }, ['--force-rebuild']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Web build inputs changed during compilation');
    expect(readFileSync(path.join(root, 'test-count.txt'), 'utf8')).toBe('1');
  });
});
