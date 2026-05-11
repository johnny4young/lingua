import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRustLanguageStore } from '../../stores/rustLanguageStore';
import { Row } from './shared';

/**
 * RL-026 Slice 3 — conditional Settings row for the Rust LSP.
 *
 * The row mounts ONLY when `rust-analyzer` is not in the happy `available`
 * state. Folds B + E + F collapse into a single surface:
 *   - Happy path (`available` / `unknown` / `starting`): row hides
 *     entirely — the toast already announced readiness.
 *   - `unavailable`: row shows an install hint, with the exact rustup
 *     command, so users do not have to grep Settings for it.
 *   - `degraded`: row shows the crash detail plus a "Restart
 *     rust-analyzer" button wired to the `lsp:rust:restart` IPC.
 */
export function RustLanguageIntelligenceRow() {
  const status = useRustLanguageStore((state) => state.status);
  const { t } = useTranslation();
  const [restarting, setRestarting] = useState(false);

  if (status.kind === 'unknown' || status.kind === 'available') return null;

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await window.lingua.lsp?.rust.restart();
    } finally {
      setRestarting(false);
    }
  };

  if (status.kind === 'degraded') {
    return (
      <Row
        label={t('languageIntelligence.rust.degraded.title')}
        hint={status.detail ?? t('languageIntelligence.rust.degraded.body')}
      >
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            void handleRestart();
          }}
          disabled={restarting}
          data-testid="settings-rust-lsp-restart"
        >
          {t('languageIntelligence.rust.degraded.restartButton')}
        </button>
      </Row>
    );
  }

  // status.kind === 'unavailable'
  const labelKey =
    status.reason === 'web-build'
      ? 'languageIntelligence.rust.unavailable.webBuild.label'
      : status.reason === 'startup-failed'
        ? 'languageIntelligence.rust.unavailable.startupFailed.label'
        : 'languageIntelligence.rust.unavailable.missing.label';
  const hintKey =
    status.reason === 'web-build'
      ? 'languageIntelligence.rust.unavailable.webBuild.hint'
      : status.reason === 'startup-failed'
        ? 'languageIntelligence.rust.unavailable.startupFailed.hint'
        : 'languageIntelligence.rust.unavailable.missing.hint';

  return (
    <Row
      label={t(labelKey)}
      hint={status.detail ? `${t(hintKey)} · ${status.detail}` : t(hintKey)}
    >
      <span
        className="text-xs text-muted"
        data-testid="settings-rust-lsp-status"
      >
        {t('languageIntelligence.rust.unavailable.badge')}
      </span>
    </Row>
  );
}
