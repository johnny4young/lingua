/**
 * Preview provider for the design-system sync.
 *
 * Three jobs, all needed for a preview to look like the product:
 *
 *  1. i18n — ModalShell, ModalFooterLegend and FileDropZone read their copy
 *     through react-i18next. With no provider the cards render raw keys
 *     ("modal.legend.navigate"). The catalog slice is generated from the real
 *     EN file by .design-sync/gen-i18n-subset.mjs.
 *  2. Theme — Lingua ships dark as the product default; the bare :root block is
 *     the light map. The attribute goes on <html>, NOT on a wrapper div: some
 *     utilities resolve through the legacy --app-* bridge with an alpha
 *     modifier (FileDropZone's `bg-background/65`), and those color-mix()
 *     chains only settle correctly when the theme is declared at the document
 *     root the way the app declares it.
 *  3. Surface — paints the card in the product's base background so components
 *     are judged on the surface they actually ship on.
 */
import * as React from 'react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from './i18n-en.json';

const NS = 'common';

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: NS,
    ns: [NS],
    initAsync: false,
    resources: { en: { [NS]: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

function applyProductTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = 'dark';
  root.classList.add('dark');
  root.style.background = 'var(--color-bg-base)';
  if (document.body) {
    document.body.style.background = 'var(--color-bg-base)';
    document.body.style.color = 'var(--color-fg-base)';
  }
}

applyProductTheme();

export function DsProvider({ children }: { children?: React.ReactNode }) {
  React.useLayoutEffect(applyProductTheme, []);
  return (
    <I18nextProvider i18n={i18next}>
      <div
        style={{
          background: 'var(--color-bg-base)',
          color: 'var(--color-fg-base)',
          fontFamily: 'var(--font-ui)',
          padding: 20,
          // Fixed-position overlays (ConfirmDialog is `fixed inset-0` and
          // centers on the window) are captured against this wrapper's box.
          // Without a full-height wrapper the dialog centers outside it and
          // the card crops its title.
          minHeight: '100vh',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </I18nextProvider>
  );
}
