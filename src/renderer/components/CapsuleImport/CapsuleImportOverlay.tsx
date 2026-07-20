/**
 * implementation — Capsule import overlay.
 *
 * 3-section modal:
 *   - Top: Load source (Paste textarea + Open file button + Drop zone).
 *   - Middle: <CapsuleImportPreview> when a valid capsule decoded;
 *     otherwise an inline reject banner with the closed-enum reason.
 *   - Bottom: Action bar — Cancel + "Open as new tab" (disabled until
 *     valid capsule). implementation note adds "Copy source to clipboard"; implementation note
 *     adds "Open in HTTP workspace" when the capsule's
 *     `tab.language === 'http'`.
 *
 * Source surfaces (implementation note):
 *   - Paste textarea — manual JSON paste; primary surface.
 *   - File picker — hidden `<input type="file">` triggered by the
 *     button so web + desktop both go through `File.text()` (no IPC).
 *   - Drag-drop — full-overlay drop zone with visual feedback ring.
 *   - Clipboard auto-detect (implementation note) — only fires when consent is
 *     `'granted'`; the row also exposes "Detect clipboard now" so
 *     users with consent can re-trigger after copying.
 *
 * Telemetry (implementation note) is owned by `useCapsuleImport`; this component
 * passes through. The overlay itself fires NO telemetry directly.
 *
 * Escape closes the overlay; click-outside closes too. Body scroll
 * is restored on unmount via the same `useEffect` cleanup pattern
 * `<ProjectTemplatesOverlay>` uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileUp } from 'lucide-react';
import { useCapsuleImport } from '../../hooks/useCapsuleImport';
import { takePendingCapsuleImportSource } from '../../clipboard/pendingCapsuleImport';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { openHttpWorkspaceTab } from '../../runtime/openWorkspaceTab';
import {
  createBlankHttpRequest,
  parseHttpRequest,
} from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';
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

  // Escape (and scrim-click and the header `x`) are owned by
  // `<ModalShell>` now — they route through the `onClose` we pass it.
  // No document-level listener here, otherwise the close would fire
  // twice when the shell already handles the key.

  // ─── Clipboard auto-detect (implementation note) ─────────────────────────────
  const clipboardConsent = useSettingsStore(
    (s) => s.capsuleImportClipboardOnFocusConsent
  );
  const setClipboardConsent = useSettingsStore(
    (s) => s.setCapsuleImportClipboardOnFocusConsent
  );
  const [pasteValue, setPasteValue] = useState('');
  const autoDetectedRef = useRef(false);
  // implementation — when the overlay was opened by a smart-paste capsule
  // import, decode the stashed JSON on mount so the preview opens pre-filled.
  // Takes precedence over the clipboard auto-detect below (seed wins) and is
  // one-shot (the holder clears itself).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const seed = takePendingCapsuleImportSource();
    if (!seed) return;
    autoDetectedRef.current = true; // don't let clipboard auto-detect clobber it
    const timer = window.setTimeout(() => {
      setPasteValue(seed);
      decodeFromText(seed, 'paste');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [decodeFromText]);
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (clipboardConsent !== 'granted') return;
    autoDetectedRef.current = true;
    // Reviewer fix (implementation final pass) — `cancelled` flag
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

  // ─── Drag-drop (implementation note) ─────────────────────────────────────────
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

  // implementation note — copy source to clipboard secondary action.
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

  // implementation note — when the capsule originated from implementation's HTTP workspace,
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
    // MOV.02 (FASE 3) — surface the imported request as a full-screen
    // HTTP workspace tab (the dock panel is gone). Adopt the just-
    // created request id so tab.id === request.id.
    openHttpWorkspaceTab({ adoptEntryId: blank.id });
    pushStatusNotice({
      tone: 'success',
      messageKey: 'capsuleImport.notice.openedInHttp',
    });
    closeRef.current();
  }, [isHttpCapsule, pushStatusNotice, sourceJson]);

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-4xl"
      labelledById="capsule-import-title"
      // accessibility pass — `esc` (not the `button` X) so ModalShell seeds initial
      // focus on the first body control (the paste textarea) rather than the
      // close button: a keyboard user lands on the primary input. The Esc
      // keycap hint stays in the header; the footer Cancel + scrim still close.
      headerClose="esc"
      header={
        <div className="min-w-0">
          <h2
            id="capsule-import-title"
            className="truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
          >
            {t('capsuleImport.overlay.title')}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {t('capsuleImport.overlay.subtitle')}
          </p>
        </div>
      }
      footerLegend={<span />}
      trailing={
        <div
          data-testid="capsule-import-overlay-actions"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <button
            type="button"
            onClick={onClose}
            data-testid="capsule-import-overlay-cancel"
            className="button-ghost"
          >
            {t('capsuleImport.action.cancel')}
          </button>
          {decoded ? (
            <button
              type="button"
              onClick={handleCopySource}
              data-testid="capsule-import-overlay-copy-source"
              className="button-ghost"
            >
              {t('capsuleImport.action.copySource')}
            </button>
          ) : null}
          {isHttpCapsule ? (
            <button
              type="button"
              onClick={handleOpenInHttpWorkspace}
              data-testid="capsule-import-overlay-open-http"
              className="button-ghost"
            >
              {t('capsuleImport.action.openInHttp')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleConfirmOpenTab}
            disabled={!decoded}
            data-testid="capsule-import-overlay-confirm"
            className="button-primary"
          >
            {t('capsuleImport.action.openAsNewTab')}
          </button>
        </div>
      }
    >
      {/* The shell renders our children into its scrollable body. The
          drag-drop handlers + the drag-over ring attach here so a file
          dropped anywhere over the modal body still imports, and we
          carry the legacy `capsule-import-overlay` testid the suite
          asserts against. */}
      <div
        data-testid="capsule-import-overlay"
        className={cn(
          'grid gap-3 rounded-md p-1',
          isDragOver && 'ring-2 ring-accent/70 ring-offset-2 ring-offset-bg-panel'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* TOP — load source */}
        <section
          data-testid="capsule-import-overlay-load"
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="capsule-import-paste"
              className="text-caption font-semibold uppercase tracking-wider text-fg-subtle"
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
              className="min-h-[80px] resize-none rounded-md border border-border-default bg-bg-inset p-2 font-mono text-body-sm text-fg-base outline-none focus:border-border-strong"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-caption font-semibold uppercase tracking-wider text-fg-subtle">
              {t('capsuleImport.load.dropZone')}
            </span>
            <button
              type="button"
              onClick={handlePickFile}
              data-testid="capsule-import-open-file"
              className={cn(
                'flex h-[80px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-default bg-bg-inset px-3 text-center text-body-sm text-fg-subtle transition-colors',
                'hover:border-border-strong hover:text-fg-base',
                isDragOver && 'border-accent bg-accent/10 text-fg-base'
              )}
            >
              <FileUp size={14} aria-hidden="true" />
              <span>{t('capsuleImport.load.file')}</span>
              <span className="text-eyebrow">
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
              className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-inset px-3 py-2 text-caption text-fg-subtle"
            >
              <span>{t('capsuleImport.load.clipboardConsentPrompt')}</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setClipboardConsent('declined')}
                  data-testid="capsule-import-clipboard-decline"
                  className="button-ghost"
                >
                  {t('capsuleImport.load.clipboardConsentDecline')}
                </button>
                <button
                  type="button"
                  onClick={() => setClipboardConsent('granted')}
                  data-testid="capsule-import-clipboard-grant"
                  className="button-primary"
                >
                  {t('capsuleImport.load.clipboardConsentGrant')}
                </button>
              </span>
            </div>
          ) : null}
        </section>

        {/* MIDDLE — preview / reject / empty */}
        <section data-testid="capsule-import-overlay-body" className="min-h-0">
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
            <div
              data-testid="capsule-import-empty"
              className="flex h-full items-center justify-center rounded-lg border border-dashed border-border-subtle bg-bg-inset py-8"
            >
              <EmptyState
                icon={<FileUp size={18} aria-hidden="true" />}
                title={t('capsuleImport.empty.title')}
                description={t('capsuleImport.empty.hint')}
              />
            </div>
          )}
        </section>
      </div>
    </ModalShell>
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
  const { t, i18n } = useTranslation();
  const messageKey = REJECT_MESSAGE_KEYS[reason];
  return (
    <div
      role="alert"
      data-testid="capsule-import-reject"
      data-reason={reason}
      className="flex h-full flex-col gap-2 rounded-lg border border-error-border/60 bg-error-bg p-4 text-body-sm text-error-fg"
    >
      <header className="flex items-center gap-2 text-error-fg">
        <AlertCircle size={14} aria-hidden="true" />
        <h3 className="font-semibold">
          {t('capsuleImport.reject.title')}
        </h3>
      </header>
      <p>{t(messageKey)}</p>
      <p className="font-mono text-eyebrow text-error-fg/70">
        {formatNumber(byteLength, i18n.language)} B
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
