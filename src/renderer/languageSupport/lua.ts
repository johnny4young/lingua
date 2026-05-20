import { createLuaCompletionProvider } from '../components/Editor/completionProviders/luaCompletions';
import type { LanguageSupportDescriptor } from './types';

export const luaLanguageSupport = {
  id: 'lua',
  monaco: {
    id: 'lua',
    extensions: ['.lua'],
    aliases: ['Lua'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/lua/lua.js'),
  },
  createCompletionProvider: createLuaCompletionProvider,
} satisfies LanguageSupportDescriptor;
