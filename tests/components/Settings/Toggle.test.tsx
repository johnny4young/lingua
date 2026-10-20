import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from '@/components/Settings/shared';

describe('Settings shared Toggle', () => {
  it('forwards stable test ids to the underlying switch button', () => {
    const onChange = vi.fn();

    render(
      <Toggle
        value={true}
        onChange={onChange}
        aria-label="Output source mapping"
        data-testid="settings-editor-output-source-mapping-master-toggle"
      />
    );

    const toggle = screen.getByTestId(
      'settings-editor-output-source-mapping-master-toggle'
    );
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Settings shared Toggle size', () => {
  it('draws a 36×20 track with a 16px knob that moves 16px when on', () => {
    const { rerender } = render(<Toggle value={false} onChange={vi.fn()} aria-label="Word wrap" />);
    const toggle = screen.getByRole('switch', { name: 'Word wrap' });
    expect(toggle.className).toContain('h-5');
    expect(toggle.className).toContain('w-9');
    const knob = toggle.querySelector('span');
    expect(knob?.className).toContain('h-4 w-4');
    expect(knob?.style.transform).toBe('translateX(0px)');
    rerender(<Toggle value={true} onChange={vi.fn()} aria-label="Word wrap" />);
    expect(screen.getByRole('switch', { name: 'Word wrap' }).querySelector('span')?.style.transform).toBe(
      'translateX(16px)'
    );
  });
});
