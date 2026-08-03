/**
 * Renderer language identifiers.
 *
 * Keep this leaf dependency-free: editor, runner, navigation, and Settings
 * surfaces share these identifiers without activating a global type barrel.
 */

export type AppLanguage = 'system' | 'en' | 'es';

export type BuiltInLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'rust'
  | 'ruby'
  | 'c'
  | 'cpp'
  | 'swift'
  | 'kotlin'
  | 'java'
  | 'scala'
  | 'json'
  | 'yaml'
  | 'dotenv'
  | 'toml'
  | 'ini'
  | 'csv'
  | 'dockerfile'
  | 'makefile'
  | 'gitignore'
  | 'editorconfig'
  | 'shellscript';

/**
 * Language ids used across the editor.
 * Plugins may introduce additional string identifiers beyond the built-ins.
 */
export type Language = BuiltInLanguage | (string & {});
