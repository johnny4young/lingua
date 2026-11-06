import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/hooks/useTelemetry', () => ({ useTelemetry: () => ({ track }) }));

import { ConsoleEntryRenderer } from '@/components/Console/ConsoleEntryRenderer';
import { RichValueProgress } from '@/components/Console/RichValueProgress';

describe('progress bars in the console', () => {
  it('draws the bar with its percent, rounded down, and its note', () => {
    render(<RichValueProgress payload={{ kind: 'progress', id: 'r:1', label: 'import', value: 0.999, text: '16 / 25' }} />);
    const bar = screen.getByRole('progressbar', { name: 'import' });
    expect(bar.getAttribute('aria-valuenow')).toBe('99');
    expect(screen.getByTestId('rich-value-progress').textContent).toBe('import99%16 / 25');
  });

  it('keeps a malformed value inside the track', () => {
    const { rerender } = render(<RichValueProgress payload={{ kind: 'progress', id: 'r:1', label: '', value: 5 }} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(<RichValueProgress payload={{ kind: 'progress', id: 'r:1', label: '', value: 'x' as unknown as number }} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('is what a console row with a progress payload renders, and reports it once per bar', () => {
    const { rerender } = render(<ConsoleEntryRenderer payloads={[{ kind: 'progress', id: 'r:9', label: 'files', value: 0.5 }]} fallbackText="files 50%" />);
    rerender(<ConsoleEntryRenderer payloads={[{ kind: 'progress', id: 'r:9', label: 'files', value: 1 }]} fallbackText="files 100%" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(track.mock.calls.filter(([event]) => event === 'runtime.console_rich_rendered')).toHaveLength(1);
  });
});
