import {
  isRuntimeModeSupportedInShell,
  type RuntimeMode,
} from '../../shared/runtimeModes';
import type { Language } from '../types/language';
import { languageCapabilityBadgeKey } from './languageMeta';

function isWebRuntimeShell(): boolean {
  return typeof window !== 'undefined' && window.lingua?.platform === 'web';
}

export function supportsRuntimeModeHere(mode: RuntimeMode): boolean {
  return isRuntimeModeSupportedInShell(mode, isWebRuntimeShell());
}

/** Why the web shell cannot execute a tab, independent of plan gates. */
export function webExecutionBoundary(
  language: Language,
  runtimeMode: RuntimeMode | undefined,
  webShell: boolean = isWebRuntimeShell()
): 'language' | 'runtime' | null {
  if (!webShell) return null;
  if (languageCapabilityBadgeKey(language) === 'language.capability.desktopOnly') return 'language';
  if (runtimeMode !== undefined && !isRuntimeModeSupportedInShell(runtimeMode, true)) return 'runtime';
  return null;
}
