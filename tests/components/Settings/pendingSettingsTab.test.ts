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
  setPendingSettingsTab,
  takePendingSettingsTab,
} from '../../../src/renderer/components/Settings/pendingSettingsTab';

describe('pendingSettingsTab', () => {
  beforeEach(() => {
    takePendingSettingsTab();
  });

  it('returns null when nothing is pending', () => {
    expect(takePendingSettingsTab()).toBeNull();
  });

  it('hands the stashed tab to the next reader', () => {
    setPendingSettingsTab('account');
    expect(takePendingSettingsTab()).toBe('account');
  });

  it('is one-shot, so a tab never re-selects itself on a later open', () => {
    // The failure this prevents: the user opens Settings from the upsell,
    // closes it, opens it again from the toolbar, and lands on Account again
    // for no reason they can see.
    setPendingSettingsTab('account');
    expect(takePendingSettingsTab()).toBe('account');
    expect(takePendingSettingsTab()).toBeNull();
  });

  it('keeps only the most recent request', () => {
    setPendingSettingsTab('account');
    setPendingSettingsTab('privacy');
    expect(takePendingSettingsTab()).toBe('privacy');
  });
});
