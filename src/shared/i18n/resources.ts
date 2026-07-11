/**
 * Shared locale catalog used by BOTH processes: the renderer's i18next
 * bootstrap and the main-process `runtime.ts` instance behind the
 * fileSystem / profile / recovery IPC handlers.
 *
 * Layering note: these are the only `src/shared` imports that reach
 * into `src/renderer`, and they are deliberate — the imports are pure
 * JSON *data* (the locale catalogs), not renderer code. The catalogs
 * stay under `src/renderer/i18n/locales` because the i18n tooling
 * (`check-i18n.mjs`, `check-renderer-copy.mjs`, translator workflow)
 * anchors on that path. Do not import renderer *code* from shared.
 */
// eslint-disable-next-line no-restricted-imports -- deliberate: JSON locale DATA, not renderer code (see layering note above)
import en from '../../renderer/i18n/locales/en/common.json';
// eslint-disable-next-line no-restricted-imports -- deliberate: JSON locale DATA, not renderer code (see layering note above)
import es from '../../renderer/i18n/locales/es/common.json';
import { COMMON_NAMESPACE } from './languages';

export {
  COMMON_NAMESPACE,
  SUPPORTED_LANGUAGES,
  coerceSupportedLanguage,
  isSupportedLanguage,
  resolveSystemLanguage,
} from './languages';
export type { SupportedLanguage } from './languages';

export const COMMON_RESOURCES = {
  en: { [COMMON_NAMESPACE]: en },
  es: { [COMMON_NAMESPACE]: es },
} as const;
