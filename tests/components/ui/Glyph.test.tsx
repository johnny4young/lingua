import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Glyph } from '../../../src/renderer/components/ui/Glyph';
import { GLYPH_NAMES } from '../../../src/renderer/components/ui/glyphSet';
import { ICON_GLYPH } from '../../../src/renderer/components/ui/iconScale';

describe('Glyph', () => {
  it.each(GLYPH_NAMES)('draws %s at the default icon scale with a 1.5 px stroke', (name) => {
    const { container } = render(<Glyph name={name} />);
    const svg = container.querySelector(`svg[data-glyph="${name}"]`);
    expect(svg).not.toBe(null);
    expect(svg?.getAttribute('width')).toBe(String(ICON_GLYPH.md));
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const viewBox = Number(svg!.getAttribute('viewBox')!.split(' ')[2]);
    expect((Number(svg!.getAttribute('stroke-width')) * ICON_GLYPH.md) / viewBox).toBeCloseTo(1.5);
    expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it.each(['notebook', 'search'] as const)('keeps the %s stroke at 1.5 px in a dense control', (name) => {
    const { container } = render(<Glyph name={name} size={ICON_GLYPH.sm} />);
    const svg = container.querySelector('svg')!;
    const viewBox = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    expect((Number(svg.getAttribute('stroke-width')) * ICON_GLYPH.sm) / viewBox).toBeCloseTo(1.5);
  });

  it('fills only run and stop', () => {
    const { container } = render(
      <>
        <Glyph name="run" />
        <Glyph name="stop" />
        <Glyph name="search" />
      </>
    );
    const filled = [...container.querySelectorAll('svg')].map((svg) => svg.querySelector('[fill="currentColor"]') !== null);
    expect(filled).toEqual([true, true, false]);
  });

  it('exposes a label as an image name', () => {
    render(<Glyph name="stepOver" label="Step over" />);
    const svg = screen.getByRole('img', { name: 'Step over' });
    expect(svg?.hasAttribute('aria-hidden')).toBe(false);
  });
});
