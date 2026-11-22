import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDot, RunStateGlyph } from '../../../src/renderer/components/ui/RunStateGlyph';
import { RUN_STATES, TAB_RUN_STATES } from '../../../src/renderer/components/ui/runState';

describe('RunStateGlyph', () => {
  it.each(RUN_STATES)('draws the %s rail segment', (state) => {
    const { container } = render(<RunStateGlyph state={state} />);
    const svg = container.querySelector(`svg[data-run-state="${state}"]`);
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 22 30');
    expect(svg!.childElementCount).toBeGreaterThan(0);
  });

  it('marks a raised line in the error colour and nothing else', () => {
    const { container } = render(<RunStateGlyph state="raised" />);
    expect(container.querySelectorAll('[stroke="var(--rs-error)"]')).toHaveLength(1);
    const { container: answered } = render(<RunStateGlyph state="answered" />);
    expect(answered.querySelector('[stroke="var(--rs-error)"]')).toBe(null);
  });

  it('dims a stale line instead of lighting it', () => {
    const { container } = render(<RunStateGlyph state="stale" />);
    expect(container.querySelector('[stroke="var(--rs-pulse)"]')).toBe(null);
    expect(container.querySelector('[stroke="var(--rs-stale-line)"]')).not.toBe(null);
  });

  it('names the state when a label is given', () => {
    render(<RunStateGlyph state="paused" label="Paused" />);
    expect(screen.getByRole('img', { name: 'Paused' }).getAttribute('data-run-state')).toBe('paused');
  });
});

describe('RunDot', () => {
  it.each(TAB_RUN_STATES)('renders the %s dot', (state) => {
    const { container } = render(<RunDot state={state} />);
    expect(container.querySelector(`[data-run-dot="${state}"]`)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the dot when a label is given', () => {
    render(<RunDot state="error" label="Last run failed" />);
    expect(screen.getByRole('img', { name: 'Last run failed' }).getAttribute('data-run-dot')).toBe('error');
  });
});
