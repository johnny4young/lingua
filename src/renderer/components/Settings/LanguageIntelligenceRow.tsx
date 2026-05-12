import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LspLanguageStore } from '../../stores/lspLanguageStoreFactory';
import { Row } from './shared';

/**
 * RL-026 Slice 4 — generic conditional Settings row for a desktop LSP.
 *
 * Slice 3 inlined this for Rust; Slice 4 lifted it into a config-
 * driven component so the Rust + Go (and any future LSP) rows stay
 * byte-identical. Mounts ONLY when the LSP is not in the happy
 * `'available'` state. Folds B + E + F of Slice 3 collapsed into a
 * single surface:
 *   - Happy path (`available` / `unknown`): row hides entirely — the
 *     toast already announced readiness.
 *   - `unavailable`: row shows the install hint, with the exact
 *     install command, so users do not have to grep Settings for it.
 *   - `degraded`: row shows the crash detail plus a Restart button
 *     wired to the language-specific restart IPC.
 *
 * Callers supply the i18n key namespace plus the restart IPC. Every
 * key under `{namespace}.unavailable.*` and `{namespace}.degraded.*`
 * must exist in both locales — the i18n guard catches missing keys.
 */

export interface LanguageIntelligenceRowConfig {
  /** Lingua language id, surfaced in `data-testid` and key prefix. */
  language: string;
  /** Live store for this language. */
  store: LspLanguageStore;
  /** i18n key namespace (e.g. `'languageIntelligence.rust'`). */
  copyNamespace: string;
  /** Restart IPC entry point. */
  restartIpc: () => Promise<unknown> | undefined;
}

export function LanguageIntelligenceRow(config: LanguageIntelligenceRowConfig) {
  const { language, store, copyNamespace, restartIpc } = config;
  const status = store((state) => state.status);
  const { t } = useTranslation();
  const [restarting, setRestarting] = useState(false);

  if (status.kind === 'unknown' || status.kind === 'available') return null;

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartIpc();
    } finally {
      setRestarting(false);
    }
  };

  if (status.kind === 'degraded') {
    return (
      <Row
        label={t(`${copyNamespace}.degraded.title`)}
        hint={status.detail ?? t(`${copyNamespace}.degraded.body`)}
      >
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            void handleRestart();
          }}
          disabled={restarting}
          data-testid={`settings-${language}-lsp-restart`}
        >
          {t(`${copyNamespace}.degraded.restartButton`)}
        </button>
      </Row>
    );
  }

  // status.kind === 'unavailable'
  const labelKey =
    status.reason === 'web-build'
      ? `${copyNamespace}.unavailable.webBuild.label`
      : status.reason === 'startup-failed'
        ? `${copyNamespace}.unavailable.startupFailed.label`
        : `${copyNamespace}.unavailable.missing.label`;
  const hintKey =
    status.reason === 'web-build'
      ? `${copyNamespace}.unavailable.webBuild.hint`
      : status.reason === 'startup-failed'
        ? `${copyNamespace}.unavailable.startupFailed.hint`
        : `${copyNamespace}.unavailable.missing.hint`;

  return (
    <Row
      label={t(labelKey)}
      hint={status.detail ? `${t(hintKey)} · ${status.detail}` : t(hintKey)}
    >
      <span
        className="text-xs text-muted"
        data-testid={`settings-${language}-lsp-status`}
      >
        {t(`${copyNamespace}.unavailable.badge`)}
      </span>
    </Row>
  );
}
