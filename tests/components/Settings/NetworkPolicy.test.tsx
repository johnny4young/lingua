import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { AiSourceRow, NetworkFromRunningCodeRow } from '@/components/Settings/NetworkPolicyRows';
import { LabsSection } from '@/components/Settings/LabsSection';
import { NetworkAskDialog } from '@/components/NetworkAsk/NetworkAskDialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { askNetworkHost, useNetworkAskStore } from '@/stores/networkAskStore';
import { _resetCommandBusForTesting, subscribeCommand } from '@/stores/commandBus';
import { settingsMerge } from '@/stores/settingsMerge';
import { useTrustEventStore } from '@/stores/trustEventStore';

const initialSettings = useSettingsStore.getState();
const initialAi = useAiConfigStore.getState();

beforeEach(async () => {
  useSettingsStore.setState(initialSettings, true);
  useAiConfigStore.setState(initialAi, true);
  useNetworkAskStore.setState({ answers: {}, queue: [] });
  initI18n('en');
  await i18next.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  _resetCommandBusForTesting();
});

describe('Network from running code row', () => {
  it('stays hidden until the Labs flag is on', () => {
    render(<NetworkFromRunningCodeRow />);
    expect(screen.queryByTestId('privacy-network-policy')).toBeNull();
  });

  it('switches the policy with the segmented control', () => {
    useSettingsStore.setState({ featureFlags: { networkPolicy: true } });
    render(<NetworkFromRunningCodeRow />);
    expect(screen.getByRole('button', { name: 'Allow' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(useSettingsStore.getState().networkFromRunningCode).toBe('block');
    expect(screen.getByText(/Node, Deno, Bun, Go and Rust run natively/)).toBeTruthy();
  });
});

describe('AI assistance source row', () => {
  it('reads the source from Account › AI and links there', () => {
    const navigate = vi.fn();
    subscribeCommand('settings.navigate', navigate);
    render(<AiSourceRow />);
    expect(screen.getByTestId('privacy-ai-source').textContent).toBe('Not configured');
    fireEvent.click(screen.getByTestId('privacy-ai-source-open'));
    expect(navigate).toHaveBeenCalledWith(
      { tab: 'account', targetId: 'section-ai' },
      expect.anything()
    );
    cleanup();

    useAiConfigStore.setState({ endpoint: 'http://localhost:11434/v1', model: 'qwen2.5-coder' });
    render(<AiSourceRow />);
    expect(screen.getByTestId('privacy-ai-source').textContent).toBe('Local · qwen2.5-coder');
    cleanup();

    useAiConfigStore.setState({ endpoint: 'https://api.example.dev/v1' });
    render(<AiSourceRow />);
    expect(screen.getByTestId('privacy-ai-source').textContent).toBe('Endpoint · api.example.dev');
  });
});

describe('Labs', () => {
  it('turns the network policy flag on and off', () => {
    render(<LabsSection />);
    const toggle = screen.getByTestId('labs-flag-networkPolicy');
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().featureFlags).toEqual({ networkPolicy: true });
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().featureFlags).toEqual({});
  });
});

describe('Network ask dialog', () => {
  it('names the host and runtime and resolves the waiting run', async () => {
    render(<NetworkAskDialog />);
    expect(screen.queryByTestId('network-ask-dialog')).toBeNull();
    const answer = askNetworkHost('tab-1', 'api.example', 'pyodide');
    expect(await screen.findByTestId('network-ask-host')).toBeTruthy();
    expect(screen.getByTestId('network-ask-host').textContent).toBe('api.example');
    expect(screen.getByText(/Code running in Pyodide in this tab/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('network-ask-allow'));
    await expect(answer).resolves.toBe(true);
    expect(useNetworkAskStore.getState().answers['tab-1']).toEqual({ 'api.example': 'allow' });
  });

  it('blocks on Escape', async () => {
    render(<NetworkAskDialog />);
    const answer = askNetworkHost('tab-1', 'api.example', 'worker');
    fireEvent.keyDown(await screen.findByTestId('network-ask-dialog'), { key: 'Escape' });
    await expect(answer).resolves.toBe(false);
  });
});

describe('settings persistence', () => {
  it('drops an unknown policy and unknown flags on rehydrate', () => {
    const merged = settingsMerge(
      { networkFromRunningCode: 'deny', featureFlags: { networkPolicy: true, other: true } },
      useSettingsStore.getState()
    );
    expect(merged.networkFromRunningCode).toBe('allow');
    expect(merged.featureFlags).toEqual({ networkPolicy: true });
  });

  it('keeps Run Ledger and running-code events in the trust feed', () => {
    useTrustEventStore.getState().clear();
    useTrustEventStore
      .getState()
      .record({ feature: 'run-ledger', action: 'enabled', sensitivity: 'low', summary: '' });
    useTrustEventStore
      .getState()
      .record({ feature: 'network', action: 'blocked', sensitivity: 'low', summary: '' });
    expect(useTrustEventStore.getState().events.map(event => event.feature)).toEqual([
      'run-ledger',
      'network',
    ]);
  });
});
