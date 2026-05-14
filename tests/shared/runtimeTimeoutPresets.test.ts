import { describe, expect, it } from 'vitest';
import {
  defaultRuntimeTimeoutPreset,
  defaultRuntimeTimeoutPresetSeed,
  isRuntimeTimeoutPreset,
  isRuntimeTimeoutSupportedLanguage,
  presetToMs,
  resolveTimeoutMs,
  RUNTIME_TIMEOUT_PRESETS,
  RUNTIME_TIMEOUT_PRESET_VALUES,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET,
} from '../../src/shared/runtimeTimeoutPresets';

describe('RL-020 Slice 7 — runtimeTimeoutPresets', () => {
  it('exposes the closed preset enum', () => {
    expect(RUNTIME_TIMEOUT_PRESETS).toEqual([
      'quick',
      'normal',
      'long',
      'extended',
    ]);
    expect(RUNTIME_TIMEOUT_PRESET_VALUES.size).toBe(4);
  });

  it('exposes the closed supported-language enum (no Rust)', () => {
    expect(RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES).toEqual([
      'javascript',
      'typescript',
      'python',
      'go',
    ]);
    expect(RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET.has('rust')).toBe(false);
  });

  it('isRuntimeTimeoutPreset accepts only the closed set', () => {
    expect(isRuntimeTimeoutPreset('quick')).toBe(true);
    expect(isRuntimeTimeoutPreset('normal')).toBe(true);
    expect(isRuntimeTimeoutPreset('long')).toBe(true);
    expect(isRuntimeTimeoutPreset('extended')).toBe(true);
    expect(isRuntimeTimeoutPreset('pizza')).toBe(false);
    expect(isRuntimeTimeoutPreset('')).toBe(false);
    expect(isRuntimeTimeoutPreset(undefined)).toBe(false);
    expect(isRuntimeTimeoutPreset(5)).toBe(false);
  });

  it('isRuntimeTimeoutSupportedLanguage gates only the four runners', () => {
    expect(isRuntimeTimeoutSupportedLanguage('javascript')).toBe(true);
    expect(isRuntimeTimeoutSupportedLanguage('typescript')).toBe(true);
    expect(isRuntimeTimeoutSupportedLanguage('python')).toBe(true);
    expect(isRuntimeTimeoutSupportedLanguage('go')).toBe(true);
    expect(isRuntimeTimeoutSupportedLanguage('rust')).toBe(false);
    expect(isRuntimeTimeoutSupportedLanguage('ruby')).toBe(false);
    expect(isRuntimeTimeoutSupportedLanguage('')).toBe(false);
  });

  it('defaultRuntimeTimeoutPreset is Long for Python, Normal for the rest', () => {
    expect(defaultRuntimeTimeoutPreset('javascript')).toBe('normal');
    expect(defaultRuntimeTimeoutPreset('typescript')).toBe('normal');
    expect(defaultRuntimeTimeoutPreset('go')).toBe('normal');
    expect(defaultRuntimeTimeoutPreset('python')).toBe('long');
    expect(defaultRuntimeTimeoutPreset('rust')).toBe('normal');
    expect(defaultRuntimeTimeoutPreset('unknown')).toBe('normal');
  });

  it('presetToMs maps to the expected millisecond budget', () => {
    expect(presetToMs('quick')).toBe(5_000);
    expect(presetToMs('normal')).toBe(30_000);
    expect(presetToMs('long')).toBe(120_000);
    expect(presetToMs('extended')).toBe(300_000);
  });

  it('resolveTimeoutMs picks the preset value when present', () => {
    expect(resolveTimeoutMs('javascript', 'quick')).toBe(5_000);
    expect(resolveTimeoutMs('typescript', 'normal')).toBe(30_000);
    expect(resolveTimeoutMs('python', 'long')).toBe(120_000);
    expect(resolveTimeoutMs('go', 'extended')).toBe(300_000);
  });

  it('resolveTimeoutMs falls back to the language default when preset is missing', () => {
    expect(resolveTimeoutMs('javascript', undefined)).toBe(30_000);
    expect(resolveTimeoutMs('python', undefined)).toBe(120_000);
    expect(resolveTimeoutMs('typescript', null)).toBe(30_000);
    expect(resolveTimeoutMs('go', undefined)).toBe(30_000);
  });

  it('resolveTimeoutMs falls back to normal for unsupported language', () => {
    expect(resolveTimeoutMs('rust', undefined)).toBe(30_000);
    expect(resolveTimeoutMs('made-up', undefined)).toBe(30_000);
  });

  it('defaultRuntimeTimeoutPresetSeed returns a fresh object each call', () => {
    const a = defaultRuntimeTimeoutPresetSeed();
    const b = defaultRuntimeTimeoutPresetSeed();
    expect(a).toEqual({
      javascript: 'normal',
      typescript: 'normal',
      python: 'long',
      go: 'normal',
    });
    expect(a).not.toBe(b);
  });
});
