/**
 * RL-079 — Trust-boundary acknowledgement modal.
 *
 * Mounted once at App level. The modal subscribes to
 * `useNativeExecutionGateStore` — when a Run dispatch on Go or Rust
 * finds `settingsStore.nativeExecutionAcknowledged === false`, it
 * stages a pending resume callback in the gate store; this component
 * renders, the user clicks Acknowledge, the persisted flag flips,
 * and the resume callback retries the run.
 *
 * Lingua does not sandbox local-toolchain execution. This surface is
 * the user-visible boundary between "code I run in the worker
 * sandbox" and "code I hand to my system rustc / go to execute as a
 * regular OS process".
 */
import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { useNativeExecutionGateStore } from '../../stores/nativeExecutionGateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';

export function NativeExecutionWarning() {
  const { t } = useTranslation();
  const pendingLanguage = useNativeExecutionGateStore(
    (state) => state.pendingLanguage
  );
  const confirm = useNativeExecutionGateStore((state) => state.confirm);
  const cancel = useNativeExecutionGateStore((state) => state.cancel);
  const setAcknowledged = useSettingsStore(
    (state) => state.setNativeExecutionAcknowledged
  );
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the primary action so screen readers and keyboard users can
  // confirm without hunting for the button. Only fires when the modal
  // mounts (i.e. when pendingLanguage transitions from null to set).
  useEffect(() => {
    if (pendingLanguage) confirmButtonRef.current?.focus();
  }, [pendingLanguage]);

  // Escape cancels — matches the OverlayBackdrop click-out behaviour.
  useEffect(() => {
    if (!pendingLanguage) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pendingLanguage, cancel]);

  if (!pendingLanguage) return null;

  const handleConfirm = () => {
    // Flip the persisted flag BEFORE invoking the resume callback so
    // the retried `run()` sees `true` and falls through the gate.
    setAcknowledged(true);
    confirm();
  };

  return (
    <OverlayBackdrop align="center" onClose={cancel}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-execution-warning-title"
        aria-describedby="native-execution-warning-body"
        className="w-[min(92vw,520px)] max-w-none"
        data-testid="native-execution-warning"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="native-execution-warning-title"
            className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {t('nativeExecution.modal.title')}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-5 text-sm leading-6 text-muted">
          <p id="native-execution-warning-body">
            {t('nativeExecution.modal.body')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 px-5 py-4">
          <button
            type="button"
            className="button-secondary"
            onClick={cancel}
            data-testid="native-execution-warning-cancel"
          >
            {t('nativeExecution.modal.cancel')}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className="button-primary"
            onClick={handleConfirm}
            data-testid="native-execution-warning-confirm"
          >
            {t('nativeExecution.modal.confirm')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
