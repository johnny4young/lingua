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

  it('keeps Ruby editor services isolated in the Ruby descriptor', () => {
    const ruby = getLanguageSupportDescriptor('ruby');

    expect(ruby).toBeTruthy();
    expect(ruby?.monaco).toMatchObject({
      id: 'ruby',
      extensions: ['.rb'],
    });
    expect(ruby?.createCompletionProvider).toEqual(expect.any(Function));
    expect(ruby?.createHoverProvider).toEqual(expect.any(Function));
    expect(ruby?.createSignatureHelpProvider).toEqual(expect.any(Function));
    expect(ruby?.createLanguageIntelligenceAdapter?.().language).toBe('ruby');
  });

  it('builds local language-intelligence adapters from descriptors', () => {
    expect(getLanguageIntelligenceAdapter('python')?.language).toBe('python');
    expect(getLanguageIntelligenceAdapter('ruby')?.language).toBe('ruby');
    expect(getLanguageIntelligenceAdapter('go')).toBeNull();
  });
});
