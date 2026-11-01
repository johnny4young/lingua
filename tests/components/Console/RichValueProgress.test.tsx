import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsoleEntryRenderer } from '@/components/Console/ConsoleEntryRenderer';
import { RichValueProgress } from '@/components/Console/RichValueProgress';

describe('progress bars in the console', () => {
  it('draws the bar with its percent, rounded down, and its note', () => {
    render(<RichValueProgress payload={{ kind: 'progress', id: 'r:1', label: 'import', value: 0.999, text: '16 / 25' }} />);
    const bar = screen.getByRole('progressbar', { name: 'import' });
    expect(bar.getAttribute('aria-valuenow')).toBe('99');
    expect(screen.getByTestId('rich-value-progress').textContent).toBe('import99%16 / 25');
  });

  it('is what a console row with a progress payload renders', () => {
    render(<ConsoleEntryRenderer payloads={[{ kind: 'progress', id: 'r:1', label: 'files', value: 1 }]} fallbackText="files 100%" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
