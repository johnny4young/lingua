import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RichValueText } from '../../../src/renderer/components/Console/RichValueText';

describe('RichValueText', () => {
  it('prints a logged string as its text', () => {
    const { container } = render(
      <RichValueText payload={{ kind: 'primitive', type: 'string', repr: '"a\\nb"' }} fallbackText="" />
    );
    expect(container.textContent).toBe('a\nb');
  });

  it('keeps the truncation marker of a clamped string', () => {
    const { container } = render(
      <RichValueText payload={{ kind: 'primitive', type: 'string', repr: '"long text…' }} fallbackText="" />
    );
    expect(container.textContent).toBe('long text…');
  });

  it('leaves other primitives as their repr', () => {
    const { container } = render(
      <RichValueText payload={{ kind: 'primitive', type: 'number', repr: '41.2' }} fallbackText="" />
    );
    expect(container.textContent).toBe('41.2');
  });
});
