import type { Locale } from '~/lib/i18n';

/**
 * The 29 Developer Utilities shipped in Lingua today, mirrored from the
 * main repo's developerUtilities.ts (verified count: 29).
 *
 * Used by the home page strip and the /docs/utilities page (P1).
 */

export interface Utility {
  id: string;
  name: Record<Locale, string>;
  category: 'data' | 'text' | 'web' | 'crypto' | 'visual' | 'time';
  /** Lucide icon name */
  icon: string;
}

export const UTILITIES: Utility[] = [
  { id: 'json-formatter', name: { en: 'JSON Formatter', es: 'Formateador JSON' }, category: 'data', icon: 'braces' },
  { id: 'yaml-json', name: { en: 'YAML / JSON', es: 'YAML / JSON' }, category: 'data', icon: 'arrow-right-left' },
  { id: 'json-csv', name: { en: 'JSON / CSV', es: 'JSON / CSV' }, category: 'data', icon: 'table' },
  { id: 'sql-formatter', name: { en: 'SQL Formatter', es: 'Formateador SQL' }, category: 'data', icon: 'database' },
  { id: 'beautify-minify', name: { en: 'Beautify / Minify', es: 'Embellecer / Minificar' }, category: 'text', icon: 'wand-sparkles' },
  { id: 'string-case', name: { en: 'String Case', es: 'Case de texto' }, category: 'text', icon: 'case-sensitive' },
  { id: 'string-inspector', name: { en: 'String Inspector', es: 'Inspector de texto' }, category: 'text', icon: 'scan-text' },
  { id: 'regex', name: { en: 'Regex Tester', es: 'Tester Regex' }, category: 'text', icon: 'regex' },
  { id: 'diff', name: { en: 'Diff Viewer', es: 'Visor Diff' }, category: 'text', icon: 'git-compare' },
  { id: 'markdown-preview', name: { en: 'Markdown Preview', es: 'Preview Markdown' }, category: 'text', icon: 'file-text' },
  { id: 'lorem-ipsum', name: { en: 'Lorem Ipsum', es: 'Lorem Ipsum' }, category: 'text', icon: 'pilcrow' },
  { id: 'random-string', name: { en: 'Random String', es: 'Texto aleatorio' }, category: 'text', icon: 'shuffle' },
  { id: 'html-entity', name: { en: 'HTML Entity', es: 'Entidad HTML' }, category: 'web', icon: 'code' },
  { id: 'url-parser', name: { en: 'URL Parser', es: 'Parser URL' }, category: 'web', icon: 'link' },
  { id: 'url-encode', name: { en: 'URL Encode', es: 'URL Encode' }, category: 'web', icon: 'percent' },
  { id: 'curl-to-code', name: { en: 'curl → Code', es: 'curl → Código' }, category: 'web', icon: 'terminal' },
  { id: 'html-to-jsx', name: { en: 'HTML → JSX', es: 'HTML → JSX' }, category: 'web', icon: 'braces' },
  { id: 'backslash-escape', name: { en: 'Backslash Escape', es: 'Escape backslash' }, category: 'web', icon: 'slash' },
  { id: 'base64', name: { en: 'Base64', es: 'Base64' }, category: 'crypto', icon: 'binary' },
  { id: 'base64-image', name: { en: 'Base64 Image', es: 'Imagen Base64' }, category: 'crypto', icon: 'image' },
  { id: 'jwt', name: { en: 'JWT Decoder', es: 'Decodificador JWT' }, category: 'crypto', icon: 'key' },
  { id: 'hash', name: { en: 'Hash', es: 'Hash' }, category: 'crypto', icon: 'fingerprint' },
  { id: 'uuid', name: { en: 'UUID', es: 'UUID' }, category: 'crypto', icon: 'hash' },
  { id: 'number-base', name: { en: 'Number Base', es: 'Base numérica' }, category: 'data', icon: 'calculator' },
  { id: 'color', name: { en: 'Color Converter', es: 'Conversor de color' }, category: 'visual', icon: 'palette' },
  { id: 'svg-to-css', name: { en: 'SVG → CSS', es: 'SVG → CSS' }, category: 'visual', icon: 'image' },
  { id: 'qr', name: { en: 'QR Generator', es: 'Generador QR' }, category: 'visual', icon: 'qr-code' },
  { id: 'cron', name: { en: 'Cron Parser', es: 'Parser Cron' }, category: 'time', icon: 'clock' },
  { id: 'timestamp', name: { en: 'Timestamp', es: 'Timestamp' }, category: 'time', icon: 'calendar-clock' },
];
