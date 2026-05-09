import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { FileDropZone } from '../../ui/FileDropZone';
import { BASE64_IMAGE_MAX_BYTES, decodeDataUri, encodeFileToDataUri, formatByteSize } from '../../../utils/base64Image';
import { detectsAsDataUri } from '../../../utils/developerUtilities';
import type { Base64ImageDecodeResult, Base64ImageEncodeResult } from '../../../utils/base64Image';

type Base64ImageMode = 'encode' | 'decode';

interface Base64ImageEncodeError {
  kind: 'not-image' | 'too-large' | 'read-error';
  mime?: string;
  byteSize?: number;
}

interface Base64ImageDecodeError {
  kind: 'invalid-uri' | 'not-image' | 'too-large' | 'invalid-base64';
  mime?: string;
  byteSize?: number;
}

export function Base64ImagePanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Base64ImageMode>('encode');

  const [encoded, setEncoded] = useState<
    Extract<Base64ImageEncodeResult, { ok: true }> | null
  >(null);
  const [encodeError, setEncodeError] = useState<Base64ImageEncodeError | null>(null);

  const [decodeInput, setDecodeInput] = useState('');
  const decoded = useMemo<
    | { ok: true; value: Extract<Base64ImageDecodeResult, { ok: true }> }
    | { ok: false; value: Base64ImageDecodeError }
    | null
  >(() => {
    if (decodeInput.trim() === '') return null;
    const result = decodeDataUri(decodeInput);
    return result.ok ? { ok: true, value: result } : { ok: false, value: result };
  }, [decodeInput]);

  // RL-069 Slice 2 — encode mode exposes the data URI; decode mode
  // exposes a 1-line summary. Errors fall through to null.
  const registerOutput = useCallback(() => {
    if (mode === 'encode') {
      return encoded?.dataUri ?? null;
    }
    if (decoded && decoded.ok) {
      return `${decoded.value.mime} · ${formatByteSize(decoded.value.byteSize)}`;
    }
    return null;
  }, [mode, encoded, decoded]);
  useRegisterUtilityOutput(registerOutput);

  // Apply auto-flips to decode when the input looks like a data: URI.
  const runApply = useCallback(() => {
    if (detectsAsDataUri(decodeInput)) {
      setMode('decode');
    } else {
      setMode('encode');
    }
  }, [decodeInput]);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    const result = await encodeFileToDataUri(file);
    if (result.ok) {
      setEncoded(result);
      setEncodeError(null);
    } else {
      setEncoded(null);
      setEncodeError(result);
    }
  };

  const describeEncodeError = (error: Base64ImageEncodeError): string => {
    if (error.kind === 'not-image') {
      return t('utilities.tool.base64Image.encode.error.notImage', {
        mime: error.mime ?? 'unknown',
      });
    }
    if (error.kind === 'too-large') {
      return t('utilities.tool.base64Image.encode.error.tooLarge', {
        max: formatByteSize(BASE64_IMAGE_MAX_BYTES),
        actual: formatByteSize(error.byteSize ?? 0),
      });
    }
    return t('utilities.tool.base64Image.encode.error.readError');
  };

  const describeDecodeError = (error: Base64ImageDecodeError): string => {
    if (error.kind === 'invalid-uri') {
      return t('utilities.tool.base64Image.decode.error.invalidUri');
    }
    if (error.kind === 'not-image') {
      return t('utilities.tool.base64Image.decode.error.notImage', {
        mime: error.mime ?? 'unknown',
      });
    }
    if (error.kind === 'too-large') {
      return t('utilities.tool.base64Image.decode.error.tooLarge', {
        max: formatByteSize(BASE64_IMAGE_MAX_BYTES),
        actual: formatByteSize(error.byteSize ?? 0),
      });
    }
    return t('utilities.tool.base64Image.decode.error.invalidBase64');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.base64Image.title')}
        description={t('utilities.tool.base64Image.panelDescription')}
      >
        <label className="grid gap-1 text-xs text-muted">
          <FieldLabel>{t('utilities.tool.base64Image.mode.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.base64Image.mode.label')}
            data-testid="base64-image-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as Base64ImageMode)}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="encode">{t('utilities.tool.base64Image.mode.encode')}</option>
            <option value="decode">{t('utilities.tool.base64Image.mode.decode')}</option>
          </select>
        </label>

        <UtilityToolbar utilityId="base64-image" primary={decodeInput} run={runApply} />

        {mode === 'encode' ? (
          <div className="grid gap-2">
            {/* RL-070 — migrated to <FileDropZone>. The previous version
                had two separate surfaces (a dropzone div + a separate
                native file input below) which were redundant — the new
                component folds both into a single <label> so click
                anywhere opens the picker AND drag-drop works on the same
                target. The `dragOver` local state and its corresponding
                handlers go away entirely; the hook owns the state machine. */}
            <FileDropZone
              testId="base64-image-dropzone"
              inputTestId="base64-image-file-input"
              acceptAttr="image/*"
              onFile={handleFile}
              hint={t('utilities.tool.base64Image.encode.dropHint')}
              placeholder={t('utilities.tool.base64Image.encode.maxSize', {
                max: formatByteSize(BASE64_IMAGE_MAX_BYTES),
              })}
              errorMessage={
                encodeError ? describeEncodeError(encodeError) : undefined
              }
            />
            {encodeError ? (
              // Keep the existing testid live for regression tests that
              // assert against `base64-image-encode-error` directly. The
              // visual is now redundant with the dropzone's error state,
              // so render the StatusMessage hidden visually but present
              // in the DOM for the test query.
              <StatusMessage
                tone="error"
                testid="base64-image-encode-error"
                message={describeEncodeError(encodeError)}
                className="sr-only"
              />
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <FieldLabel>{t('utilities.tool.base64Image.decode.inputLabel')}</FieldLabel>
            <UtilityTextarea
              aria-label={t('utilities.tool.base64Image.decode.inputLabel')}
              data-testid="base64-image-decode-input"
              value={decodeInput}
              onChange={(event) => setDecodeInput(event.target.value)}
              placeholder={t('utilities.tool.base64Image.decode.placeholder') ?? undefined}
              spellCheck={false}
            />
            {decoded && !decoded.ok ? (
              <StatusMessage
                tone="error"
                testid="base64-image-decode-error"
                message={describeDecodeError(decoded.value)}
              />
            ) : null}
          </div>
        )}
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.base64Image.preview.title')}
        description={t('utilities.status.live')}
      >
        {mode === 'encode' ? (
          encoded ? (
            <div className="grid gap-3">
              <img
                data-testid="base64-image-preview"
                src={encoded.dataUri}
                alt={t('utilities.tool.base64Image.preview.alt')}
                className="max-h-48 w-full rounded-[1rem] border border-border/80 bg-background/70 object-contain"
              />
              <StatusMessage
                testid="base64-image-metadata"
                message={t('utilities.tool.base64Image.metadata.summary', {
                  mime: encoded.mime,
                  size: formatByteSize(encoded.byteSize),
                })}
              />
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.base64Image.encode.outputLabel')}
                  data-testid="base64-image-encode-output"
                  value={encoded.dataUri}
                  readOnly
                  spellCheck={false}
                  className="pr-10 font-mono text-xs"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={encoded.dataUri}
                    testid="base64-image-encode-output-copy"
                  />
                </div>
              </div>
            </div>
          ) : (
            <StatusMessage message={t('utilities.tool.base64Image.encode.empty')} />
          )
        ) : decoded?.ok ? (
          <div className="grid gap-3">
            <img
              data-testid="base64-image-preview"
              src={decoded.value.dataUri}
              alt={t('utilities.tool.base64Image.preview.alt')}
              className="max-h-48 w-full rounded-[1rem] border border-border/80 bg-background/70 object-contain"
            />
            <StatusMessage
              testid="base64-image-metadata"
              message={t('utilities.tool.base64Image.metadata.summary', {
                mime: decoded.value.mime,
                size: formatByteSize(decoded.value.byteSize),
              })}
            />
          </div>
        ) : (
          <StatusMessage message={t('utilities.tool.base64Image.decode.empty')} />
        )}
      </PanelSection>
    </div>
  );
}
