import type { LanguageSupportDescriptor } from './types';

export const luaLanguageSupport = {
  id: 'lua',
  monaco: {
    id: 'lua',
    extensions: ['.lua'],
    aliases: ['Lua'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/lua/lua.js'),
  },
  loadEditorProviders: async () => {
    const { createLuaCompletionProvider } = await import(
      '../components/Editor/completionProviders/luaCompletions'
    );
    return {
      createCompletionProvider: createLuaCompletionProvider,
    };
  },
} satisfies LanguageSupportDescriptor;
