/**
 * RL-094 Slice 2 — Capsule import overlay.
 *
 * 3-section modal:
 *   - Top: Load source (Paste textarea + Open file button + Drop zone).
 *   - Middle: <CapsuleImportPreview> when a valid capsule decoded;
 *     otherwise an inline reject banner with the closed-enum reason.
 *   - Bottom: Action bar — Cancel + "Open as new tab" (disabled until
 *     valid capsule). Fold E adds "Copy source to clipboard"; Fold G
 *     adds "Open in HTTP workspace" when the capsule's
 *     `tab.language === 'http'`.
 *
 * Source surfaces (fold B + C):
 *   - Paste textarea — manual JSON paste; primary surface.
 *   - File picker — hidden `<input type="file">` triggered by the
 *     button so web + desktop both go through `File.text()` (no IPC).
 *   - Drag-drop — full-overlay drop zone with visual feedback ring.
 *   - Clipboard auto-detect (fold C) — only fires when consent is
 *     `'granted'`; the row also exposes "Detect clipboard now" so
 *     users with consent can re-trigger after copying.
 *
 * Telemetry (fold D) is owned by `useCapsuleImport`; this component
 * passes through. The overlay itself fires NO telemetry directly.
 *
 * Escape closes the overlay; click-outside closes too. Body scroll
 * is restored on unmount via the same `useEffect` cleanup pattern
 * `<ProjectTemplatesOverlay>` uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileUp, X } from 'lucide-react';
import { useCapsuleImport } from '../../hooks/useCapsuleImport';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import {
  createBlankHttpRequest,
  parseHttpRequest,
} from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';
import { CapsuleImportPreview } from './CapsuleImportPreview';

export interface CapsuleImportOverlayProps {
  onClose: () => void;
}

export function CapsuleImportOverlay({ onClose }: CapsuleImportOverlayProps) {
  const { t } = useTranslation();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const {
    state,
    decodeFromText,
    decodeFromFile,
    openInNewTab,
    reset,
    attemptClipboardAutofill,
  } = useCapsuleImport();

  // ─── Escape + body scroll lock ──────────────────────────────────
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // ─── Clipboard auto-detect (Fold C) ─────────────────────────────
  const clipboardConsent = useSettingsStore(
    (s) => s.capsuleImportClipboardOnFocusConsent
  );
  const setClipboardConsent = useSettingsStore(
    (s) => s.setCapsuleImportClipboardOnFocusConsent
  );
  const [pasteValue, setPasteValue] = useState('');
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (clipboardConsent !== 'granted') return;
    autoDetectedRef.current = true;
    // Reviewer fix (RL-094 Slice 2 final pass) — `cancelled` flag
    // guards against a state update on an unmounted overlay when the
    // user closes the overlay during the async clipboard read. React 19
    // silenced the warning but the work is still wasted, and the
    // setPasteValue would still fire on an unmounted tree.
    let cancelled = false;
    void attemptClipboardAutofill().then((result) => {
      if (cancelled) return;
      if (result?.ok) {
        // When the clipboard happens to carry a valid capsule, surface
        // its raw JSON in the paste textarea too so the user can edit
        // before opening as a new tab.
        setPasteValue(JSON.stringify(result.capsule, null, 2));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attemptClipboardAutofill, clipboardConsent]);

  // ─── File picker ────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFilePicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input value so picking the same file again still
      // fires the change event.
      event.target.value = '';
      if (!file) return;
      void decodeFromFile(file, 'file-picker');
    },
    [decodeFromFile]
  );

  // ─── Drag-drop (Fold B) ─────────────────────────────────────────
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Only accept file drags; pass-through everything else so text
      // selections inside the textarea keep working.
      const hasFiles = Array.from(event.dataTransfer.types).includes('Files');
      if (!hasFiles) return;
      event.preventDefault();
      setIsDragOver(true);
    },
    []
  );
  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        setIsDragOver(false);
      }
    },
    []
  );
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      event.preventDefault();
      setIsDragOver(false);
      void decodeFromFile(file, 'drag-drop');
    },
    [decodeFromFile]
  );

  // ─── Paste ──────────────────────────────────────────────────────
  const handlePasteChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setPasteValue(next);
      // Decode-on-change so the preview/reject banner stays in sync
      // without a separate Submit button. Empty input resets to
      // 'empty' which the rejection branch swallows so the banner
      // doesn't flash on every keystroke.
      if (next.trim().length === 0) {
        reset();
        return;
      }
      decodeFromText(next, 'paste');
    },
    [decodeFromText, reset]
  );

  // ─── Action bar ─────────────────────────────────────────────────
  const decoded = state.kind === 'decoded' ? state : null;
  const rejected = state.kind === 'rejected' ? state : null;
  const isHttpCapsule =
    decoded?.capsule.tab.language === 'http' ? decoded : null;
  const sourceJson = useMemo(() => {
    if (!decoded) return '';
    return decoded.capsule.source.content ?? '';
  }, [decoded]);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleConfirmOpenTab = useCallback(() => {
    if (!decoded) return;
    openInNewTab();
    pushStatusNotice({
      tone: 'success',
      messageKey: 'capsuleImport.notice.openedTab',
    });
    closeRef.current();
  }, [decoded, openInNewTab, pushStatusNotice]);

  // Fold E — copy source to clipboard secondary action.
  const handleCopySource = useCallback(async () => {
    if (!decoded) return;
    try {
      await navigator.clipboard?.writeText(sourceJson);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'capsuleImport.notice.sourceCopied',
      });
    } catch {
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'capsuleImport.notice.copyFailed',
      });
    }
  }, [decoded, pushStatusNotice, sourceJson]);

  // Fold G — when the capsule originated from RL-097's HTTP workspace,
  // offer to recreate the request in the workspace store instead of
  // dropping the source as a JSON tab.
  const handleOpenInHttpWorkspace = useCallback(() => {
    if (!isHttpCapsule) return;
    const parsed = parseHttpRequest(safeJsonParse(sourceJson));
    if (!parsed) {
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'capsuleImport.notice.httpInvalid',
      });
      return;
    }
    // Mint a fresh id + timestamps so the imported request never
    // collides with an existing record. `createBlankHttpRequest`
    // would zero out the fields we want to carry forward, so we
    // build the record manually keeping body/headers/method/url
    // from the parsed capsule.
    const blank = createBlankHttpRequest({
      id: crypto.randomUUID(),
      name: parsed.name,
    });
    useWorkspaceToolStore.getState().createRequest({
      ...blank,
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      body: parsed.body,
      timeoutMs: parsed.timeoutMs,
    });
    useUIStore.getState().openBottomPanel('http');
    pushStatusNotice({
      tone: 'success',
      messageKey: 'capsuleImport.notice.openedInHttp',
    });
    closeRef.current();
  }, [isHttpCapsule, pushStatusNotice, sourceJson]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('capsuleImport.overlay.title')}
      data-testid="capsule-import-overlay"
      className={cn(
        'fixed inset-0 z-40 flex items-start justify-center bg-bg-base/80 p-6 backdrop-blur-sm',
        isDragOver && 'ring-2 ring-emerald-500/80 ring-offset-2 ring-offset-bg-base'
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mt-12 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">
              {t('capsuleImport.overlay.title')}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {t('capsuleImport.overlay.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('capsuleImport.overlay.close')}
            data-testid="capsule-import-overlay-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-strong/60 hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] gap-3 p-4">
          {/* TOP — load source */}
          <section
            data-testid="capsule-import-overlay-load"
            className="grid gap-3 md:grid-cols-2"
          >
            <div className="flex flex-col gap-1">
              <label
                htmlFor="capsule-import-paste"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted"
              >
                {t('capsuleImport.load.paste')}
              </label>
              <textarea
                id="capsule-import-paste"
                data-testid="capsule-import-paste-textarea"
                value={pasteValue}
                onChange={handlePasteChange}
                placeholder={t('capsuleImport.load.pastePlaceholder')}
                rows={4}
                spellCheck={false}
                className="min-h-[80px] resize-none rounded-md border border-border/60 bg-bg-elevated p-2 font-mono text-xs text-foreground outline-none focus:border-border-strong"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t('capsuleImport.load.dropZone')}
              </span>
              <button
                type="button"
                onClick={handlePickFile}
                data-testid="capsule-import-open-file"
                className={cn(
                  'flex h-[80px] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border/60 bg-surface/30 px-3 text-center text-xs text-muted transition-colors',
                  'hover:border-border-strong hover:text-foreground',
                  isDragOver && 'border-emerald-500/80 bg-emerald-500/10 text-foreground'
                )}
              >
                <FileUp size={14} aria-hidden="true" />
                <span>{t('capsuleImport.load.file')}</span>
                <span className="text-[10px]">
                  {t('capsuleImport.load.dropZoneHint')}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                data-testid="capsule-import-file-input"
                className="hidden"
                onChange={handleFilePicked}
              />
            </div>
            {clipboardConsent === 'unset' ? (
              <div
                data-testid="capsule-import-clipboard-consent"
                className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/30 px-3 py-2 text-[11px] text-muted"
              >
                <span>{t('capsuleImport.load.clipboardConsentPrompt')}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setClipboardConsent('declined')}
                    data-testid="capsule-import-clipboard-decline"
                    className="rounded border border-border/60 px-2 py-1 text-foreground hover:bg-surface-strong/60"
                  >
                    {t('capsuleImport.load.clipboardConsentDecline')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClipboardConsent('granted')}
                    data-testid="capsule-import-clipboard-grant"
                    className="rounded border border-emerald-500/60 bg-emerald-500/10 px-2 py-1 text-emerald-200 hover:bg-emerald-500/20"
                  >
                    {t('capsuleImport.load.clipboardConsentGrant')}
                  </button>
                </span>
              </div>
            ) : null}
          </section>

          {/* MIDDLE — preview / reject / empty */}
          <section
            data-testid="capsule-import-overlay-body"
            className="min-h-0"
          >
            {decoded ? (
              <CapsuleImportPreview
                capsule={decoded.capsule}
                byteLength={decoded.byteLength}
              />
            ) : rejected ? (
              <RejectBanner
                reason={rejected.reason}
                detail={rejected.detail}
                byteLength={rejected.byteLength}
              />
            ) : (
              <EmptyState />
            )}
          </section>

          {/* BOTTOM — action bar */}
          <section
            data-testid="capsule-import-overlay-actions"
            className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3"
          >
            <button
              type="button"
              onClick={onClose}
              data-testid="capsule-import-overlay-cancel"
              className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground hover:bg-surface-strong/60"
            >
              {t('capsuleImport.action.cancel')}
            </button>
            {decoded ? (
              <button
                type="button"
                onClick={handleCopySource}
                data-testid="capsule-import-overlay-copy-source"
                className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground hover:bg-surface-strong/60"
              >
                {t('capsuleImport.action.copySource')}
              </button>
            ) : null}
            {isHttpCapsule ? (
              <button
                type="button"
                onClick={handleOpenInHttpWorkspace}
                data-testid="capsule-import-overlay-open-http"
                className="rounded-md border border-sky-500/60 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/20"
              >
                {t('capsuleImport.action.openInHttp')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleConfirmOpenTab}
              disabled={!decoded}
              data-testid="capsule-import-overlay-confirm"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('capsuleImport.action.openAsNewTab')}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="capsule-import-empty"
      className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/40 bg-surface/20 p-6 text-center text-xs text-muted"
    >
      <p className="text-foreground">{t('capsuleImport.empty.title')}</p>
      <p>{t('capsuleImport.empty.hint')}</p>
    </div>
  );
}

function RejectBanner({
  reason,
  detail,
  byteLength,
}: {
  reason: 'empty' | 'malformed-json' | 'wrong-version' | 'oversized' | 'invalid-shape';
  detail?: string;
  byteLength: number;
}) {
  const { t } = useTranslation();
  const messageKey = REJECT_MESSAGE_KEYS[reason];
  return (
    <div
      role="alert"
      data-testid="capsule-import-reject"
      data-reason={reason}
      className="flex h-full flex-col gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100"
    >
      <header className="flex items-center gap-2 text-rose-200">
        <AlertCircle size={14} aria-hidden="true" />
        <h3 className="font-semibold">
          {t('capsuleImport.reject.title')}
        </h3>
      </header>
      <p>{t(messageKey)}</p>
      <p className="font-mono text-[10px] text-rose-100/70">
        {byteLength.toLocaleString()} B
        {detail ? ` · ${detail}` : ''}
      </p>
    </div>
  );
}

const REJECT_MESSAGE_KEYS: Record<
  'empty' | 'malformed-json' | 'wrong-version' | 'oversized' | 'invalid-shape',
  string
> = {
  empty: 'capsuleImport.reject.empty',
  'malformed-json': 'capsuleImport.reject.malformedJson',
  'wrong-version': 'capsuleImport.reject.wrongVersion',
  oversized: 'capsuleImport.reject.oversized',
  'invalid-shape': 'capsuleImport.reject.invalidShape',
};

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
