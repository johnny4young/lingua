/**
 * internal — Trust-boundary modal renders + acknowledge / cancel
 * paths + Escape semantics + persisted-flag flip.
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { NativeExecutionWarning } from '@/components/NativeExecutionWarning/NativeExecutionWarning';
import { useNativeExecutionGateStore } from '@/stores/nativeExecutionGateStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('NativeExecutionWarning', () => {
  const initialSettings = useSettingsStore.getState();
  const initialGate = useNativeExecutionGateStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(
      { ...initialSettings, nativeExecutionAcknowledged: false },
      true
    );
    useNativeExecutionGateStore.setState(initialGate, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useNativeExecutionGateStore.setState(initialGate, true);
  });

  it('renders nothing when no run is pending', () => {
    const { container } = render(<NativeExecutionWarning />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal when a run is gated', () => {
    useNativeExecutionGateStore.getState().request('go', () => {});
    render(<NativeExecutionWarning />);
    expect(screen.getByTestId('native-execution-warning')).toBeTruthy();
    expect(
      screen.getByText('Run code with your local toolchain?')
    ).toBeTruthy();
  });

  it('explains the broader project-test trust boundary', () => {
    useNativeExecutionGateStore.getState().request('project-tests', () => {});
    render(<NativeExecutionWarning />);

    expect(screen.getByText("Run this project's tests locally?")).toBeTruthy();
    expect(screen.getByText(/dependencies execute as regular processes/)).toBeTruthy();
  });

  it('explains that the project terminal is a real shell, not a sandbox', () => {
    useNativeExecutionGateStore.getState().request('project-terminal', () => {});
    render(<NativeExecutionWarning />);

    expect(screen.getByText('Start a local shell for this project?')).toBeTruthy();
    expect(screen.getByText(/real system shell, not a sandbox/)).toBeTruthy();
    expect(screen.getByText(/commands can navigate elsewhere/)).toBeTruthy();
  });

  it('Acknowledge flips the persisted flag and invokes the resume callback', async () => {
    const resume = vi.fn();
    useNativeExecutionGateStore.getState().request('rust', resume);
    const user = userEvent.setup();

    render(<NativeExecutionWarning />);
    await user.click(screen.getByTestId('native-execution-warning-confirm'));

    expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    // Modal unmounts because the gate state cleared.
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
  });

  it('Cancel clears the gate without flipping the flag or invoking resume', async () => {
    const resume = vi.fn();
    useNativeExecutionGateStore.getState().request('go', resume);
    const user = userEvent.setup();

    render(<NativeExecutionWarning />);
    await user.click(screen.getByTestId('native-execution-warning-cancel'));

    expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
  });

  it('Escape cancels the gate without flipping the flag', () => {
    const resume = vi.fn();
    useNativeExecutionGateStore.getState().request('go', resume);

    render(<NativeExecutionWarning />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
  });
});
