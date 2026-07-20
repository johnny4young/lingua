/**
 * accessibility pass — shared live announcer.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { useAnnouncerStore, announce } from '@/stores/announcerStore';

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    useAnnouncerStore.setState({ message: '', nonce: 0 });
  });

  it('is a polite, atomic status region that starts empty', () => {
    render(<LiveAnnouncer />);
    const region = screen.getByTestId('live-announcer');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');
  });

  it('renders an announced message', () => {
    render(<LiveAnnouncer />);
    act(() => announce('12 results'));
    expect(screen.getByTestId('live-announcer').textContent?.trim()).toBe('12 results');
  });

  it('mutates the text node when the same message is announced twice', () => {
    render(<LiveAnnouncer />);
    act(() => announce('Run complete'));
    const first = screen.getByTestId('live-announcer').textContent;
    act(() => announce('Run complete'));
    const second = screen.getByTestId('live-announcer').textContent;
    // Same human-readable message, but the raw text node differs (trailing
    // space toggles) so a screen reader re-announces it.
    expect(first).not.toBe(second);
    expect(first?.trim()).toBe('Run complete');
    expect(second?.trim()).toBe('Run complete');
  });
});
