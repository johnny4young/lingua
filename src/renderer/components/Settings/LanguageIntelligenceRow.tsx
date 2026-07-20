import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LspLanguageStore } from '../../stores/lspLanguageStoreFactory';
import { SpecRow } from '../ui/SpecRow';
import { StatusBadge } from '../ui/StatusBadge';

/**
 * implementation — generic conditional Settings row for a desktop LSP.
 *
 * implementation inlined this for Rust; implementation lifted it into a config-
 * driven component so the Rust + Go (and any future LSP) rows stay
 * byte-identical. Mounts ONLY when the LSP is not in the happy
 * `'available'` state. implementation note of implementation collapsed into a
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
  /**
   * FASE 2a — drops the SpecRow bottom hairline when this is the last
   * visible row in the shared per-language `SpecCard`. Defaults to
   * `false`; the parent decides ordering (Rust/Go are never last
   * because the always-rendered Ruby row follows them).
   */
  last?: boolean;
}

export function LanguageIntelligenceRow(config: LanguageIntelligenceRowConfig) {
  const { language, store, copyNamespace, restartIpc, last = false } = config;
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
      <SpecRow
        last={last}
        label={t(`${copyNamespace}.degraded.title`)}
        description={status.detail ?? t(`${copyNamespace}.degraded.body`)}
        control={
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
        }
      />
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
    <SpecRow
      last={last}
      label={t(labelKey)}
      description={status.detail ? `${t(hintKey)} · ${status.detail}` : t(hintKey)}
      control={
        <span data-testid={`settings-${language}-lsp-status`}>
          <StatusBadge tone="warning">
            {t(`${copyNamespace}.unavailable.badge`)}
          </StatusBadge>
        </span>
      }
    />
  );
}
