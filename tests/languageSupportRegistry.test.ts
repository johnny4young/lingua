import { describe, expect, it } from 'vitest';
import {
  getLanguageSupportDescriptor,
  getLanguageSupportDescriptors,
} from '@/languageSupport/registry';
import { getLanguageIntelligenceAdapter } from '@/languageIntelligence';

describe('language support registry', () => {
  it('keeps Monaco registration ids unique', () => {
    const descriptors = getLanguageSupportDescriptors();
    const descriptorIds = descriptors.map((descriptor) => descriptor.id);
    const monacoIds = descriptors
      .map((descriptor) => descriptor.monaco?.id)
      .filter((id): id is string => Boolean(id));

    expect(new Set(descriptorIds).size).toBe(descriptorIds.length);
    expect(new Set(monacoIds).size).toBe(monacoIds.length);
  });

  it('keeps Ruby editor services isolated in the Ruby descriptor', async () => {
    const ruby = getLanguageSupportDescriptor('ruby');

    expect(ruby).toBeTruthy();
    expect(ruby?.monaco).toMatchObject({
      id: 'ruby',
      extensions: ['.rb'],
    });
    // RL-124 — editor providers are now lazily imported via loadEditorProviders
    // so the provider modules stay out of the initial bundle.
    expect(ruby?.loadEditorProviders).toEqual(expect.any(Function));
    const providers = await ruby?.loadEditorProviders?.();
    expect(providers?.createCompletionProvider).toEqual(expect.any(Function));
    expect(providers?.createHoverProvider).toEqual(expect.any(Function));
    expect(providers?.createSignatureHelpProvider).toEqual(expect.any(Function));
    expect(ruby?.createLanguageIntelligenceAdapter?.().language).toBe('ruby');
  });

  it('builds local language-intelligence adapters from descriptors', () => {
    expect(getLanguageIntelligenceAdapter('python')?.language).toBe('python');
    expect(getLanguageIntelligenceAdapter('ruby')?.language).toBe('ruby');
    expect(getLanguageIntelligenceAdapter('go')).toBeNull();
  });
});
