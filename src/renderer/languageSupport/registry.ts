import { fileTypeLanguageSupports } from './fileTypes';
import { goLanguageSupport } from './go';
import { javascriptLanguageSupport } from './javascript';
import { luaLanguageSupport } from './lua';
import { pythonLanguageSupport } from './python';
import { rubyLanguageSupport } from './ruby';
import { rustLanguageSupport } from './rust';
import { typescriptLanguageSupport } from './typescript';
import type { LanguageSupportDescriptor } from './types';

const languageSupportDescriptors = [
  javascriptLanguageSupport,
  typescriptLanguageSupport,
  goLanguageSupport,
  pythonLanguageSupport,
  rustLanguageSupport,
  luaLanguageSupport,
  rubyLanguageSupport,
  ...fileTypeLanguageSupports,
] satisfies readonly LanguageSupportDescriptor[];

export function getLanguageSupportDescriptors(): readonly LanguageSupportDescriptor[] {
  return languageSupportDescriptors;
}

export function getLanguageSupportDescriptor(
  languageId: string | null | undefined
): LanguageSupportDescriptor | null {
  if (!languageId) return null;
  return (
    languageSupportDescriptors.find((descriptor) => descriptor.id === languageId) ??
    null
  );
}
