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
      basicLanguage: 'yaml',
    },
  },
  {
    id: 'dockerfile',
    monaco: {
      id: 'dockerfile',
      extensions: ['.dockerfile'],
      aliases: ['Dockerfile', 'dockerfile'],
      basicLanguage: 'dockerfile',
    },
  },
  {
    id: 'shell',
    monaco: {
      id: 'shell',
      extensions: ['.sh', '.bash'],
      aliases: ['Shell', 'shell'],
      basicLanguage: 'shell',
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
      basicLanguage: 'ini',
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
