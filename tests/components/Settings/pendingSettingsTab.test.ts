/**
 * Guards the handoff that routes an upsell CTA to Settings → Account.
 *
 * This exists because the previous mechanism — open Settings, then emit
 * `settings.navigate` two animation frames later — silently stopped working
 * the moment `SettingsModal` moved behind a lazy boundary. Two frames is not
 * a chunk fetch, so the command fired before anything was listening and users
 * clicking "See what Pro includes" landed on the General tab. The e2e suite
 * caught it; nothing at this tier did.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingSettingsTab,
  peekPendingSettingsTab,
  setPendingSettingsTab,
} from '../../../src/renderer/components/Settings/pendingSettingsTab';

describe('pendingSettingsTab', () => {
  beforeEach(() => {
    clearPendingSettingsTab();
  });

  it('returns null when nothing is pending', () => {
    expect(peekPendingSettingsTab()).toBeNull();
  });

  it('hands the stashed tab to the reader', () => {
    setPendingSettingsTab('account');
    expect(peekPendingSettingsTab()).toBe('account');
  });

  it('does not consume on read', () => {
    // The invariant that broke. The reader is a `useState` initializer, so it
    // runs during render — and SettingsModal is lazy, so its first render
    // suspends and is discarded. A consuming read spent the tab on that dead
    // render and the real mount got nothing: Settings opened on General and
    // the upsell CTA silently failed, on CI only, where the chunk fetch is
    // slow enough to actually suspend.
    setPendingSettingsTab('account');
    expect(peekPendingSettingsTab()).toBe('account');
    expect(peekPendingSettingsTab()).toBe('account');
  });

  it('is one-shot once cleared, so a tab never re-selects itself later', () => {
    setPendingSettingsTab('account');
    clearPendingSettingsTab();
    expect(peekPendingSettingsTab()).toBeNull();
  });

  it('keeps only the most recent request', () => {
    setPendingSettingsTab('account');
    setPendingSettingsTab('privacy');
    expect(peekPendingSettingsTab()).toBe('privacy');
  });
});
