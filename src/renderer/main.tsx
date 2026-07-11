import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n, resolveSystemLanguage } from './i18n';
import { useSettingsStore } from './stores/settingsStore';
import {
  applyRecoveryStateAttr,
  buildCrashFingerprint,
  markCrashOnNextBoot,
  recordCrash,
  resolveRecoveryState,
  scheduleRecoveryMarksClear,
} from './utils/safeBoot';
import './index.css';
import { markBootPhase } from './utils/bootTimings';

// RL-090 — global handlers for async + event-handler errors.
// React error boundaries only catch render-time throws inside the
// component tree; without these listeners, a `setTimeout` reject or
// an unhandled promise rejection would loop the user into a broken
// state with no recovery path. Marking next boot for safe mode +
// recording the crash means the next reload always recovers.
//
// The crash fingerprint dedupes against `componentDidCatch` — under
// React StrictMode a single render-time throw can fire BOTH paths,
// which would otherwise double-count toward the boot-loop threshold.
function installGlobalErrorListeners(): void {
  if (typeof window === 'undefined') return;
  const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
    const error =
      event instanceof ErrorEvent
        ? event.error ?? new Error(event.message)
        : (event as PromiseRejectionEvent).reason;
    try {
      markCrashOnNextBoot();
      recordCrash(Date.now(), buildCrashFingerprint(error));
    } catch {
      // ignore — quota / SecurityError on private mode is non-fatal.
    }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
}

async function bootstrap() {
  const recoveryState = resolveRecoveryState();
  applyRecoveryStateAttr(recoveryState);

  installGlobalErrorListeners();

  const { language } = useSettingsStore.getState();

  let resolved = language as string;
  if (language === 'system') {
    try {
      const systemLangs = await window.lingua.getSystemLanguages();
      resolved = resolveSystemLanguage(systemLangs);
    } catch {
      resolved = 'en';
    }
  }
  markBootPhase('system-language');

  await initI18n(resolved);
  markBootPhase('i18n');

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  // FASE 0 dev-only acceptance artifact. When the URL carries
  // `?lingua-showcase`, mount the recipe gallery instead of the app.
  // The dynamic import code-splits the showcase into its own lazy
  // chunk, so it stays out of the INITIAL bundle and only loads when
  // the param is present. (The chunk still ships in the build — Rollup
  // cannot prove the runtime param is never set — which is intentional:
  // it is validated against the prod `preview:web` build at
  // `http://localhost:4173/?lingua-showcase`.)
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('lingua-showcase')
  ) {
    const { RecipeShowcase } = await import('./devShowcase/RecipeShowcase');
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
      <App />
    </StrictMode>
  );
  markBootPhase('react-mount');
  scheduleRecoveryMarksClear();
}

void bootstrap();
