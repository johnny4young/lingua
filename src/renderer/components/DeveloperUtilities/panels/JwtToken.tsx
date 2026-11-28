import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import { UtilityTextarea } from '../panelPrimitives';
import {
  JWT_HEADER_COLOR,
  JWT_PAYLOAD_COLOR,
  jwtSignatureColor,
  signatureStatusLabelKey,
  type JwtSignatureState,
} from './jwtSegments';

export function JwtSignaturePill({ state }: { state: JwtSignatureState }) {
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

function signatureStatusClass(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
    case 'signed':
      return 'border-success/45 bg-success/10 text-success';
    case 'failed':
      return 'border-danger/45 bg-danger/10 text-danger';
    case 'missing':
      return 'border-border-subtle bg-bg-panel-alt/80 text-fg-muted';
    case 'unverified':
      return 'border-warning/45 bg-warning/10 text-warning';
  }
}

/** The token characters, coloured by segment like the bar in the result header. */
function JwtTokenSpans({ token, signatureState }: { token: string; signatureState: JwtSignatureState }) {
  const parts = token.split('.');
  const header = parts[0] ?? '';
  const payload = parts[1] ?? '';
  const signature = parts.slice(2).join('.');
  return (
    <>
      <span data-testid="jwt-token-header" style={{ color: JWT_HEADER_COLOR }}>
        {header}
      </span>
      {parts.length > 1 ? <span className="text-fg-subtle">.</span> : null}
      <span data-testid="jwt-token-payload" style={{ color: JWT_PAYLOAD_COLOR }}>
        {payload}
      </span>
      {parts.length > 2 ? <span className="text-fg-subtle">.</span> : null}
      <span data-testid="jwt-token-signature" style={{ color: jwtSignatureColor(signatureState) }}>
        {signature}
      </span>
    </>
  );
}

/**
 * The real textarea stays on top with transparent text (caret, selection and
 * editing intact) while an aria-hidden overlay underneath paints the same
 * characters by segment. Both layers share the um-control metrics so wrap
 * points line up, and the overlay mirrors the textarea's scroll.
 */
export function JwtColoredTokenArea({
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
    <div className="jwt-token-field relative">
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
