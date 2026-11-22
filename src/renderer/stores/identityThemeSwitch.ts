import { INK_THEME_PACK_ID, PAPER_THEME_PACK_ID } from '../data/themePacks';
import { identityPaletteFor } from '../utils/editorThemeCatalog';
import { useSettingsStore } from './settingsStore';

/**
 * Within Ink/Paper a switch only flips polarity, keeping font, size and
 * layout; from any other theme it applies the target pack.
 */
export function switchIdentityTheme(target: 'ink' | 'paper'): void {
  const state = useSettingsStore.getState();
  if (identityPaletteFor(state.editorTheme)) {
    state.setTheme(target === 'paper' ? 'light' : 'dark');
  } else {
    state.applyThemePack(target === 'paper' ? PAPER_THEME_PACK_ID : INK_THEME_PACK_ID);
  }
}
