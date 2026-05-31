/**
 * FASE 0 — Signal-Slate <StatusBadge> render contract.
 *
 * Covers:
 *   - Each tone maps to its expected DS token class triple.
 *   - The base mono/uppercase chrome is always present.
 *   - `dot` renders a `bg-current` span only when set.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StatusBadge,
  type StatusBadgeTone,
} from '../../src/renderer/components/ui/StatusBadge';

function renderBadge(tone: StatusBadgeTone, dot = false) {
  const { container } = render(
    <StatusBadge tone={tone} dot={dot}>
      {tone}
    </StatusBadge>
  );
  return container.querySelector<HTMLElement>('[data-status-tone]');
}

const TONE_CLASSES: Record<StatusBadgeTone, string[]> = {
  free: ['bg-transparent', 'text-fg-muted', 'border-border'],
  pro: ['bg-slate-100', 'text-accent-fg', 'border-slate-300'],
  unsaved: ['bg-warning-bg', 'text-warning-fg', 'border-warning-border'],
  success: ['bg-success-bg', 'text-success-fg', 'border-success-border'],
  error: ['bg-error-bg', 'text-error-fg', 'border-error-border'],
  warning: ['bg-warning-bg', 'text-warning-fg', 'border-warning-border'],
  info: ['bg-info-bg', 'text-info-fg', 'border-info-border'],
  neutral: ['bg-bg-panel-alt', 'text-fg-muted', 'border-border-subtle'],
};

describe('FASE 0 — <StatusBadge>', () => {
  it('renders the tone label and reflects the tone on the data attribute', () => {
    const badge = renderBadge('pro');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-status-tone')).toBe('pro');
    expect(badge?.textContent).toContain('pro');
  });

  it('applies the always-on mono/uppercase chrome', () => {
    const badge = renderBadge('neutral');
    for (const cls of ['inline-flex', 'font-mono', 'uppercase', 'rounded-sm', 'border']) {
      expect(badge?.classList.contains(cls)).toBe(true);
    }
  });

  it.each(Object.entries(TONE_CLASSES))(
    'maps tone "%s" to its expected token classes',
    (tone, classes) => {
      const badge = renderBadge(tone as StatusBadgeTone);
      for (const cls of classes) {
        expect(badge?.classList.contains(cls)).toBe(true);
      }
    }
  );

  it('renders no dot by default', () => {
    const badge = renderBadge('success');
    expect(badge?.querySelector('span.bg-current')).toBeNull();
  });

  it('renders a bg-current dot when dot is set', () => {
    const badge = renderBadge('success', true);
    const dot = badge?.querySelector<HTMLElement>('span.bg-current');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('rounded-full')).toBe(true);
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });
});
