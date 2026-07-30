import { describe, expect, it } from 'vitest';
import {
  getLanguageSupportDescriptor,
  getLanguageSupportDescriptors,
} from '@/languageSupport/registry';
import {
  hasLanguageIntelligenceAdapter,
  loadLanguageIntelligenceAdapter,
} from '@/languageIntelligence';

describe('language support registry', () => {
  it('keeps Monaco registration ids unique', () => {
    const descriptors = getLanguageSupportDescriptors();
    const descriptorIds = descriptors.map(descriptor => descriptor.id);
    const monacoIds = descriptors
      .map(descriptor => descriptor.monaco?.id)
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
    // internal — editor providers are now lazily imported via loadEditorProviders
    // so the provider modules stay out of the initial bundle.
    expect(ruby?.loadEditorProviders).toEqual(expect.any(Function));
    const providers = await ruby?.loadEditorProviders?.();
    expect(providers?.createCompletionProvider).toEqual(expect.any(Function));
    expect(providers?.createHoverProvider).toEqual(expect.any(Function));
    expect(providers?.createSignatureHelpProvider).toEqual(expect.any(Function));
    expect((await ruby?.loadLanguageIntelligenceAdapter?.())?.language).toBe('ruby');
  });

  it('loads magic-comment providers for JavaScript, TypeScript, and Python', async () => {
    const javascript = await getLanguageSupportDescriptor('javascript')?.loadEditorProviders?.();
    const typescript = await getLanguageSupportDescriptor('typescript')?.loadEditorProviders?.();
    const python = await getLanguageSupportDescriptor('python')?.loadEditorProviders?.();

    expect(javascript?.createCompletionProvider).toEqual(expect.any(Function));
    expect(javascript?.createHoverProvider).toEqual(expect.any(Function));
    expect(typescript?.createCompletionProvider).toEqual(expect.any(Function));
    expect(typescript?.createHoverProvider).toEqual(expect.any(Function));
    expect(python?.createCompletionProviders).toHaveLength(1);
    expect(python?.createHoverProviders).toHaveLength(1);
  });

  it('loads local language-intelligence adapters from descriptors', async () => {
    expect(hasLanguageIntelligenceAdapter('python')).toBe(true);
    expect(hasLanguageIntelligenceAdapter('ruby')).toBe(true);
    expect(hasLanguageIntelligenceAdapter('go')).toBe(false);
    const firstPythonLoad = loadLanguageIntelligenceAdapter('python');
    const secondPythonLoad = loadLanguageIntelligenceAdapter('python');
    expect(firstPythonLoad).toBe(secondPythonLoad);
    expect((await firstPythonLoad)?.language).toBe('python');
    expect((await loadLanguageIntelligenceAdapter('ruby'))?.language).toBe('ruby');
    expect(await loadLanguageIntelligenceAdapter('go')).toBeNull();
  });
});
