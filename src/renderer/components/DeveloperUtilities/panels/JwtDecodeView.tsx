import { useTranslation } from 'react-i18next';
import { inspectTimestampLike } from '../../../utils/developerUtilities';
import { formatRelativeTime } from '../../../utils/timeLabels';
import { CopyButton } from '../CopyButton';
import { StatusMessage, TimestampHoverValue } from '../panelPrimitives';
import { ToolLeafRow, ToolSection } from '../ToolAnswerParts';
import { formatNumber } from '../../../i18n/formatNumber';
import { claimTime, countChars } from '../toolAnswers';
import { JwtColoredTokenArea } from './JwtToken';
import {
  JWT_HEADER_COLOR,
  JWT_PAYLOAD_COLOR,
  jwtSignatureColor,
  signatureStatusLabelKey,
  type JwtSegmentBytes,
  type JwtSignatureState,
} from './jwtSegments';
import type { JwtAnalysis } from '../../../utils/jwt';

const HEADER_VALUE_WIDTH = 150;
const PAYLOAD_VALUE_WIDTH = 392;
const TIME_CLAIMS = new Set(['iat', 'nbf', 'exp']);

const dateFormats = new Map<string, [day: Intl.DateTimeFormat, clock: Intl.DateTimeFormat]>();

/** `Nov 11 · 12:02`: the day and the local clock, as the date pill on the board reads (no weekday). */
function claimDateText(at: number, locale: string): string {
  let formats = dateFormats.get(locale);
  if (!formats) {
    formats = [
      new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    ];
    dateFormats.set(locale, formats);
  }
  const date = new Date(at);
  return `${formats[0].format(date)} · ${formats[1].format(date)}`;
}

export function JwtDecodeView({
  input,
  setInput,
  analysis,
  now,
  bytes,
  signatureState,
}: {
  input: string;
  setInput: (value: string) => void;
  analysis: JwtAnalysis;
  now: number;
  bytes: JwtSegmentBytes;
  signatureState: JwtSignatureState;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { header, payload } = analysis;

  return (
    <div className="jwt-decode-wrap">
      <div className="jwt-decode">
        <ToolSection label={t('utilities.answer.jwt.token', { count: formatNumber(countChars(input.trim()), locale) })}>
          <JwtColoredTokenArea
            ariaLabel={t('utilities.field.token')}
            testid="jwt-decode-token"
            value={input}
            onChange={setInput}
            signatureState={signatureState}
          />
          {analysis.errorKey ? <StatusMessage className="mt-2" message={t(analysis.errorKey)} tone="error" /> : null}
        </ToolSection>
        {header && payload ? (
          <>
            <div className="jwt-decode-parts">
              <ToolSection
                testId="jwt-header-output"
                label={t('utilities.answer.jwt.header', { count: formatNumber(bytes.header, locale) })}
                swatch={JWT_HEADER_COLOR}
                columnWidth={HEADER_VALUE_WIDTH}
                trailing={<CopyButton value={() => JSON.stringify(header, null, 2)} testid="jwt-header-copy" />}
              >
                {Object.entries(header).map(([key, value]) => (
                  <JwtClaimRow key={key} name={key} value={value} />
                ))}
              </ToolSection>
              <ToolSection
                label={t('utilities.answer.jwt.signature', { count: formatNumber(bytes.signature, locale) })}
                swatch={jwtSignatureColor(signatureState)}
                columnWidth="auto"
              >
                <ToolLeafRow label={typeof header.alg === 'string' ? header.alg : '—'}>
                  <span data-testid="jwt-signature-status" className="tool-leaf-note" style={{ color: jwtSignatureColor(signatureState) }}>
                    {t(signatureStatusLabelKey(signatureState))}
                  </span>
                </ToolLeafRow>
              </ToolSection>
            </div>
            <ToolSection
              testId="jwt-payload-output"
              label={t('utilities.answer.jwt.payload', { count: formatNumber(bytes.payload, locale) })}
              swatch={JWT_PAYLOAD_COLOR}
              columnWidth={PAYLOAD_VALUE_WIDTH}
              trailing={<CopyButton value={() => JSON.stringify(payload, null, 2)} testid="jwt-payload-copy" />}
            >
              {Object.entries(payload).map(([key, value]) =>
                TIME_CLAIMS.has(key) && claimTime(value) !== null ? (
                  <JwtTimeClaimRow key={key} claim={key} seconds={value as number} payload={payload} now={now} />
                ) : (
                  <JwtClaimRow key={key} name={key} value={value} />
                )
              )}
            </ToolSection>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** JSON vocabulary for a claim's type, with the size of a container. */
function claimType(value: unknown): { type: string; tone: string | null } {
  if (value === null) return { type: 'null', tone: 'none' };
  if (Array.isArray(value)) return { type: `array·${value.length}`, tone: null };
  switch (typeof value) {
    case 'string':
      return { type: 'string', tone: 'string' };
    case 'number':
      return { type: 'number', tone: 'number' };
    case 'boolean':
      return { type: 'boolean', tone: 'boolean' };
    default:
      return { type: `object·${Object.keys(value as object).length}`, tone: null };
  }
}

function JwtClaimRow({ name, value }: { name: string; value: unknown }) {
  const { type, tone } = claimType(value);
  const text = JSON.stringify(value) ?? String(value);
  return (
    <ToolLeafRow label={name} type={type} testId={`jwt-claim-${name}`}>
      {tone ? (
        <span className="answer-object-value" data-tone={tone} data-pill="" title={text}>
          {text}
        </span>
      ) : (
        <span className="tool-leaf-text" title={text}>
          {text}
        </span>
      )}
    </ToolLeafRow>
  );
}

/** iat, nbf and exp: the raw seconds, the date, then how far from now, or for exp the token's lifetime. */
function JwtTimeClaimRow({
  claim,
  seconds,
  payload,
  now,
}: {
  claim: string;
  seconds: number;
  payload: Record<string, unknown>;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const at = seconds * 1000;
  const expired = claim === 'exp' && at <= now;
  const pending = claim === 'nbf' && at > now;
  const hover = inspectTimestampLike(seconds, claim);
  const issuedAt = claimTime(payload.iat);
  const raw = String(seconds);
  return (
    <ToolLeafRow label={claim} type="date" testId={`jwt-time-claim-${claim}`} state={expired ? 'expired' : pending ? 'pending' : 'ok'}>
      {hover ? <TimestampHoverValue value={raw} timestamp={hover} variant="quiet" className="tool-leaf-raw" /> : <span className="tool-leaf-raw">{raw}</span>}
      <span
        className="answer-object-value"
        data-tone={expired ? 'error' : 'date'}
        data-pill=""
        title={expired ? t('utilities.tool.jwt.claim.expired') : pending ? t('utilities.tool.jwt.claim.notYetValid') : undefined}
      >
        {claimDateText(at, i18n.language)}
      </span>
      {claim === 'exp' ? (
        issuedAt !== null && issuedAt < at ? <JwtLifetime issuedAt={issuedAt} expiresAt={at} now={now} /> : null
      ) : (
        <span className="tool-leaf-note" data-testid={`jwt-time-claim-${claim}-relative`}>
          {pending
            ? `${t('utilities.tool.jwt.claim.notYetValid')} · ${formatRelativeTime(at, now, i18n.language)}`
            : formatRelativeTime(at, now, i18n.language)}
        </span>
      )}
    </ToolLeafRow>
  );
}

/** Issued at the left edge, expiry at the right, a mark where now falls. */
function JwtLifetime({ issuedAt, expiresAt, now }: { issuedAt: number; expiresAt: number; now: number }) {
  const { t } = useTranslation();
  const used = Math.min(1, Math.max(0, (now - issuedAt) / (expiresAt - issuedAt)));
  const percent = `${(used * 100).toFixed(1)}%`;
  const label = t('utilities.answer.jwt.lifetime', { elapsed: Math.round(used * 100) });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="tool-lifetime"
      data-testid="jwt-lifetime"
      data-state={now >= expiresAt ? 'expired' : undefined}
    >
      <span className="tool-lifetime-used" style={{ width: percent }} />
      <span className="tool-lifetime-now" style={{ left: percent }} />
    </span>
  );
}
