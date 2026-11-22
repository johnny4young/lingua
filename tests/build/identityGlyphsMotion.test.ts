import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const IDENTITY = read('src/renderer/components/ui/identity.css');
const INDEX = read('src/renderer/index.css');

function block(css: string, marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `${marker} must exist`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', css.indexOf('{', start)));
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(tsx?|css)$/u.test(entry.name)) yield full;
  }
}

describe('motion tokens', () => {
  it('pulses 120 ms a line and answers in 160 ms with a 4 px rise', () => {
    const tokens = block(IDENTITY, ':root {');
    expect(tokens).toContain('--motion-pulse-line: var(--duration-fast)');
    expect(INDEX).toContain('--duration-fast: 120ms');
    expect(tokens).toContain('--motion-answer: 160ms');
    expect(tokens).toContain('--motion-answer-rise: 4px');
  });

  it('drops travel under reduced motion', () => {
    const reduced = IDENTITY.slice(IDENTITY.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block(reduced, ':root {')).toContain('--motion-answer-rise: 0px');
  });

  it('drives the answer and pulse animations from the tokens', () => {
    expect(block(IDENTITY, '.leader-row[data-enter] .dot-leader')).toContain('var(--motion-answer)');
    expect(block(IDENTITY, '@keyframes answer-rise')).toContain('var(--motion-answer-rise)');
    expect(block(IDENTITY, '.pulse-tick {')).toContain('var(--pulse-index, 0) * var(--motion-pulse-line)');
  });

  it('stays out of the initial stylesheet', () => {
    expect(INDEX).not.toContain('--motion-answer');
  });
});

describe('no left accent bars', () => {
  const ACCENT_BAR = [
    /\bborder-(?:l|s)-(?:[2-6]|\[[2-6](?:\.\d+)?px\])(?![\w-])/u,
    /border-(?:left|inline-start)(?:-width)?:\s*[2-6](?:\.\d+)?px/u,
    /shadow-\[inset_[2-6]px_0/u,
    /inset\s+[2-6](?:\.\d+)?px\s+0\s+0/u,
  ];

  it('finds no leading-edge strip in renderer source', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src/renderer'))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of ACCENT_BAR) {
        const match = text.match(pattern);
        if (match) offenders.push(`${relative(ROOT, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
