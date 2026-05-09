import { FieldLabel, JsonTreeNode, PanelSection, StatusMessage, UtilityTextarea } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { JWT_SUPPORTED_ALGORITHMS, decodeJwt, isJwtAlgorithm, signJwt, verifyJwt } from '../../../utils/jwt';
import type { JwtAlgorithm, JwtSignResult, JwtVerifyResult } from '../../../utils/jwt';

export function JwtUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<JwtMode>('decode');
  const [input, setInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZGV2In0.signature'
  );

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.jwt.title')}
        description={t('utilities.tool.jwt.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.mode.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.jwt.mode.label')}
            data-testid="jwt-mode"
            value={mode}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'decode' || next === 'verify' || next === 'sign') setMode(next);
            }}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="decode">{t('utilities.tool.jwt.mode.decode')}</option>
            <option value="verify">{t('utilities.tool.jwt.mode.verify')}</option>
            <option value="sign">{t('utilities.tool.jwt.mode.sign')}</option>
          </select>
        </div>
      </PanelSection>

      {mode === 'decode' ? (
        <JwtDecodeSection input={input} setInput={setInput} />
      ) : mode === 'verify' ? (
        <JwtVerifySection input={input} setInput={setInput} />
      ) : (
        <JwtSignSection />
      )}
    </div>
  );
}

type JwtMode = 'decode' | 'verify' | 'sign';

function JwtDecodeSection({
  input,
  setInput,
}: {
  input: string;
  setInput: (value: string) => void;
}) {
  const { t } = useTranslation();
  const analysis = useMemo(() => decodeJwt(input), [input]);

  // RL-069 Slice 1 — register the decoded payload (the user-meaningful
  // half of a decoded JWT) as the panel's output for Cmd+Shift+C.
  // verify and sign sub-modes don't register in Slice 1; Slice 2 will
  // unify all 3 modes once detect()-driven Apply lands.
  const registerOutput = useCallback(
    () => (analysis.payload ? JSON.stringify(analysis.payload, null, 2) : null),
    [analysis.payload]
  );
  useRegisterUtilityOutput(registerOutput);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <PanelSection
        title={t('utilities.tool.jwt.headerTitle')}
        description={t('utilities.tool.jwt.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.token')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.token')}
            data-testid="jwt-decode-token"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </PanelSection>

      <div className="grid gap-4">
        <PanelSection
          title={t('utilities.tool.jwt.headerTitle')}
          description={t('utilities.tool.jwt.headerDescription')}
        >
          {analysis.header ? (
            <div className="grid gap-2">
              <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
                <JsonTreeNode value={analysis.header} />
              </div>
              <div className="flex justify-end">
                <CopyButton
                  value={JSON.stringify(analysis.header, null, 2)}
                  testid="jwt-header-copy"
                />
              </div>
            </div>
          ) : (
            <StatusMessage message={t('utilities.tool.jwt.empty')} />
          )}
        </PanelSection>
        <PanelSection
          title={t('utilities.tool.jwt.payloadTitle')}
          description={t('utilities.tool.jwt.payloadDescription')}
        >
          {analysis.payload ? (
            <div className="grid gap-2">
              <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
                <JsonTreeNode value={analysis.payload} />
              </div>
              <div className="flex justify-end">
                <CopyButton
                  value={JSON.stringify(analysis.payload, null, 2)}
                  testid="jwt-payload-copy"
                />
              </div>
            </div>
          ) : (
            <StatusMessage message={t('utilities.tool.jwt.empty')} />
          )}
        </PanelSection>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </div>
    </div>
  );
}

function JwtVerifySection({
  input,
  setInput,
}: {
  input: string;
  setInput: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [result, setResult] = useState<JwtVerifyResult | null>(null);
  const [running, setRunning] = useState(false);

  const handleVerify = async () => {
    // Defensive re-entrancy guard in addition to the button's `disabled`
    // attr — protects the async closure from being re-invoked while a
    // prior call is still awaiting crypto.subtle.
    if (running) return;
    setRunning(true);
    try {
      const next = await verifyJwt(input, key, algorithm);
      setResult(next);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.jwt.verify.title')}
        description={t('utilities.tool.jwt.verify.description')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.token')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.token')}
            data-testid="jwt-verify-token"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.verify.algorithmLabel')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.jwt.verify.algorithmLabel')}
            data-testid="jwt-verify-algorithm"
            value={algorithm}
            onChange={(event) => {
              const next = event.target.value;
              if (isJwtAlgorithm(next)) setAlgorithm(next);
            }}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            {JWT_SUPPORTED_ALGORITHMS.map((alg) => (
              <option key={alg} value={alg}>
                {alg}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.verify.keyLabel')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jwt.verify.keyLabel')}
            data-testid="jwt-verify-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={t('utilities.tool.jwt.verify.keyPlaceholder')}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={running}
          data-testid="jwt-verify-run"
          className="inline-flex w-fit items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-50"
        >
          {t('utilities.tool.jwt.verify.action')}
        </button>
      </PanelSection>

      {result ? <JwtVerifyResultView result={result} /> : null}
    </div>
  );
}

function JwtVerifyResultView({ result }: { result: JwtVerifyResult }) {
  const { t } = useTranslation();

  if (result.ok) {
    return (
      <PanelSection
        title={t('utilities.tool.jwt.verify.resultTitle')}
        description={t('utilities.status.live')}
      >
        <StatusMessage
          tone="success"
          message={t('utilities.tool.jwt.verify.pass')}
          testid="jwt-verify-result-pass"
        />
        {result.warning?.kind === 'weak-hs-key' ? (
          <StatusMessage
            tone="warning"
            message={t('utilities.tool.jwt.verify.weakKeyWarning', {
              minBytes: result.warning.minBytes,
            })}
            testid="jwt-verify-result-weak"
          />
        ) : null}
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.payloadTitle')}</FieldLabel>
          <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
            <JsonTreeNode value={result.payload} />
          </div>
        </div>
      </PanelSection>
    );
  }

  const messageKey = verifyErrorMessageKey(result.kind);
  const values: Record<string, unknown> = {};
  if (result.kind === 'unsupported-algorithm' || result.kind === 'algorithm-mismatch') {
    values.claimed = result.claimed;
  }
  if (result.kind === 'algorithm-mismatch') {
    values.expected = result.expected;
  }

  return (
    <PanelSection
      title={t('utilities.tool.jwt.verify.resultTitle')}
      description={t('utilities.status.live')}
    >
      <StatusMessage
        tone="error"
        message={t(messageKey, values)}
        testid="jwt-verify-result-fail"
      />
    </PanelSection>
  );
}

function verifyErrorMessageKey(kind: Exclude<JwtVerifyResult, { ok: true }>['kind']): string {
  switch (kind) {
    case 'empty-token':
      return 'utilities.tool.jwt.error.emptyToken';
    case 'empty-key':
      return 'utilities.tool.jwt.error.emptyKey';
    case 'malformed-token':
      return 'utilities.tool.jwt.error.malformedToken';
    case 'invalid-jwk':
      return 'utilities.tool.jwt.error.invalidJwk';
    case 'missing-alg':
      return 'utilities.tool.jwt.error.missingAlg';
    case 'unsupported-algorithm':
      return 'utilities.tool.jwt.error.unsupportedAlgorithm';
    case 'algorithm-mismatch':
      return 'utilities.tool.jwt.error.algorithmMismatch';
    case 'signature-invalid':
      return 'utilities.tool.jwt.verify.fail';
    case 'unknown':
      return 'utilities.tool.jwt.error.unknown';
  }
}

function JwtSignSection() {
  const { t } = useTranslation();
  const [header, setHeader] = useState('{"alg":"HS256","typ":"JWT"}');
  const [payload, setPayload] = useState('{"sub":"lingua","role":"dev"}');
  const [key, setKey] = useState('');
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [result, setResult] = useState<JwtSignResult | null>(null);
  const [running, setRunning] = useState(false);

  const handleSign = async () => {
    // Same re-entrancy guard as handleVerify — belt-and-braces against
    // a stale closure scenario where the button disabled flag hasn't
    // flushed through React's async render by the time the click hits.
    if (running) return;
    setRunning(true);
    try {
      const next = await signJwt(header, payload, key, algorithm);
      setResult(next);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.jwt.sign.title')}
        description={t('utilities.tool.jwt.sign.description')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.headerLabel')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jwt.sign.headerLabel')}
            data-testid="jwt-sign-header"
            value={header}
            onChange={(event) => setHeader(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.payloadLabel')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jwt.sign.payloadLabel')}
            data-testid="jwt-sign-payload"
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.algorithmLabel')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.jwt.sign.algorithmLabel')}
            data-testid="jwt-sign-algorithm"
            value={algorithm}
            onChange={(event) => {
              const next = event.target.value;
              if (isJwtAlgorithm(next)) setAlgorithm(next);
            }}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            {JWT_SUPPORTED_ALGORITHMS.map((alg) => (
              <option key={alg} value={alg}>
                {alg}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.keyLabel')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jwt.sign.keyLabel')}
            data-testid="jwt-sign-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={t('utilities.tool.jwt.sign.keyPlaceholder')}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSign()}
          disabled={running}
          data-testid="jwt-sign-run"
          className="inline-flex w-fit items-center gap-2 rounded-[0.9rem] border border-border/80 bg-surface/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-50"
        >
          {t('utilities.tool.jwt.sign.action')}
        </button>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.jwt.sign.resultTitle')}
        description={t('utilities.status.live')}
      >
        {result?.ok ? (
          <div className="grid gap-2">
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.jwt.sign.resultTitle')}
                data-testid="jwt-sign-result"
                readOnly
                value={result.token}
                className="pr-10"
                spellCheck={false}
              />
              <div className="absolute right-2 top-2">
                <CopyButton value={result.token} testid="jwt-sign-copy" />
              </div>
            </div>
            {result.warning?.kind === 'weak-hs-key' ? (
              <StatusMessage
                tone="warning"
                message={t('utilities.tool.jwt.sign.weakKeyWarning', {
                  minBytes: result.warning.minBytes,
                })}
                testid="jwt-sign-weak-warning"
              />
            ) : null}
          </div>
        ) : result ? (
          <StatusMessage
            tone="error"
            message={t(signErrorMessageKey(result.kind))}
            testid="jwt-sign-result-error"
          />
        ) : (
          <StatusMessage message={t('utilities.tool.jwt.sign.empty')} />
        )}
      </PanelSection>
    </div>
  );
}

function signErrorMessageKey(kind: Exclude<JwtSignResult, { ok: true }>['kind']): string {
  switch (kind) {
    case 'invalid-header':
      return 'utilities.tool.jwt.error.invalidHeader';
    case 'invalid-payload':
      return 'utilities.tool.jwt.error.invalidPayload';
    case 'empty-key':
      return 'utilities.tool.jwt.error.emptyKey';
    case 'invalid-jwk':
      return 'utilities.tool.jwt.error.invalidJwk';
    case 'unsupported-algorithm':
      return 'utilities.tool.jwt.error.unsupportedAlgorithm';
    case 'unknown':
      return 'utilities.tool.jwt.error.unknown';
  }
}
