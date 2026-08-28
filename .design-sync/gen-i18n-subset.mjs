/**
 * Regenerates .design-sync/pkgroot/i18n-en.json — the slice of the real EN
 * catalog that the components/ui kit reads through useTranslation.
 *
 * Derived, never hand-copied: run this before package-build.mjs so the preview
 * provider always renders the strings the product ships. The full catalog is
 * 324 KB and would triple the DS bundle, hence the prefix filter.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PREFIXES = ['modal.', 'ui.'];
const src = JSON.parse(
  readFileSync(new URL('../src/renderer/i18n/locales/en/common.json', import.meta.url), 'utf8'),
);
const subset = Object.fromEntries(
  Object.entries(src).filter(([k]) => PREFIXES.some((p) => k.startsWith(p))),
);
writeFileSync(
  new URL('./pkgroot/i18n-en.json', import.meta.url),
  JSON.stringify(subset, null, 2) + '\n',
);
console.error(`i18n subset: ${Object.keys(subset).length} key(s)`);
