import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/renderer/index.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('spring motion', () => {
  it('moves the dock body on the spring curve', () => {
    expect(rule('.dock-tab-body')).toContain('var(--curve-spring)');
    expect(rule('@keyframes dock-tab-enter')).toContain('translateY');
  });

  it('springs Run only on release', () => {
    expect(rule('.action-pill-run')).toMatch(/transform var\(--duration-fast\) var\(--curve-spring\)/);
    expect(rule('.action-pill-run:not(:disabled):active')).toContain('transition-timing-function: var(--curve-ease-out)');
  });

  it('gives shared controls a gap and a ring in the control hue', () => {
    const focusRing = css.slice(css.indexOf('@utility focus-ring'), css.indexOf('@layer components', css.indexOf('@utility focus-ring')));
    expect(focusRing).toContain('focus-visible:ring-accent-fg');
    expect(focusRing).toContain('focus-visible:ring-offset-2');
    expect(rule('.icon-button')).toContain('active:bg-surface-strong');
    expect(rule('.settings-rail-row')).toContain('focus-visible:ring-inset');
  });
});
