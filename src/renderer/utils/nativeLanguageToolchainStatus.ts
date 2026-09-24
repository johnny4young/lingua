import type { NativeJsRuntimeStatus } from './nativeJsRuntimeStatus';

export type NativeLanguageToolchain = 'go' | 'rust';
export type NativeLanguageToolchainAvailability = Record<
  NativeLanguageToolchain,
  NativeJsRuntimeStatus
>;

export function isNativeLanguageToolchain(language: string): language is NativeLanguageToolchain {
  return language === 'go' || language === 'rust';
}

export function nativeLanguageToolchainHintKey(status: NativeJsRuntimeStatus): string {
  if (status === 'installed') return 'nativeToolchain.availability.ready';
  if (status === 'missing') return 'nativeToolchain.availability.missing';
  if (status === 'check-failed') return 'nativeToolchain.availability.checkFailed';
  return 'nativeToolchain.availability.checking';
}
