import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProAccess } from '@/hooks/useProAccess';
import { useSettingsStore } from '@/stores/settingsStore';

const mocks = vi.hoisted(() => ({ entitled: false }));
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => mocks.entitled }));

describe('useProAccess', () => {
  afterEach(() => {
    mocks.entitled = false;
    useSettingsStore.setState({ featureFlags: {} });
  });

  it('is full with the entitlement, whatever the flag', () => {
    mocks.entitled = true;
    expect(renderHook(() => useProAccess('EXECUTION_HISTORY')).result.current).toBe('full');
  });

  it('is a slice on Free with Pro in context, and locked without it', () => {
    expect(renderHook(() => useProAccess('DEV_UTILITIES')).result.current).toBe('locked');
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    expect(renderHook(() => useProAccess('DEV_UTILITIES')).result.current).toBe('slice');
  });

  it('keeps entitlements without a slice locked under the flag', () => {
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    expect(renderHook(() => useProAccess('LOCAL_AI')).result.current).toBe('locked');
  });

  it('reads the same rule outside React', async () => {
    const { currentProAccess } = await import('@/stores/proAccess');
    expect(currentProAccess('DEV_UTILITIES')).toBe('locked');
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    expect(currentProAccess('DEV_UTILITIES')).toBe('slice');
    expect(currentProAccess('NOTEBOOK_MODE')).toBe('locked');
  });
});

