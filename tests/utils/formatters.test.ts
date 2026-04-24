import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatSource, isFormatterSupported } from '../../src/renderer/utils/formatters';

type FormatIpcBridge = {
  gofmt: (source: string) => Promise<FormatIpcResult>;
  rustfmt: (source: string) => Promise<FormatIpcResult>;
  python: (source: string) => Promise<FormatIpcResult>;
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
    expect(isFormatterSupported('html')).toBe(true);
    expect(isFormatterSupported('xml')).toBe(true);
    expect(isFormatterSupported('go')).toBe(true);
    expect(isFormatterSupported('rust')).toBe(true);
    expect(isFormatterSupported('python')).toBe(true);
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

  it('routes Python through the IPC bridge and returns formatted output', async () => {
    installFormatBridge({
      python: async (source: string) => ({
        available: true,
        success: true,
        formatted: source.replace(/\s*=\s*/g, ' = '),
      }),
    });

    const result = await formatSource('python', 'x=1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toBe('x = 1');
      expect(result.changed).toBe(true);
    }
  });

  it('surfaces Python parse errors through the parse-error failure branch', async () => {
    installFormatBridge({
      python: async () => ({
        available: true,
        success: false,
        error: 'error: invalid syntax on line 1',
      }),
    });

    const result = await formatSource('python', 'def broken(');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('parse-error');
      expect(result.message).toContain('invalid syntax');
    }
  });

  it('reports Python binary-missing when neither ruff nor black is installed', async () => {
    installFormatBridge({
      python: async () => ({
        available: false,
        reason: 'binary-missing',
        error: 'No Python formatter available on PATH.',
      }),
    });

    const result = await formatSource('python', 'print(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('binary-missing');
      expect(result.message).toContain('PATH');
    }
  });

  it('formats HTML with Prettier, indenting block-level children onto new lines', async () => {
    // Prettier keeps short inline HTML on a single line. Force a break by
    // mixing a block-level <section> with nested content that exceeds the
    // default printWidth.
    const source =
      '<section><h1>Welcome</h1><p>This is a paragraph that needs enough content to push past the default 80-char Prettier print width.</p></section>';
    const result = await formatSource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toContain('<section>');
      expect(result.formatted).toContain('<h1>Welcome</h1>');
      // Break + indentation is visible between the opening <section> and the
      // first child element.
      expect(result.formatted).toMatch(/<section>\n\s+<h1>/);
      expect(result.changed).toBe(true);
    }
  });

  it('is idempotent when formatting already-formatted HTML', async () => {
    const first = await formatSource(
      'html',
      '<section><h1>Welcome</h1><p>Some paragraph that is long enough to get wrapped onto its own indented line.</p></section>'
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await formatSource('html', first.formatted);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.formatted).toBe(first.formatted);
      expect(second.changed).toBe(false);
    }
  });

  it('formats CSS with Prettier, indenting declarations inside a rule', async () => {
    const result = await formatSource('css', '.x{color:red;padding:1px 2px}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toContain('.x {');
      expect(result.formatted).toContain('color: red;');
      expect(result.formatted).toMatch(/\.x \{\n\s+color:/);
      expect(result.changed).toBe(true);
    }
  });

  it('is idempotent when formatting already-formatted CSS', async () => {
    const first = await formatSource('css', '.x { color: red; padding: 1px 2px; }');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await formatSource('css', first.formatted);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.formatted).toBe(first.formatted);
      expect(second.changed).toBe(false);
    }
  });

  it('formats XML with Prettier, wrapping long element content past the print width', async () => {
    // Prettier keeps short inline XML on a single line. Force a wrap by
    // handing it content that exceeds the default 80-char printWidth so we
    // can see the indentation behavior light up.
    const source =
      '<root><child>a longer child that should push this well past the default 80 char print width</child><other value="x"/></root>';
    const result = await formatSource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatted).toContain('<root>');
      expect(result.formatted).toContain(
        'a longer child that should push this well past the default 80 char print width',
      );
      // Prettier xml wraps the opening tag onto its own indented line when
      // the element is above printWidth.
      expect(result.formatted).toMatch(/<child\n\s+>/);
      expect(result.changed).toBe(true);
    }
  });

  it('is idempotent when formatting already-formatted XML', async () => {
    const first = await formatSource(
      'xml',
      '<root><child>a longer child that should push this well past the default 80 char print width</child><other value="x"/></root>'
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await formatSource('xml', first.formatted);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.formatted).toBe(first.formatted);
      expect(second.changed).toBe(false);
    }
  });
});
