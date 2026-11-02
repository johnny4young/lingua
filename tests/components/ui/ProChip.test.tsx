import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ProChip } from '../../../src/renderer/components/ui/ProChip';
import { _resetCommandBusForTesting, subscribeCommand } from '../../../src/renderer/stores/commandBus';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';

describe('ProChip', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    useSettingsStore.setState({ featureFlags: {} });
    _resetCommandBusForTesting();
  });

  it('is a plain mark without the flag', () => {
    render(<ProChip>44 earlier steps</ProChip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('44 earlier steps')).toBeTruthy();
  });

  it('opens Compare plans with Pro in context', () => {
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    const compare = vi.fn();
    subscribeCommand('plans.compare', compare);
    render(<ProChip>44 earlier steps</ProChip>);
    fireEvent.click(screen.getByTestId('pro-chip'));
    expect(compare).toHaveBeenCalled();
  });
});
