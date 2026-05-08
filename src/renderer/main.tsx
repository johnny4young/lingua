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

  initI18n(resolved);

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  scheduleRecoveryMarksClear();
}

void bootstrap();
