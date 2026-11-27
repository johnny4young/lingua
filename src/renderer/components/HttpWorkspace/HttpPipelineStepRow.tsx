/** One HTTP pipeline step read as a run: status numeral, time bar, captures and the check it made. */

import { ArrowDown, ArrowUp, Check, Trash2, X } from 'lucide-react';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { referencedVariables, splitVariableTokens } from '../../../shared/httpEnvironment';
import type { HttpPipelineStepResult } from '../../../shared/httpPipeline';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { formatWholeDuration, latencyShare } from '../../utils/latencyScale';
import { DotLeader, ResultNumeral, TypeTag } from '../ui/answer';
import { MASKED_VALUE, SCOPE_TINTS, type HttpTint } from './httpScopeColors';
import { shownPath } from './httpPipelineReport';
import { transportFailureWord } from './httpStatus';
import { literalKind } from './httpTestLines';
import '../../i18n/httpBuilderCatalog';
import '../Answer/answerObject.css';
import '../ui/pipelineRun.css';

/** Tints as custom properties, so a dimmed step can override the colours they feed. */
const tintVars = (tint: HttpTint) => ({ '--pill-fg': tint.fg, '--pill-bg': tint.bg }) as CSSProperties;
const CHAIN_STYLE = tintVars(SCOPE_TINTS.chain);
const ENVIRONMENT_STYLE = tintVars(SCOPE_TINTS.environment);

/** A value one step captures and a later one uses is a chain value, tinted like a chain tag in the URL field. */
function VariableToken({ name, chained }: { name: string; chained: boolean }) {
  return (
    <span
      data-testid="http-pipeline-variable"
      data-chained={chained ? '' : undefined}
      className="pipeline-variable"
      style={chained ? CHAIN_STYLE : ENVIRONMENT_STYLE}
    >
      {`{{${name}}}`}
    </span>
  );
}

function ValuePill({ value, tone }: { value: string; tone?: 'error' }) {
  return (
    <span className="answer-object-value truncate" data-tone={tone ?? literalKind(value)} data-pill="" title={value}>
      {value}
    </span>
  );
}

/** Path pieces with a break opportunity before each token and each `/`, `?` or `&`, so a long path wraps there. */
function PathPieces({ path, token }: { path: string; token: (variable: string) => ReactNode }) {
  const pieces = splitVariableTokens(path).flatMap(piece =>
    piece.key === undefined ? piece.text.split(/(?=[/?&])/) : [token(piece.key)]
  );
  return pieces.map((piece, position) => (
    <Fragment key={position}>
      {position > 0 ? <wbr /> : null}
      {piece}
    </Fragment>
  ));
}

const listFormats = new Map<string, Intl.ListFormat>();

/** Interleaves nodes with the locale's list separators: `a and b`, `a, b y c`. */
function ListOf({ items, locale }: { items: readonly ReactNode[]; locale: string }) {
  let format = listFormats.get(locale);
  if (!format) listFormats.set(locale, (format = new Intl.ListFormat(locale, { type: 'conjunction' })));
  let next = 0;
  const parts = format.formatToParts(items.map(String));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part.type === 'element' ? items[next++] : part.value}</Fragment>
      ))}
    </>
  );
}

export interface HttpPipelineStepRowProps {
  readonly index: number;
  readonly count: number;
  readonly enabled: boolean;
  readonly request: HttpRequestV1 | undefined;
  readonly result: HttpPipelineStepResult | undefined;
  readonly running: boolean;
  /** Pipeline position of the step that stopped the run, for a step it never reached. */
  readonly stoppedAt: number | null;
  /** Slowest step of the run, so each bar reads against it. */
  readonly maxMs: number;
  readonly locked: boolean;
  /** Variables earlier steps of this pipeline capture. */
  readonly captured: ReadonlySet<string>;
  readonly onToggle: (enabled: boolean) => void;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onRemove: () => void;
}

export function HttpPipelineStepRow({
  index,
  count,
  enabled,
  request,
  result,
  running,
  stoppedAt,
  maxMs,
  locked,
  captured,
  onToggle,
  onMove,
  onRemove,
}: HttpPipelineStepRowProps) {
  const { t, i18n } = useTranslation();
  const report = result?.report;
  const failed = result?.status === 'failed';
  const skipped = result?.status === 'skipped';
  const path = request ? shownPath(request.url) : '';
  const name = request?.name.trim() ?? '';
  const status = result?.httpStatus ?? 0;
  const token = (variable: string) => <VariableToken key={variable} name={variable} chained={captured.has(variable)} />;

  let answer: ReactNode = null;
  // A sentence answering the row (not reached, or why it failed) may wrap; a numeral never does.
  let wraps = false;
  if (running) {
    answer = <span className="pipeline-step-running">{t('httpWorkspace.pipeline.running')}</span>;
  } else if (skipped) {
    wraps = true;
    answer = (
      <span className="pipeline-step-note">
        {stoppedAt !== null && result?.message === 'stopped-on-failure'
          ? t('httpWorkspace.pipeline.notReached', { index: stoppedAt })
          : t('httpWorkspace.pipeline.notReachedCancelled')}
      </span>
    );
  } else if (result) {
    // A transport failure has no status line, so the numeral slot names the failure.
    const word = transportFailureWord(result.responseKind);
    wraps = status === 0 && !word;
    answer = wraps ? (
      <span className="pipeline-step-note" data-tone="error">
        {t(`httpWorkspace.pipeline.message.${result.message ?? 'no-response'}`)}
      </span>
    ) : (
      <ResultNumeral
        size="md"
        word={status === 0}
        value={status > 0 ? status : t(`httpWorkspace.response.kind.${word}`)}
        unit={status > 0 ? report?.statusText.toLowerCase() || undefined : undefined}
        tone={failed ? 'error' : 'neutral'}
        data-testid="http-pipeline-step-numeral"
      />
    );
  }

  const check = report?.check;
  const captures = report?.captures ?? [];
  const sends = skipped && request ? referencedVariables(request).filter(variable => captured.has(variable)) : [];
  const hasDetail = Boolean(check || captures.length > 0 || report?.snapshotChanged || sends.length > 0);

  return (
    <li
      data-testid="http-pipeline-step"
      data-status={running ? 'running' : (result?.status ?? 'pending')}
      data-dim={!enabled || skipped ? '' : undefined}
      className="pipeline-step"
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={event => onToggle(event.target.checked)}
        disabled={locked}
        aria-label={t('httpWorkspace.pipeline.enableStep', { index: index + 1 })}
        className="pipeline-step-enable"
      />
      <span className="pipeline-step-numeral" aria-hidden>
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="pipeline-step-line">
          <span className="pipeline-method">{request?.method ?? ''}</span>
          <span className="pipeline-step-path" title={name ? `${name} · ${request?.url ?? ''}` : request?.url}>
            {path ? (
              <PathPieces path={path} token={token} />
            ) : (
              name || t('httpWorkspace.requestList.rename.placeholder')
            )}
          </span>
          {wraps ? null : <DotLeader className="pipeline-step-leader" />}
          <span className="pipeline-step-answer" data-wraps={wraps ? '' : undefined} aria-live={running ? 'polite' : undefined}>
            {wraps ? <DotLeader className="pipeline-step-leader" /> : null}
            {answer}
            {result ? <span className="sr-only">{t(`httpWorkspace.pipeline.status.${result.status}`)}</span> : null}
            {report ? (
              <>
                <span data-testid="http-pipeline-step-time" className="pipeline-step-time">
                  {formatWholeDuration(report.durationMs)}
                </span>
                <span aria-hidden className="pipeline-step-bar-track">
                  <span
                    data-testid="http-pipeline-step-bar"
                    className="pipeline-step-time-bar"
                    data-tone={failed ? 'error' : undefined}
                    style={{ width: `${latencyShare(report.durationMs, maxMs) * 100}%` }}
                  />
                </span>
              </>
            ) : null}
          </span>
        </div>
        {hasDetail ? (
          <div className="pipeline-step-detail answer-scope">
            {check ? (
              <span data-testid="http-pipeline-step-check" data-pass={check.pass} className="pipeline-step-check">
                {check.pass ? (
                  <Check size={12} aria-hidden className="shrink-0 text-value-string" />
                ) : (
                  <X size={12} aria-hidden className="shrink-0 text-value-error" />
                )}
                <span className={check.pass ? 'pipeline-step-expression' : 'pipeline-step-expression text-fg-base'}>{check.expression}</span>
                {!check.pass && check.received !== undefined ? (
                  <span className="pipeline-step-received">
                    <TypeTag className="text-value-error">{t('httpWorkspace.pipeline.received')}</TypeTag>
                    <ValuePill value={check.received} tone="error" />
                  </span>
                ) : null}
                {check.count > 1 ? (
                  <span className="text-fg-subtle">{t('httpWorkspace.pipeline.moreChecks', { count: check.count - 1 })}</span>
                ) : null}
              </span>
            ) : null}
            {report?.snapshotChanged ? <span className="text-value-error">{t('httpWorkspace.pipeline.snapshotChanged')}</span> : null}
            {captures.map((capture, position) => (
              <span key={position} data-testid="http-pipeline-step-capture" className="flex min-w-0 items-center gap-2 font-mono">
                <TypeTag>{t('httpWorkspace.pipeline.captures')}</TypeTag>
                <VariableToken name={capture.variable} chained />
                <span className="pipeline-step-from">← {capture.from}</span>
                <ValuePill value={capture.value ?? MASKED_VALUE} />
              </span>
            ))}
            {sends.length > 0 ? (
              <span className="pipeline-step-dim">
                {t('httpWorkspace.pipeline.wouldSend')} <ListOf items={sends.map(token)} locale={i18n.language} />
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Overlaid so the editing controls never take width from the answer. */}
      <span className="pipeline-step-actions">
        <button
          type="button"
          disabled={index === 0 || locked}
          onClick={() => onMove(-1)}
          aria-label={t('httpWorkspace.pipeline.moveUp')}
          className="pipeline-step-action focus-ring"
        >
          <ArrowUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={index === count - 1 || locked}
          onClick={() => onMove(1)}
          aria-label={t('httpWorkspace.pipeline.moveDown')}
          className="pipeline-step-action focus-ring"
        >
          <ArrowDown size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={onRemove}
          aria-label={t('httpWorkspace.pipeline.removeStep')}
          className="pipeline-step-action focus-ring"
          data-tone="danger"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
