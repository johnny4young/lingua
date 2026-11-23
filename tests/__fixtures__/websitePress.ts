import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read as text: importing website/src modules makes Vite load the Astro tsconfig,
// which only resolves when website/node_modules is installed.
function pressBody(file: string, open: string, close: string): string {
  const text = readFileSync(resolve(__dirname, '../..', file), 'utf8');
  const press = text.indexOf('\n  press: {');
  const start = press < 0 ? -1 : text.indexOf(open, press);
  if (start < 0) throw new Error(`No press ${open} in ${file}`);
  return text.slice(start + open.length, text.indexOf(close, start));
}

/** File names in SITE.press.assets (website/src/lib/site.ts). */
export function sitePressAssets(): string[] {
  const body = pressBody('website/src/lib/site.ts', 'assets: [', ']');
  return [...body.matchAll(/'([^']+)'/gu)].map(m => m[1]!);
}

/** File name to label map in press.assets.files of a website locale. */
export function localePressFiles(locale: 'en' | 'es'): Record<string, string> {
  const body = pressBody(`website/src/i18n/${locale}.ts`, 'files: {', '}');
  return Object.fromEntries([...body.matchAll(/'([^']+)': '([^']*)'/gu)].map(m => [m[1]!, m[2]!]));
}
