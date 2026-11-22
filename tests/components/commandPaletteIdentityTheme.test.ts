import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import '../../src/renderer/i18n/startCatalog';
import { buildCommandPaletteModel } from '../../src/renderer/components/CommandPalette/commandPaletteModel';
import {
  IDENTITY_THEME_COMMAND_ID,
  commandGroupFor,
  groupCommands,
} from '../../src/renderer/components/CommandPalette/commandPaletteGroups';
import { switchIdentityTheme } from '../../src/renderer/stores/identityThemeSwitch';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const initialSettings = useSettingsStore.getState();

function themeCommand(target: 'ink' | 'paper', onSwitch = vi.fn(), onClose = vi.fn()) {
  const commands = buildCommandPaletteModel({
    templates: [],
    snippets: [],
    onClose,
    identityThemeTarget: target,
    onSwitchIdentityTheme: onSwitch,
    t: i18next.t.bind(i18next),
  } as never);
  return commands.find((command) => command.id === IDENTITY_THEME_COMMAND_ID);
}

describe('palette identity theme command', () => {
  it('names the theme it switches to and runs under Settings', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    const toPaper = themeCommand('paper', onSwitch, onClose);
    expect(toPaper?.label).toBe('Theme: switch to Lingua Paper');
    expect(themeCommand('ink')?.label).toBe('Theme: switch to Lingua Ink');
    expect(commandGroupFor(toPaper!)).toBe('settings');
    expect(groupCommands([toPaper!]).map((group) => group.id)).toEqual(['settings']);

    toPaper!.action();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('is absent without a target', () => {
    const commands = buildCommandPaletteModel({
      templates: [],
      snippets: [],
      onClose: vi.fn(),
      t: i18next.t.bind(i18next),
    } as never);
    expect(commands.some((command) => command.id === IDENTITY_THEME_COMMAND_ID)).toBe(false);
  });
});

describe('switchIdentityTheme', () => {
  beforeEach(() => useSettingsStore.setState(initialSettings, true));

  it('flips polarity inside Ink and Paper without touching font or layout', () => {
    useSettingsStore.setState({ fontSize: 18, layoutPreset: 'vertical' });
    switchIdentityTheme('paper');
    expect(useSettingsStore.getState()).toMatchObject({
      editorTheme: 'lingua-paper',
      theme: 'light',
      fontSize: 18,
      layoutPreset: 'vertical',
    });
  });

  it('applies the Ink pack from any other theme', () => {
    useSettingsStore.setState({ editorTheme: 'dracula', themePack: 'default', fontFamily: 'Menlo, monospace' });
    switchIdentityTheme('ink');
    expect(useSettingsStore.getState()).toMatchObject({ editorTheme: 'lingua-ink', themePack: 'lingua-ink' });
  });
});
