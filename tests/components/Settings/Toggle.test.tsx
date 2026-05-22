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
