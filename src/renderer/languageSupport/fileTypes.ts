import {
  csvConfiguration,
  csvLanguage,
  dotenvConfiguration,
  dotenvLanguage,
  makefileConfiguration,
  makefileLanguage,
  tomlConfiguration,
  tomlLanguage,
} from '../monacoCustomLanguages';
import type { LanguageSupportDescriptor } from './types';

export const fileTypeLanguageSupports = [
  {
    id: 'yaml',
    monaco: {
      id: 'yaml',
      extensions: ['.yaml', '.yml'],
      aliases: ['YAML', 'yaml'],
      loader: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.js'),
    },
  },
  {
    id: 'dockerfile',
    monaco: {
      id: 'dockerfile',
      extensions: ['.dockerfile'],
      aliases: ['Dockerfile', 'dockerfile'],
      loader: () =>
        import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js'),
    },
  },
  {
    id: 'shell',
    monaco: {
      id: 'shell',
      extensions: ['.sh', '.bash'],
      aliases: ['Shell', 'shell'],
      loader: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.js'),
    },
  },
  {
    id: 'makefile',
    monaco: {
      id: 'makefile',
      extensions: ['.mk', '.mak'],
      aliases: ['Makefile', 'makefile'],
      config: makefileConfiguration,
      language: makefileLanguage,
    },
  },
  {
    id: 'ini',
    monaco: {
      id: 'ini',
      extensions: ['.ini', '.cfg', '.conf'],
      aliases: ['INI', 'ini'],
      loader: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.js'),
    },
  },
  {
    id: 'dotenv',
    monaco: {
      id: 'dotenv',
      extensions: ['.env'],
      aliases: ['dotenv', '.env'],
      config: dotenvConfiguration,
      language: dotenvLanguage,
    },
  },
  {
    id: 'toml',
    monaco: {
      id: 'toml',
      extensions: ['.toml'],
      aliases: ['TOML', 'toml'],
      config: tomlConfiguration,
      language: tomlLanguage,
    },
  },
  {
    id: 'csv',
    monaco: {
      id: 'csv',
      extensions: ['.csv'],
      aliases: ['CSV', 'csv'],
      config: csvConfiguration,
      language: csvLanguage,
    },
  },
] satisfies readonly LanguageSupportDescriptor[];
