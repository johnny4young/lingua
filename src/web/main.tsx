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
  applyRecoveryStateAttr,
  buildCrashFingerprint,
  markCrashOnNextBoot,
  recordCrash,
  resolveRecoveryState,
  scheduleRecoveryMarksClear,
} from '../renderer/utils/safeBoot';
import '../renderer/index.css';

// RL-090 — mirror the boot recovery state on `<html data-recovery-state>`
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

// Register the Service Worker for offline / PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`;

    navigator.serviceWorker.register(serviceWorkerUrl).catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// Resolve language and initialise i18n synchronously (web path)
const { language } = useSettingsStore.getState();
const resolved =
  language === 'system'
    ? resolveSystemLanguage(getBrowserSystemLanguages())
    : language;
initI18n(resolved);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
scheduleRecoveryMarksClear();
