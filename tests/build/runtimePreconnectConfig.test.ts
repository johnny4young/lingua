import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveConfig, type ConfigEnv, type ResolvedConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const HTML_PATH = resolve(ROOT, 'src/web/index.html');
const HTML = readFileSync(HTML_PATH, 'utf8');

async function loadWebConfig(command: ConfigEnv['command']): Promise<ResolvedConfig> {
  return resolveConfig({
    configFile: resolve(ROOT, 'vite.web.config.mts'),
    mode: command === 'build' ? 'production' : 'development',
    logLevel: 'silent',
  }, command);
}

function runtimePlugin(config: ResolvedConfig) {
  return config.plugins.find(plugin => plugin.name === 'lingua-runtime-preconnect');
}

async function transformRuntimeHint(config: ResolvedConfig): Promise<string> {
  const hook = runtimePlugin(config)?.transformIndexHtml;
  if (typeof hook !== 'function') throw new Error('Missing runtime HTML transform');
  const transformed: unknown = await Reflect.apply(hook, undefined, [HTML, {
    path: '/index.html',
    filename: HTML_PATH,
  }]);
  if (typeof transformed !== 'string') throw new Error('Expected transformed HTML');
  return transformed;
}

function runtimeUrls(config: ResolvedConfig): Array<string | null> {
  return ['__LINGUA_DUCKDB_MVP_WASM_URL__', '__LINGUA_RUBY_WASM_URL__'].map(key =>
    JSON.parse(config.define?.[key] as string) as string | null
  );
}

afterEach(() => vi.unstubAllEnvs());

describe('runtime preconnect Vite wiring', () => {
  it.each([
    ['default mirror', undefined, 'https://downloads.linguacode.dev'],
    ['custom mirror', 'https://runtime.example.test:8443/nested/assets/', 'https://runtime.example.test:8443'],
  ])('warms the same origin as both WASM defines for %s', async (_, base, origin) => {
    vi.stubEnv('LINGUA_WEB_RUNTIME_SAME_ORIGIN', undefined);
    vi.stubEnv('VITE_LINGUA_WEB_RUNTIME_BASE', base);
    const config = await loadWebConfig('build');
    const html = await transformRuntimeHint(config);
    const links = html.match(/<link[^>]*rel="preconnect"[^>]*>/g) ?? [];

    expect(links).toHaveLength(3);
    expect(links[2]).toBe(`<link rel="preconnect" href="${origin}" crossorigin />`);
    for (const url of runtimeUrls(config)) {
      expect(url).not.toBeNull();
      expect(new URL(url!).origin).toBe(origin);
      if (base) expect(url).toMatch(/^https:\/\/runtime\.example\.test:8443\/nested\/assets\/(duckdb|ruby)\//);
    }
    expect(runtimePlugin(config)).toBeDefined();
    expect(config.plugins.some(plugin => plugin.name === 'lingua-dev-local-ai-csp')).toBe(false);
  });

  it.each([
    ['serve', undefined],
    ['serve', '1'],
    ['build', '1'],
  ] as const)('omits the hint and external URLs for command=%s, same-origin=%s', async (command, sameOrigin) => {
    vi.stubEnv('LINGUA_WEB_RUNTIME_SAME_ORIGIN', sameOrigin);
    vi.stubEnv('VITE_LINGUA_WEB_RUNTIME_BASE', 'https://unused.example.test/assets');
    const config = await loadWebConfig(command);

    expect(runtimePlugin(config)).toBeUndefined();
    expect(runtimeUrls(config)).toEqual([null, null]);
    expect(config.plugins.some(plugin => plugin.name === 'lingua-dev-local-ai-csp')).toBe(command === 'serve');
  });
});
