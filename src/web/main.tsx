/**
 * Web entry point — imports the browser adapter BEFORE React renders
 * so that window.lingua is available when App and its stores initialise.
 */

import './adapter';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../renderer/App';
import { getBrowserSystemLanguages, initI18n, resolveSystemLanguage } from '../renderer/i18n';
import { useSettingsStore } from '../renderer/stores/settingsStore';
import {
  manageServiceWorker,
  shouldRegisterServiceWorkerForMode,
} from './serviceWorker';
import { installE2eHooks } from '../renderer/testing/e2eHooks';
import { RichConsoleE2eFixture } from '../renderer/testing/RichConsoleE2eFixture';
import {
  applyRecoveryStateAttr,
  buildCrashFingerprint,
  markCrashOnNextBoot,
  recordCrash,
  resolveRecoveryState,
  scheduleRecoveryMarksClear,
} from '../renderer/utils/safeBoot';
import '../renderer/index.css';
import { markBootPhase } from '../renderer/utils/bootTimings';

// internal — mirror the boot recovery state on `<html data-recovery-state>`
// and install global error listeners so async + event-handler errors
// (which React boundaries do not catch) feed the same crash counter
// + safe-mode mark. Runs synchronously before createRoot.
//
// Fingerprint dedupes against the boundary's componentDidCatch path —
// under React StrictMode a single render-time throw can fire both
// paths, which would otherwise double-count toward the boot-loop
// threshold.
applyRecoveryStateAttr(resolveRecoveryState());
const onUncaughtError = (event: ErrorEvent | PromiseRejectionEvent) => {
  const error =
    event instanceof ErrorEvent
      ? event.error ?? new Error(event.message)
      : (event as PromiseRejectionEvent).reason;
  try {
    markCrashOnNextBoot();
    recordCrash(Date.now(), buildCrashFingerprint(error));
  } catch {
    // ignore — quota / SecurityError in private mode is non-fatal.
  }
};
window.addEventListener('error', onUncaughtError);
window.addEventListener('unhandledrejection', onUncaughtError);

// Service Worker — built web bundles only. In dev (`dev:web` /
// `dev:web:pro` on the shared :5174 scope) a cache-first SW pins the
// first session's modules and shadows the dev server's fresh ones,
// stranding a freshly minted dev license token on a stale public key.
// Key off Vite MODE, not import.meta.env.PROD: build commands can inherit
// NODE_ENV=development from the shell, which makes PROD false even though
// Vite is producing a production-mode bundle.
// `manageServiceWorker` registers in built bundles and tears any SW down
// in dev; `public/sw.js` self-destructs on the dev origins to heal older
// tabs.
const serviceWorkerDeps = {
  baseUrl: import.meta.env.BASE_URL,
  container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  cacheStorage: typeof caches !== 'undefined' ? caches : undefined,
  warn: (message: string, error: unknown) => console.warn(message, error),
};
if (shouldRegisterServiceWorkerForMode(import.meta.env.MODE)) {
  window.addEventListener('load', () => {
    void manageServiceWorker({ ...serviceWorkerDeps, isProduction: true });
  });
} else {
  void manageServiceWorker({ ...serviceWorkerDeps, isProduction: false });
}

async function bootstrapWeb(): Promise<void> {
  const { language } = useSettingsStore.getState();
  const resolved =
    language === 'system'
      ? resolveSystemLanguage(getBrowserSystemLanguages())
      : language;
  markBootPhase('system-language');
  await initI18n(resolved);
  markBootPhase('i18n');
  installE2eHooks();

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  const isRichConsoleE2eFixture =
    __LINGUA_E2E_HOOKS__ &&
    new URLSearchParams(window.location.search).get('e2e') ===
      'rich-console-gallery';

// FASE 0 dev-only acceptance artifact. `?lingua-showcase` mounts the
// recipe gallery instead of the app. The dynamic import code-splits the
// showcase into its own lazy chunk, so it stays out of the INITIAL
// bundle and only loads when the param is present. (The chunk still
// ships in the build — Rollup cannot prove the runtime param is never
// set — which is intentional: validation runs against the prod
// `preview:web` build.) This mirrors the renderer-entry guard in
// `src/renderer/main.tsx`; the web entry needs its own copy because the
// two entry points render independently. The showcase URL used for
// validation is `http://localhost:4173/?lingua-showcase`.
  if (new URLSearchParams(window.location.search).has('lingua-showcase')) {
    const { RecipeShowcase } = await import(
      '../renderer/devShowcase/RecipeShowcase'
    );
    createRoot(root).render(
      <StrictMode>
        <RecipeShowcase />
      </StrictMode>
    );
    scheduleRecoveryMarksClear();
    return;
  }

  createRoot(root).render(
    <StrictMode>
      {isRichConsoleE2eFixture ? <RichConsoleE2eFixture /> : <App />}
    </StrictMode>
  );
  markBootPhase('react-mount');
  scheduleRecoveryMarksClear();
}

void bootstrapWeb();
