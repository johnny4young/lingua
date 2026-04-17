import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatSource, isFormatterSupported } from '../../src/renderer/utils/formatters';

type FormatIpcBridge = {
  gofmt: (source: string) => Promise<FormatIpcResult>;
  rustfmt: (source: string) => Promise<FormatIpcResult>;
};

function installFormatBridge(bridge: Partial<FormatIpcBridge>): void {
  (globalThis as unknown as { window: Window & { lingua: Partial<LinguaAPI> } }).window = {
    ...(globalThis as unknown as { window: Window }).window,
    lingua: { format: bridge as FormatIpcBridge },
  } as Window & { lingua: Partial<LinguaAPI> };
}

describe('formatters', () => {
  const originalWindow = (globalThis as unknown as { window?: Window }).window;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow) {
      (globalThis as unknown as { window: Window }).window = originalWindow;
    }
  });

  it('reports which languages have a formatter strategy', () => {
    expect(isFormatterSupported('javascript')).toBe(true);
    expect(isFormatterSupported('typescript')).toBe(true);
    expect(isFormatterSupported('json')).toBe(true);
    expect(isFormatterSupported('css')).toBe(true);
    expect(isFormatterSupported('go')).toBe(true);
    expect(isFormatterSupported('rust')).toBe(true);
    expect(isFormatterSupported('python')).toBe(false);
    expect(isFormatterSupported('yaml')).toBe(false);
  });

  it('returns the original content unchanged for unsupported languages', async () => {
    const result = await formatSource('yaml', 'a: 1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('unsupported');
    }
  });

  it('short-circuits empty input as a no-op success', async () => {
    const result = await formatSource('javascript', '');
    expect(result).toEqual({ ok: true, formatted: '', changed: false });
  });

  it('formats JavaScript with Prettier and flags the change', async () => {
    const result = await formatSource('javascript', 'const  x=1\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toBe('const x = 1;\n');
      expect(result.changed).toBe(true);
    }
  });

  it('is idempotent — formatting the formatted output leaves it unchanged', async () => {
    const first = await formatSource('typescript', 'const a:number=1\n');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await formatSource('typescript', first.formatted);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.formatted).toBe(first.formatted);
      expect(second.changed).toBe(false);
    }
  });

  it('reports parse errors via the parse-error failure branch', async () => {
    const result = await formatSource('json', '{bad json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('parse-error');
    }
  });

  it('surfaces missing gofmt / rustfmt binaries as binary-missing failures', async () => {
    installFormatBridge({
      gofmt: async () => ({
        available: false,
        reason: 'binary-missing',
        error: 'gofmt missing',
      }),
      rustfmt: async () => ({
        available: false,
        reason: 'binary-missing',
        error: 'rustfmt missing',
      }),
    });

    const go = await formatSource('go', 'package main');
    expect(go.ok).toBe(false);
    if (!go.ok) {
      expect(go.failure).toBe('binary-missing');
      expect(go.message).toContain('gofmt');
    }

    const rust = await formatSource('rust', 'fn main() {}');
    expect(rust.ok).toBe(false);
    if (!rust.ok) {
      expect(rust.failure).toBe('binary-missing');
      expect(rust.message).toContain('rustfmt');
    }
  });

  it('marks format as web-unavailable when the IPC bridge is absent', async () => {
    (globalThis as unknown as { window?: { lingua?: { format?: unknown } } }).window = {
      lingua: {},
    } as Window;

    const result = await formatSource('go', 'package main');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('web-unavailable');
    }
  });

  it('passes gofmt output through when the bridge succeeds', async () => {
    installFormatBridge({
      gofmt: async (source: string) => ({
        available: true,
        success: true,
        formatted: source.replace(/\s+/g, ' ').trim() + '\n',
      }),
    });

    const result = await formatSource('go', 'package   main\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toBe('package main\n');
      expect(result.changed).toBe(true);
    }
  });
});
