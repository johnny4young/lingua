import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityToolbar,
  UtilityTextarea,
} from '../panelPrimitives';
import { JsonSyntaxOutput } from '../JsonSyntaxOutput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { cn } from '../../../utils/cn';
import {
  JWT_SUPPORTED_ALGORITHMS,
  decodeJwt,
  isJwtAlgorithm,
  signJwt,
  verifyJwt,
} from '../../../utils/jwt';
import type { JwtAlgorithm, JwtSignResult, JwtVerifyResult } from '../../../utils/jwt';

export function JwtUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<JwtMode>('decode');
  const [input, setInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZGV2In0.signature'
  );

  // RL-069 Slice 2 — Apply forces the panel into decode mode against
  // the current token. Verify and Sign sub-modes have their own
  // explicit "Run" buttons; the productivity gesture targets the
  // common case (paste a token, see its claims).
  const runApply = useCallback(() => {
    setMode('decode');
  }, []);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.jwt.title')}
        description={t('utilities.tool.jwt.panelDescription')}
      >
        {/* Space audit — the mode select shares the toolbar's single
            row (mode · Apply · Recent runs) instead of stacking its own
            labeled block above it. The label survives as aria-label. */}
        <UtilityToolbar
          utilityId="jwt"
          primary={input}
          run={runApply}
          setPrimary={setInput}
          leading={
            <select
              aria-label={t('utilities.tool.jwt.mode.label')}
              data-testid="jwt-mode"
              value={mode}
              onChange={event => {
                const next = event.target.value;
                if (next === 'decode' || next === 'verify' || next === 'sign') setMode(next);
              }}
              className="rounded-full border border-border/80 bg-bg-panel py-1.5 pl-3 pr-8 text-body-sm font-semibold text-fg-base outline-none transition-colors hover:bg-bg-panel-alt focus:border-accent/55"
            >
              <option value="decode">{t('utilities.tool.jwt.mode.decode')}</option>
              <option value="verify">{t('utilities.tool.jwt.mode.verify')}</option>
              <option value="sign">{t('utilities.tool.jwt.mode.sign')}</option>
            </select>
          }
        />
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
type JwtSignatureState = 'missing' | 'unverified' | 'verified' | 'failed' | 'signed';

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
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      <PanelSection
        title={t('utilities.tool.jwt.headerTitle')}
        description={t('utilities.tool.jwt.panelDescription')}
      >
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>{t('utilities.field.token')}</FieldLabel>
            {input.trim() ? (
              <JwtSignaturePill state={resolveSignatureState(input, 'unverified')} />
            ) : null}
          </div>
          <JwtColoredTokenArea
            ariaLabel={t('utilities.field.token')}
            testid="jwt-decode-token"
            value={input}
            onChange={setInput}
            signatureState={resolveSignatureState(input, 'unverified')}
          />
        </div>
        {analysis.errorKey ? <StatusMessage message={t(analysis.errorKey)} tone="error" /> : null}
      </PanelSection>

      <div className="grid content-start gap-4">
        <PanelSection
          title={t('utilities.tool.jwt.headerTitle')}
          description={t('utilities.tool.jwt.headerDescription')}
        >
          {analysis.header ? (
            <div className="grid gap-2">
              <JsonSyntaxOutput
                ariaLabel={t('utilities.tool.jwt.headerTitle')}
                testid="jwt-header-output"
                value={JSON.stringify(analysis.header, null, 2)}
              />
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
              <JsonSyntaxOutput
                ariaLabel={t('utilities.tool.jwt.payloadTitle')}
                testid="jwt-payload-output"
                value={JSON.stringify(analysis.payload, null, 2)}
              />
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
        {analysis.errorKey ? <StatusMessage message={t(analysis.errorKey)} tone="error" /> : null}
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
  const signatureState: JwtSignatureState =
    result === null ? 'unverified' : result.ok ? 'verified' : 'failed';
  const resetVerification = useCallback(() => setResult(null), []);
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
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-surface/60 px-3 py-2 text-body-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-50"
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
    <PanelSection
      title={t('utilities.tool.jwt.verify.resultTitle')}
      description={t('utilities.status.live')}
    >
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
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-surface/60 px-3 py-2 text-body-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-surface/80 disabled:opacity-50"
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

/**
 * A signature-less token resolves to `missing` no matter what the caller
 * knows about verification — you cannot verify what is not there.
 */
function resolveSignatureState(token: string, base: JwtSignatureState): JwtSignatureState {
  const parts = token.trim().split('.');
  const signature = parts.slice(2).join('.');
  return signature ? base : 'missing';
}

function JwtSignaturePill({ state }: { state: JwtSignatureState }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="jwt-signature-status"
      className={cn(
        'rounded-full border px-2 py-0.5 font-mono text-micro font-bold uppercase tracking-[0.14em]',
        signatureStatusClass(state)
      )}
    >
      {t(signatureStatusLabelKey(state))}
    </span>
  );
}

/**
 * The token characters, segment-colored: header (info), payload (accent),
 * signature (state-toned). Rendered inside the colored-input overlay so
 * the REAL input shows the colors — no duplicated preview block.
 */
function JwtTokenSpans({ token, signatureState }: { token: string; signatureState: JwtSignatureState }) {
  const parts = token.split('.');
  const header = parts[0] ?? '';
  const payload = parts[1] ?? '';
  const signature = parts.slice(2).join('.');
  return (
    <>
      <span data-testid="jwt-token-header" className="text-info">
        {header}
      </span>
      {parts.length > 1 ? <span className="text-fg-subtle">.</span> : null}
      <span data-testid="jwt-token-payload" className="text-accent-fg">
        {payload}
      </span>
      {parts.length > 2 ? <span className="text-fg-subtle">.</span> : null}
      <span data-testid="jwt-token-signature" className={signatureTextClass(signatureState)}>
        {signature}
      </span>
    </>
  );
}

function signatureTextClass(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
    case 'signed':
      return 'text-success';
    case 'failed':
      return 'text-danger';
    case 'missing':
    case 'unverified':
      return 'text-warning';
  }
}

/**
 * jwt.io-style colored token editor. The REAL textarea stays on top with
 * transparent text (caret, selection, and editing intact) while an
 * aria-hidden overlay underneath paints the same characters
 * segment-colored. Both layers copy the um-control metrics (1px border,
 * px-3 py-3, text-body-md, mono, break-anywhere) so wrap points line up,
 * and the overlay mirrors the textarea's scroll position. The overlay
 * carries the control background; the textarea keeps the visible border
 * and focus ring.
 */
function JwtColoredTokenArea({
  value,
  onChange,
  signatureState,
  testid,
  ariaLabel,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  signatureState: JwtSignatureState;
  testid: string;
  ariaLabel: string;
  readOnly?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const syncScroll = (target: HTMLTextAreaElement) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.scrollTop = target.scrollTop;
    overlay.scrollLeft = target.scrollLeft;
  };
  return (
    <div className="relative">
      <div
        ref={overlayRef}
        aria-hidden
        data-testid={`${testid}-overlay`}
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap rounded-xl border border-transparent bg-bg-inset/60 px-3 py-3 font-mono text-body-md [overflow-wrap:anywhere]"
      >
        {value ? <JwtTokenSpans token={value} signatureState={signatureState} /> : null}
      </div>
      <UtilityTextarea
        aria-label={ariaLabel}
        data-testid={testid}
        value={value}
        readOnly={readOnly}
        onChange={onChange ? event => onChange(event.target.value) : undefined}
        onScroll={event => syncScroll(event.currentTarget)}
        spellCheck={false}
        className="relative bg-transparent font-mono text-transparent [overflow-wrap:anywhere] selection:bg-accent/30 selection:text-fg-base"
        style={{ caretColor: 'var(--color-fg-base)' }}
      />
    </div>
  );
}

function signatureStatusClass(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
      return 'border-success/45 bg-success/10 text-success';
    case 'failed':
      return 'border-danger/45 bg-danger/10 text-danger';
    case 'signed':
      return 'border-success/45 bg-success/10 text-success';
    case 'missing':
      return 'border-border-subtle bg-bg-panel-alt/80 text-fg-muted';
    case 'unverified':
      return 'border-warning/45 bg-warning/10 text-warning';
  }
}

function signatureStatusLabelKey(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
      return 'utilities.jwtPreview.signature.verified';
    case 'failed':
      return 'utilities.jwtPreview.signature.failed';
    case 'signed':
      return 'utilities.jwtPreview.signature.signed';
    case 'missing':
      return 'utilities.jwtPreview.signature.missing';
    case 'unverified':
      return 'utilities.jwtPreview.signature.unverified';
  }
}
