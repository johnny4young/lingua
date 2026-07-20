import { FieldLabel, PanelSection, StatusMessage, UtilityInput, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { FileDropZone } from '../../ui/FileDropZone';
import { HASH_ALGORITHMS, HASH_FILE_MAX_BYTES, HASH_FILE_MAX_MB, HMAC_ALGORITHMS, computeHash } from '../../../utils/developerUtilities';
import type { HashAlgorithm, HashMode, HashResult } from '../../../utils/developerUtilities';
import { formatByteSize } from '../../../utils/base64Image';

type HashInputSource = 'text' | 'file';

type HashFileState = {
  name: string;
  size: number;
  buffer: ArrayBuffer;
};

const HASH_ALGORITHM_I18N_KEYS: Record<HashAlgorithm, string> = {
  MD5: 'utilities.tool.hash.algorithms.md5',
  'SHA-1': 'utilities.tool.hash.algorithms.sha1',
  'SHA-256': 'utilities.tool.hash.algorithms.sha256',
  'SHA-384': 'utilities.tool.hash.algorithms.sha384',
  'SHA-512': 'utilities.tool.hash.algorithms.sha512',
};

export function HashUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<HashMode>('plain');
  const [source, setSource] = useState<HashInputSource>('text');
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [text, setText] = useState('Lingua');
  const [hmacKey, setHmacKey] = useState('');
  const [file, setFile] = useState<HashFileState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<HashResult | null>(null);
  // Monotonic counter for file-read operations so a slow `arrayBuffer()`
  // call from a superseded file drop can't clobber the newer selection.
  const fileRequestRef = useRef(0);

  const handleModeChange = (next: HashMode) => {
    // Flip mode AND correct the algorithm in the same event tick so we
    // never render the invalid `hmac`+`MD5` combo — React batches these
    // setState calls and the next render lands with both values coherent.
    setMode(next);
    if (next === 'hmac' && algorithm === 'MD5') {
      setAlgorithm('SHA-256');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const payload: string | ArrayBuffer | null =
      source === 'file' ? file?.buffer ?? null : text;

    if (payload === null) {
      // No file picked yet — surface the empty hint without kicking off a hash.
      setResult({ ok: false, errorKey: 'utilities.tool.hash.error.empty' });
      return () => {
        cancelled = true;
      };
    }

    void computeHash(payload, { algorithm, mode, key: hmacKey }).then((next) => {
      if (!cancelled) {
        setResult(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [algorithm, mode, source, text, hmacKey, file]);

  const handleFile = async (dropped: File | null) => {
    // Bump the generation counter up front so earlier in-flight reads skip
    // their setState calls. Only the latest request commits its result.
    fileRequestRef.current += 1;
    const requestId = fileRequestRef.current;
    setFileError(null);
    if (!dropped) {
      setFile(null);
      return;
    }
    if (dropped.size > HASH_FILE_MAX_BYTES) {
      setFileError('utilities.tool.hash.error.fileTooLarge');
      setFile(null);
      return;
    }
    try {
      const buffer = await dropped.arrayBuffer();
      if (fileRequestRef.current !== requestId) return;
      setFile({ name: dropped.name, size: dropped.size, buffer });
    } catch {
      if (fileRequestRef.current !== requestId) return;
      setFileError('utilities.tool.hash.error.fileRead');
      setFile(null);
    }
  };

  const algorithmOptions = mode === 'hmac' ? HMAC_ALGORITHMS : HASH_ALGORITHMS;

  // implementation — Hex digest is the canonical output. Surface null
  // when the result is missing or errored so Cmd+Shift+C falls through
  // to the empty-output toast.
  const registerOutput = useCallback(
    () => (result && result.ok ? result.hex : null),
    [result]
  );
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    // No-op trigger; the live `useEffect` already (re)computes the
    // digest whenever any input changes. The success toast acks the
    // gesture for keyboard-driven users.
    setText((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.hash.title')}
        description={t('utilities.tool.hash.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.hash.mode.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.hash.mode.label')}
              data-testid="hash-mode"
              value={mode}
              onChange={(event) => handleModeChange(event.target.value as HashMode)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="plain">{t('utilities.tool.hash.mode.plain')}</option>
              <option value="hmac">{t('utilities.tool.hash.mode.hmac')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.hash.source.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.hash.source.label')}
              data-testid="hash-source"
              value={source}
              onChange={(event) => setSource(event.target.value as HashInputSource)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="text">{t('utilities.tool.hash.source.text')}</option>
              <option value="file">{t('utilities.tool.hash.source.file')}</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-body-sm text-muted">
          <FieldLabel>{t('utilities.tool.hash.algorithmLabel')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.hash.algorithmLabel')}
            data-testid="hash-algorithm"
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value as HashAlgorithm)}
            className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
          >
            {algorithmOptions.map((algo) => (
              <option key={algo} value={algo}>
                {t(HASH_ALGORITHM_I18N_KEYS[algo])}
              </option>
            ))}
          </select>
        </label>
        {mode === 'hmac' ? (
          <div className="grid gap-2">
            <FieldLabel>{t('utilities.tool.hash.key.label')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.hash.key.label')}
              data-testid="hash-hmac-key"
              value={hmacKey}
              onChange={(event) => setHmacKey(event.target.value)}
              placeholder={t('utilities.tool.hash.key.placeholder') ?? undefined}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        ) : null}
        {source === 'text' ? (
          <div className="grid gap-2">
            <FieldLabel>{t('utilities.tool.hash.input.textLabel')}</FieldLabel>
            <UtilityTextarea
              aria-label={t('utilities.tool.hash.input.textLabel')}
              data-testid="hash-input-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="grid gap-2">
            <FieldLabel>{t('utilities.tool.hash.input.fileLabel')}</FieldLabel>
            {/* internal — migrated to <FileDropZone> so the hash input
                inherits the new four-state visual (idle/over/dropping/
                error). The wrapper testid `hash-dropzone` is preserved
                for the existing regression test, and the hidden file
                input keeps its `hash-file-input` testid via the new
                `inputTestId` prop. The legacy `<StatusMessage>` for
                fileError is now folded into the dropzone's `error`
                visual via `errorMessage`. */}
            <FileDropZone
              testId="hash-dropzone"
              inputTestId="hash-file-input"
              onFile={handleFile}
              hint={t('utilities.tool.hash.input.dropHint')}
              placeholder={t('utilities.tool.hash.input.filePlaceholder')}
              summary={
                file ? (
                  <span
                    className="font-mono text-body-sm text-foreground"
                    data-testid="hash-file-summary"
                  >
                    {t('utilities.tool.hash.input.fileSummary', {
                      name: file.name,
                      size: formatByteSize(file.size),
                    })}
                  </span>
                ) : undefined
              }
              errorMessage={
                fileError ? t(fileError, { limitMb: HASH_FILE_MAX_MB }) : undefined
              }
            />
          </div>
        )}
        <UtilityToolbar
          utilityId="hash"
          primary={source === 'text' ? text : file?.name ?? ''}
          run={runApply}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.hash.output.label')}
        description={t('utilities.status.live')}
      >
        {result === null ? (
          <StatusMessage message={t('utilities.tool.hash.error.empty')} tone="muted" />
        ) : !result.ok ? (
          <div className="grid gap-2">
            <StatusMessage
              message={t(result.errorKey, { limitMb: HASH_FILE_MAX_MB })}
              tone={result.errorKey === 'utilities.tool.hash.error.empty' ? 'muted' : 'error'}
              testid="hash-error"
            />
            {result.message ? (
              <p
                className="rounded-xl border border-border/70 bg-background/55 px-3 py-2 font-mono text-body-sm text-muted"
                data-testid="hash-error-detail"
              >
                {result.message}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.hash.output.label')}
                data-testid="hash-output"
                readOnly
                value={result.hex}
                className="pr-10 font-mono"
                spellCheck={false}
              />
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.hex}
                  testid="hash-output-copy"
                  disabled={!result.hex}
                />
              </div>
            </div>
            <StatusMessage
              tone="muted"
              testid="hash-byte-length"
              message={t('utilities.tool.hash.byteLength', { bytes: result.inputByteLength })}
            />
          </div>
        )}
      </PanelSection>
    </div>
  );
}
