import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWidthTier } from '../../src/renderer/hooks/useWidthTier';

const WIDTHS = [420, 640] as const;

function Probe({ unmeasured }: { unmeasured?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = useWidthTier(ref, WIDTHS, unmeasured);
  return <div ref={ref} data-testid="probe" data-tier={tier} />;
}

function withWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);
}

afterEach(() => vi.restoreAllMocks());

describe('useWidthTier', () => {
  it('counts the widths the element reaches, a boundary included', () => {
    withWidth(419);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('probe').dataset.tier).toBe('0');
    unmount();
    withWidth(420);
    render(<Probe />);
    expect(screen.getByTestId('probe').dataset.tier).toBe('1');
  });

  it('takes the unmeasured tier for a zero width', () => {
    withWidth(0);
    render(<Probe unmeasured={2} />);
    expect(screen.getByTestId('probe').dataset.tier).toBe('2');
  });
});
