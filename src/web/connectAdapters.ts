/**
 * Connects the browser adapters to the app.
 *
 * `src/web/main.tsx` imports this module first, so `window.lingua` is both
 * installed and connected before React, App and the stores evaluate. Doing it
 * here rather than in the entry's body closes the window in which a module
 * evaluated at import time would see the adapters' inert defaults.
 *
 * This is the composition root of `src/web`: with `main.tsx` it is the only
 * place allowed to import renderer code, which lint enforces everywhere else.
 */

import { getBrowserSystemLanguages, translateAppCommon } from '../renderer/i18n';
import { useUIStore } from '../renderer/stores/uiStore';
import { trackEvent } from '../renderer/utils/telemetry';
import { configureWebAdapter } from './adapter';
import { configureWebFsAdapter } from './fs-adapter';

configureWebAdapter({
  // The stubs translate when called, so the language active at that moment wins.
  translate: (key) => translateAppCommon(key),
  getSystemLanguages: () => getBrowserSystemLanguages(),
});

configureWebFsAdapter({
  pushStatusNotice: (notice) => useUIStore.getState().pushStatusNotice(notice),
  trackEvent,
});
