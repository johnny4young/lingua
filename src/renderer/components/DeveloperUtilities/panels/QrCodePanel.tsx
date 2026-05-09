import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { FileDropZone } from '../../ui/FileDropZone';
import { QR_DEFAULT_DARK, QR_DEFAULT_LIGHT, QR_ERROR_CORRECTION_LEVELS, QR_HIGH_CONTRAST_DARK, QR_HIGH_CONTRAST_LIGHT, copyPngDataUrlToClipboard, decodeQrFromFile, generateQrPngDataUrl, generateQrSvgDataUrl, isContrastSafeForQr, isQrErrorCorrectionLevel, qrCapacityFor, wcagContrastRatio } from '../../../utils/qrCode';
import type { QrDecodeResult, QrErrorCorrectionLevel, QrGenerationResult } from '../../../utils/qrCode';

type QrPanelMode = 'generate' | 'decode';
type CopyPngState = 'idle' | 'success' | 'unsupported' | 'failed';

function decodeErrorKey(
  error: Extract<QrDecodeResult, { ok: false }>
): string {
  switch (error.kind) {
    case 'empty':
      return 'utilities.tool.qrCode.decode.empty';
    case 'too-large':
      return 'utilities.tool.qrCode.decode.error.tooLarge';
    case 'too-many-pixels':
      return 'utilities.tool.qrCode.decode.error.tooManyPixels';
    case 'unsupported-type':
      return 'utilities.tool.qrCode.decode.error.unsupportedType';
    case 'image-load-failed':
      return 'utilities.tool.qrCode.decode.error.imageLoadFailed';
    case 'no-qr-found':
      return 'utilities.tool.qrCode.decode.error.notFound';
    case 'unknown':
    default:
      return 'utilities.tool.qrCode.decode.error.unknown';
  }
}

function copyPngLabelKey(state: CopyPngState): string {
  switch (state) {
    case 'success':
      return 'utilities.tool.qrCode.copyPng.success';
    case 'unsupported':
      return 'utilities.tool.qrCode.copyPng.unsupported';
    case 'failed':
      return 'utilities.tool.qrCode.copyPng.failed';
    case 'idle':
    default:
      return 'utilities.tool.qrCode.copyPng.button';
  }
}

export function QrCodePanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<QrPanelMode>('generate');
  const [payload, setPayload] = useState('https://linguacode.dev');
  const [level, setLevel] = useState<QrErrorCorrectionLevel>('M');
  const [highContrast, setHighContrast] = useState(false);
  const [darkColor, setDarkColor] = useState(QR_DEFAULT_DARK);
  const [lightColor, setLightColor] = useState(QR_DEFAULT_LIGHT);
  const [pngResult, setPngResult] = useState<QrGenerationResult<string> | null>(null);
  const [svgResult, setSvgResult] = useState<QrGenerationResult<string> | null>(null);
  const [copyPngState, setCopyPngState] = useState<CopyPngState>('idle');
  const [decodeResult, setDecodeResult] = useState<QrDecodeResult | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decodeRequestIdRef = useRef(0);

  // Effective render colors — high-contrast preset wins when toggled.
  const effectiveDark = highContrast ? QR_HIGH_CONTRAST_DARK : darkColor;
  const effectiveLight = highContrast ? QR_HIGH_CONTRAST_LIGHT : lightColor;
  const contrastSafe = isContrastSafeForQr(effectiveDark, effectiveLight);
  const contrastRatio = wcagContrastRatio(effectiveDark, effectiveLight);
  const contrastRatioLabel = contrastRatio.toFixed(1);

  // Regenerate the PNG + SVG data URLs whenever payload, level, or the
  // effective colors change. PNG drives the live preview through a
  // plain `<img>` tag (no HTML injection prop, no sanitizer needed).
  // SVG is generated in parallel so the Download-as-SVG anchor has a
  // ready data URL — generating on click would block the click handler.
  useEffect(() => {
    let cancelled = false;
    const colors = { dark: effectiveDark, light: effectiveLight };
    void (async () => {
      const [png, svg] = await Promise.all([
        generateQrPngDataUrl(payload, level, colors),
        generateQrSvgDataUrl(payload, level, colors),
      ]);
      if (cancelled) return;
      setPngResult(png);
      setSvgResult(svg);
    })();
    return () => {
      cancelled = true;
    };
  }, [payload, level, effectiveDark, effectiveLight]);

  // Restore the Copy-as-PNG label after a brief flash, mirroring the
  // pattern in CopyButton + the recovery UX clipboard fallback.
  useEffect(() => {
    if (copyPngState === 'idle') return;
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopyPngState('idle'), 1800);
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    };
  }, [copyPngState]);

  // Wire into utilityOutputStore (RL-069 Slice 1) so the global
  // Cmd+Shift+C / Cmd+Alt+R shortcuts target the active QR output:
  // the PNG data URL in generate mode, the decoded text in decode mode.
  const registerOutput = useCallback(() => {
    if (mode === 'decode') {
      return decodeResult && decodeResult.ok ? decodeResult.value : null;
    }
    return pngResult && pngResult.ok ? pngResult.value : null;
  }, [mode, decodeResult, pngResult]);
  useRegisterUtilityOutput(registerOutput);

  // RL-069 Slice 2 — Apply re-runs the live generation pipeline.
  // The output is already memoised via useEffect; the gesture exists
  // so a keyboard-only user can confirm "yes, encode this" and read
  // the success toast.
  const runApply = useCallback(() => {
    setPayload((prev) => prev);
  }, []);

  const capacity = qrCapacityFor(level);
  const generateErrorMessage =
    pngResult && !pngResult.ok
      ? pngResult.kind === 'empty'
        ? t('utilities.tool.qrCode.empty')
        : pngResult.kind === 'too-long'
          ? t('utilities.tool.qrCode.error.tooLong', { max: pngResult.capacity })
          : pngResult.message
      : null;

  const handleCopyPng = useCallback(async () => {
    if (!pngResult || !pngResult.ok) return;
    const result = await copyPngDataUrlToClipboard(pngResult.value);
    if (result.ok) {
      setCopyPngState('success');
      return;
    }
    setCopyPngState(result.reason === 'unsupported' ? 'unsupported' : 'failed');
  }, [pngResult]);

  const handleDecodeFile = useCallback(async (file: File) => {
    const requestId = decodeRequestIdRef.current + 1;
    decodeRequestIdRef.current = requestId;
    setDecodeResult(null);
    const result = await decodeQrFromFile(file);
    if (decodeRequestIdRef.current === requestId) {
      setDecodeResult(result);
    }
  }, []);

  const handleResetColors = useCallback(() => {
    setDarkColor(QR_DEFAULT_DARK);
    setLightColor(QR_DEFAULT_LIGHT);
    setHighContrast(false);
  }, []);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <FieldLabel>{t('utilities.tool.qrCode.mode.label')}</FieldLabel>
        <select
          aria-label={t('utilities.tool.qrCode.mode.label')}
          data-testid="qr-code-mode"
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'generate' || next === 'decode') setMode(next);
          }}
          className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
        >
          <option value="generate">
            {t('utilities.tool.qrCode.mode.generate')}
          </option>
          <option value="decode">
            {t('utilities.tool.qrCode.mode.decode')}
          </option>
        </select>
      </div>

      <UtilityToolbar
        utilityId="qr-code"
        primary={payload}
        run={runApply}
        setPrimary={setPayload}
      />

      {mode === 'generate' ? (
        <>
          <PanelSection
            title={t('utilities.tool.qrCode.title')}
            description={t('utilities.tool.qrCode.panelDescription')}
          >
            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.qrCode.input.label')}</FieldLabel>
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.qrCode.input.label')}
                  data-testid="qr-code-input"
                  value={payload}
                  onChange={(event) => setPayload(event.target.value)}
                  placeholder={t('utilities.tool.qrCode.input.placeholder')}
                  spellCheck={false}
                  className="pr-10"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={payload}
                    testid="qr-code-payload-copy"
                    disabled={!payload}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.qrCode.level.label')}</FieldLabel>
              <select
                aria-label={t('utilities.tool.qrCode.level.label')}
                data-testid="qr-code-level"
                value={level}
                onChange={(event) => {
                  const next = event.target.value;
                  // Options come from QR_ERROR_CORRECTION_LEVELS, but we still
                  // run the exported guard instead of an unchecked cast so a
                  // tampered DOM / fuzz test cannot force an invalid level
                  // through. If the guard rejects we drop the change silently.
                  if (isQrErrorCorrectionLevel(next)) setLevel(next);
                }}
                className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {QR_ERROR_CORRECTION_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`utilities.tool.qrCode.level.${levelKeySuffix(value)}`)}
                  </option>
                ))}
              </select>
            </div>

            <StatusMessage
              tone="muted"
              message={t('utilities.tool.qrCode.capacity', { max: capacity })}
            />
          </PanelSection>

          <PanelSection
            title={t('utilities.tool.qrCode.colors.title')}
            description={t('utilities.tool.qrCode.colors.description')}
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-[0.9rem] border border-border/80 bg-background/88 px-3 py-2 transition-colors hover:border-border-strong/90">
              <input
                type="checkbox"
                checked={highContrast}
                onChange={(event) => setHighContrast(event.target.checked)}
                data-testid="qr-code-high-contrast"
                className="h-4 w-4 cursor-pointer"
              />
              <span className="grid gap-0.5">
                <span className="text-xs font-medium text-foreground">
                  {t('utilities.tool.qrCode.highContrast.toggle')}
                </span>
                <span className="text-[11px] text-muted">
                  {t('utilities.tool.qrCode.highContrast.hint')}
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-muted">
                <FieldLabel>
                  {t('utilities.tool.qrCode.colors.foreground')}
                </FieldLabel>
                <span className="inline-flex items-center gap-3 rounded-[0.9rem] border border-border/80 bg-background/88 px-3 py-2">
                  <input
                    type="color"
                    aria-label={t('utilities.tool.qrCode.colors.foreground')}
                    data-testid="qr-code-color-dark"
                    value={effectiveDark}
                    disabled={highContrast}
                    onChange={(event) => setDarkColor(event.target.value)}
                    className="h-7 w-10 cursor-pointer rounded-[0.55rem] border border-border/60 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span
                    className="font-mono text-[11px] text-foreground"
                    data-testid="qr-code-color-dark-readout"
                  >
                    {effectiveDark.toUpperCase()}
                  </span>
                </span>
              </label>
              <label className="grid gap-1 text-xs text-muted">
                <FieldLabel>
                  {t('utilities.tool.qrCode.colors.background')}
                </FieldLabel>
                <span className="inline-flex items-center gap-3 rounded-[0.9rem] border border-border/80 bg-background/88 px-3 py-2">
                  <input
                    type="color"
                    aria-label={t('utilities.tool.qrCode.colors.background')}
                    data-testid="qr-code-color-light"
                    value={effectiveLight}
                    disabled={highContrast}
                    onChange={(event) => setLightColor(event.target.value)}
                    className="h-7 w-10 cursor-pointer rounded-[0.55rem] border border-border/60 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span
                    className="font-mono text-[11px] text-foreground"
                    data-testid="qr-code-color-light-readout"
                  >
                    {effectiveLight.toUpperCase()}
                  </span>
                </span>
              </label>
            </div>

            <StatusMessage
              tone={contrastSafe ? 'success' : 'error'}
              testid="qr-code-contrast-status"
              message={
                contrastSafe
                  ? t('utilities.tool.qrCode.colors.contrastOk', {
                      ratio: contrastRatioLabel,
                    })
                  : t('utilities.tool.qrCode.colors.contrastWarning', {
                      ratio: contrastRatioLabel,
                    })
              }
            />

            <button
              type="button"
              onClick={handleResetColors}
              data-testid="qr-code-color-reset"
              className="inline-flex w-fit items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80"
            >
              {t('utilities.tool.qrCode.colors.reset')}
            </button>
          </PanelSection>

          <PanelSection
            title={t('utilities.tool.qrCode.preview.title')}
            description={t('utilities.tool.qrCode.preview.description')}
          >
            {generateErrorMessage ? (
              <StatusMessage
                tone={
                  pngResult?.ok === false && pngResult.kind === 'empty'
                    ? 'muted'
                    : 'error'
                }
                message={generateErrorMessage}
              />
            ) : pngResult?.ok ? (
              <div className="grid gap-3">
                <img
                  src={pngResult.value}
                  alt={t('utilities.tool.qrCode.preview.alt', { payload })}
                  data-testid="qr-code-image"
                  className="mx-auto h-64 w-64 rounded-[1.1rem] border border-border/80 bg-background/65 p-2"
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <a
                    href={pngResult.value}
                    download="qr-code.png"
                    data-testid="qr-code-download"
                    className="inline-flex items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80"
                  >
                    {t('utilities.tool.qrCode.download.png')}
                  </a>
                  {svgResult?.ok ? (
                    <a
                      href={svgResult.value}
                      download="qr-code.svg"
                      data-testid="qr-code-download-svg"
                      className="inline-flex items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80"
                    >
                      {t('utilities.tool.qrCode.download.svg')}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCopyPng}
                    data-testid="qr-code-copy-png"
                    className="inline-flex items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80"
                  >
                    {t(copyPngLabelKey(copyPngState))}
                  </button>
                </div>
              </div>
            ) : null}
          </PanelSection>
        </>
      ) : (
        <>
          <PanelSection
            title={t('utilities.tool.qrCode.decode.title')}
            description={t('utilities.tool.qrCode.decode.description')}
          >
            <FileDropZone
              testId="qr-code-decode-dropzone"
              inputTestId="qr-code-decode-input"
              acceptAttr="image/*"
              onFile={handleDecodeFile}
              hint={t('utilities.tool.qrCode.decode.dropzone.idle')}
              placeholder={t('utilities.tool.qrCode.decode.fileButton')}
              errorMessage={
                decodeResult && !decodeResult.ok
                  ? t(decodeErrorKey(decodeResult))
                  : undefined
              }
            />
          </PanelSection>

          <PanelSection
            title={t('utilities.tool.qrCode.decode.payload.label')}
            description={t('utilities.tool.qrCode.decode.payload.description')}
          >
            {decodeResult?.ok ? (
              <div className="grid gap-2">
                <div className="relative">
                  <UtilityTextarea
                    aria-label={t('utilities.tool.qrCode.decode.payload.label')}
                    data-testid="qr-code-decoded-payload"
                    value={decodeResult.value}
                    readOnly
                    spellCheck={false}
                    className="pr-10 font-mono text-xs"
                  />
                  <div className="absolute right-2 top-2">
                    <CopyButton
                      value={decodeResult.value}
                      testid="qr-code-decoded-copy"
                    />
                  </div>
                </div>
              </div>
            ) : decodeResult && !decodeResult.ok ? (
              <StatusMessage
                tone="error"
                testid="qr-code-decode-error"
                message={t(decodeErrorKey(decodeResult))}
              />
            ) : (
              <StatusMessage
                tone="muted"
                message={t('utilities.tool.qrCode.decode.empty')}
              />
            )}
          </PanelSection>
        </>
      )}
    </div>
  );
}

function levelKeySuffix(level: QrErrorCorrectionLevel): 'low' | 'medium' | 'quartile' | 'high' {
  switch (level) {
    case 'L':
      return 'low';
    case 'M':
      return 'medium';
    case 'Q':
      return 'quartile';
    case 'H':
      return 'high';
  }
}
