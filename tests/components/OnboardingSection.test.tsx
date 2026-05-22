import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import i18next from 'i18next';
import { OnboardingSection } from '../../src/renderer/components/Settings/OnboardingSection';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('OnboardingSection', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    act(() => {
      useSettingsStore.setState({
        hasCompletedOnboardingWelcome: true,
        hasCompletedOnboardingFirstRun: true,
        hasCompletedOnboardingFirstSnippet: true,
        onboardingWelcomeSeedVersion: 1,
      });
      useUIStore.setState({ statusNotice: null });
    });
  });

  it('renders all three reset toggles in the ON state when every stage completed', () => {
    render(<OnboardingSection />);
    expect(
      screen.getByRole('switch', { name: /Re-seed welcome scratchpad/u })
    .getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('switch', { name: /Re-arm first-run tip/u })
    .getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('switch', { name: /Re-arm first-save tip/u })
    .getAttribute('aria-checked')).toBe('true');
  });

  it('flipping the welcome toggle resets the flag + seed version + fires confirmation notice', () => {
    render(<OnboardingSection />);
    const toggle = screen.getByRole('switch', {
      name: /Re-seed welcome scratchpad/u,
    });
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useSettingsStore.getState().hasCompletedOnboardingWelcome).toBe(
      false
    );
    expect(useSettingsStore.getState().onboardingWelcomeSeedVersion).toBe(0);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'onboarding.notice.welcomeReplay'
    );
  });

  it('flipping the first-run toggle only resets the first-run flag', () => {
    render(<OnboardingSection />);
    const toggle = screen.getByRole('switch', {
      name: /Re-arm first-run tip/u,
    });
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useSettingsStore.getState().hasCompletedOnboardingFirstRun).toBe(
      false
    );
    expect(useSettingsStore.getState().hasCompletedOnboardingWelcome).toBe(
      true
    );
    expect(
      useSettingsStore.getState().hasCompletedOnboardingFirstSnippet
    ).toBe(true);
  });

  it('attempting to flip an OFF toggle (flag already false) is a no-op', () => {
    act(() => {
      useSettingsStore.setState({ hasCompletedOnboardingFirstRun: false });
    });
    render(<OnboardingSection />);
    const toggle = screen.getByRole('switch', {
      name: /Re-arm first-run tip/u,
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useSettingsStore.getState().hasCompletedOnboardingFirstRun).toBe(
      false
    );
  });

  it('fold F — the preview block toggles open and shows the seed source', () => {
    render(<OnboardingSection />);
    const previewToggle = screen.getByTestId(
      'onboarding-section-preview-toggle'
    );
    expect(previewToggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.queryByTestId('onboarding-section-preview-source')
    ).toBeNull();
    act(() => {
      fireEvent.click(previewToggle);
    });
    expect(previewToggle.getAttribute('aria-expanded')).toBe('true');
    const source = screen.getByTestId('onboarding-section-preview-source');
    expect(source.textContent ?? '').toMatch(/console\.table\(/);
  });
});
