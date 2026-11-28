import { FieldLabel, PanelSection, StatusMessage, UtilityToolbar, UtilityTextarea } from '../panelPrimitives';
import { JsonSyntaxOutput } from '../JsonSyntaxOutput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePendingUtilityInput } from '../usePendingUtilityInput';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { JWT_SUPPORTED_ALGORITHMS, decodeJwt, isJwtAlgorithm, signJwt, verifyJwt } from '../../../utils/jwt';
import type { JwtAlgorithm, JwtSignResult, JwtVerifyResult } from '../../../utils/jwt';
import { ToolResultHeader } from '../ToolAnswerParts';
import { useToolClock } from '../useToolClock';
import { claimTime, hasTimeClaim, invalidAnswer, isOneOf, jwtAnswer } from '../toolAnswers';
import { formatNumber } from '../../../i18n/formatNumber';
import { JwtDecodeView } from './JwtDecodeView';
import { JwtColoredTokenArea, JwtSignaturePill } from './JwtToken';
import {
  JWT_HEADER_COLOR,
  JWT_PAYLOAD_COLOR,
  jwtSegmentBytes,
  jwtSignatureColor,
  resolveSignatureState,
  type JwtSignatureState,
} from './jwtSegments';

const MODES = ['decode', 'verify', 'sign'] as const;
type JwtMode = (typeof MODES)[number];

export function JwtUtilityPanel() {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<JwtMode>('decode');
  const [input, setInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZGV2In0.signature'
  );
  const [signed, setSigned] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<JwtSignatureState>('unverified');
  // A smart-pasted token lands in decode mode (the common case).
  usePendingUtilityInput('jwt', pending => {
    setMode('decode');
    setInput(pending);
  });

  // Apply targets the common case: show the current token's claims.
  const runApply = useCallback(() => {
    setMode('decode');
  }, []);

  // The header reads the token on screen: the input, or in Sign mode the token just signed.
  const token = mode === 'sign' ? signed ?? '' : input;
  const analysis = useMemo(() => decodeJwt(token), [token]);
  const now = useToolClock(token, hasTimeClaim(analysis.payload), [claimTime(analysis.payload?.exp)]);
  const signatureState = resolveSignatureState(token, mode === 'sign' ? 'signed' : mode === 'verify' ? verifyState : 'unverified');
  const reading =
    analysis.header && analysis.payload ? jwtAnswer(analysis.header, analysis.payload, now, t, i18n.language) : null;
  const answer = reading ? reading.answer : analysis.errorKey ? invalidAnswer(t) : null;
  const bytes = useMemo(() => jwtSegmentBytes(token), [token]);

  // Copy output takes the decoded payload; Verify and Sign keep their own copy buttons.
  const decodedPayload = mode === 'decode' ? analysis.payload : null;
  const registerOutput = useCallback(
    () => (decodedPayload ? JSON.stringify(decodedPayload, null, 2) : null),
    [decodedPayload]
  );
  useRegisterUtilityOutput(registerOutput);

  return (
    <div className="tool-answer-panel">
      <ToolResultHeader
        testId="jwt-result-header"
        tag="JWT"
        answer={answer}
        meta={reading?.meta || undefined}
        segments={
          analysis.header && analysis.payload
            ? {
                testId: 'jwt-segments',
                label: t('utilities.answer.jwt.segments', {
                  header: formatNumber(bytes.header, i18n.language),
                  payload: formatNumber(bytes.payload, i18n.language),
                  signature: formatNumber(bytes.signature, i18n.language),
                }),
                parts: [
                  { key: 'header', ms: bytes.header, color: JWT_HEADER_COLOR },
                  { key: 'payload', ms: bytes.payload, color: JWT_PAYLOAD_COLOR },
                  { key: 'signature', ms: bytes.signature, color: jwtSignatureColor(signatureState) },
                ],
              }
            : undefined
        }
        tabs={MODES.map(id => ({ id, label: t(`utilities.tool.jwt.mode.${id}`), testId: `jwt-mode-${id}` }))}
        activeTab={mode}
        onTabChange={id => {
          if (!isOneOf(MODES, id) || id === mode) return;
          // Verify and Sign remount empty, so their last reading must not head the next visit.
          setSigned(null);
          setVerifyState('unverified');
          setMode(id);
        }}
      />

      {mode === 'decode' ? (
        <JwtDecodeView input={input} setInput={setInput} analysis={analysis} now={now} bytes={bytes} signatureState={signatureState} />
      ) : mode === 'verify' ? (
        <JwtVerifySection input={input} setInput={setInput} onSignatureState={setVerifyState} />
      ) : (
        <JwtSignSection onSigned={setSigned} />
      )}
      <UtilityToolbar utilityId="jwt" primary={input} run={runApply} setPrimary={setInput} />
    </div>
  );
}

function JwtVerifySection({
  input,
  setInput,
  onSignatureState,
}: {
  input: string;
  setInput: (value: string) => void;
  onSignatureState: (state: JwtSignatureState) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [result, setResult] = useState<JwtVerifyResult | null>(null);
  const [running, setRunning] = useState(false);
  const signatureState: JwtSignatureState =
    result === null ? 'unverified' : result.ok ? 'verified' : 'failed';
  const resetVerification = useCallback(() => setResult(null), []);
  useEffect(() => onSignatureState(signatureState), [onSignatureState, signatureState]);
  const latestVerificationInputRef = useRef({ input, key, algorithm });

  useEffect(() => {
    latestVerificationInputRef.current = { input, key, algorithm };
  }, [input, key, algorithm]);

  const handleVerify = async () => {
    // Defensive re-entrancy guard in addition to the button's `disabled`
    // attr — protects the async closure from being re-invoked while a
    // prior call is still awaiting crypto.subtle.
    if (running) return;
    const request = { input, key, algorithm };
    setRunning(true);
    try {
      const next = await verifyJwt(request.input, request.key, request.algorithm);
      const latest = latestVerificationInputRef.current;
      if (
        latest.input === request.input &&
        latest.key === request.key &&
        latest.algorithm === request.algorithm
      ) {
        setResult(next);
      }
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
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>{t('utilities.field.token')}</FieldLabel>
            {input.trim() ? (
              <JwtSignaturePill state={resolveSignatureState(input, signatureState)} />
            ) : null}
          </div>
          <JwtColoredTokenArea
            ariaLabel={t('utilities.field.token')}
            testid="jwt-verify-token"
            value={input}
            onChange={next => {
              setInput(next);
              resetVerification();
            }}
            signatureState={resolveSignatureState(input, signatureState)}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.verify.algorithmLabel')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.jwt.verify.algorithmLabel')}
            data-testid="jwt-verify-algorithm"
            value={algorithm}
            onChange={event => {
              const next = event.target.value;
              if (isJwtAlgorithm(next)) {
                setAlgorithm(next);
                resetVerification();
              }
            }}
            className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
          >
            {JWT_SUPPORTED_ALGORITHMS.map(alg => (
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
            onChange={event => {
              setKey(event.target.value);
              resetVerification();
            }}
            placeholder={t('utilities.tool.jwt.verify.keyPlaceholder')}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={running}
          data-testid="jwt-verify-run"
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-surface/60 px-3 py-2 text-body-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-40"
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
      <PanelSection title={t('utilities.tool.jwt.verify.resultTitle')}>
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
          <JsonSyntaxOutput
            ariaLabel={t('utilities.tool.jwt.payloadTitle')}
            testid="jwt-verify-payload-output"
            value={JSON.stringify(result.payload, null, 2)}
          />
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
    <PanelSection title={t('utilities.tool.jwt.verify.resultTitle')}>
      <StatusMessage tone="error" message={t(messageKey, values)} testid="jwt-verify-result-fail" />
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

function JwtSignSection({ onSigned }: { onSigned: (token: string | null) => void }) {
  const { t } = useTranslation();
  const [header, setHeader] = useState('{"alg":"HS256","typ":"JWT"}');
  const [payload, setPayload] = useState('{"sub":"lingua","role":"dev"}');
  const [key, setKey] = useState('');
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [result, setResult] = useState<JwtSignResult | null>(null);
  const [running, setRunning] = useState(false);
  const signedToken = result?.ok ? result.token : null;
  useEffect(() => onSigned(signedToken), [onSigned, signedToken]);

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
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
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
            onChange={event => setHeader(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.payloadLabel')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jwt.sign.payloadLabel')}
            data-testid="jwt-sign-payload"
            value={payload}
            onChange={event => setPayload(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jwt.sign.algorithmLabel')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.jwt.sign.algorithmLabel')}
            data-testid="jwt-sign-algorithm"
            value={algorithm}
            onChange={event => {
              const next = event.target.value;
              if (isJwtAlgorithm(next)) setAlgorithm(next);
            }}
            className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
          >
            {JWT_SUPPORTED_ALGORITHMS.map(alg => (
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
            onChange={event => setKey(event.target.value)}
            placeholder={t('utilities.tool.jwt.sign.keyPlaceholder')}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSign()}
          disabled={running}
          data-testid="jwt-sign-run"
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-surface/60 px-3 py-2 text-body-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-40"
        >
          {t('utilities.tool.jwt.sign.action')}
        </button>
      </PanelSection>

      <PanelSection title={t('utilities.tool.jwt.sign.resultTitle')}>
        {result?.ok ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <JwtSignaturePill state="signed" />
              <CopyButton value={result.token} testid="jwt-sign-copy" />
            </div>
            <JwtColoredTokenArea
              ariaLabel={t('utilities.tool.jwt.sign.resultTitle')}
              testid="jwt-sign-result"
              readOnly
              value={result.token}
              signatureState="signed"
            />
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

