import {
  isRuntimeModeSupportedInShell,
  type RuntimeMode,
} from '../../shared/runtimeModes';

function isWebRuntimeShell(): boolean {
  return typeof window !== 'undefined' && window.lingua?.platform === 'web';
}

export function supportsRuntimeModeHere(mode: RuntimeMode): boolean {
  return isRuntimeModeSupportedInShell(mode, isWebRuntimeShell());
}
