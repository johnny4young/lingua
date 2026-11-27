import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRunDuration } from '../../utils/timeLabels';
import { replaceUnsafeText } from '../../utils/unsafeText';
import {
  readAnswer,
  type AnswerInput,
  type AnswerModel,
  type AnswerPicture,
  type LoopAnswer,
  type RunningAnswer,
} from './answerObjectModel';
import { useAnswerContext } from './useAnswerContext';
import '../../i18n/answersCatalog';
import '../ui/identity.css';
import './answerObject.css';

const BAR_WIDTH = 4;
const BAR_GAP = 2;
const BAR_HEIGHT = 16;
const SPARK_WIDTH = 170;
const SPARK_HEIGHT = 18;
const SCALE_WIDTH = 44;

interface AnswerChrome {
  /** Values only, no picture: several answers sharing one row. */
  readonly compact?: boolean;
  readonly hideTag?: boolean;
  /** One line: the text ends in an ellipsis instead of wrapping. */
  readonly oneLine?: boolean;
  /** Muted text with no colour by type, for values that are not the current answer. */
  readonly muted?: boolean;
  readonly 'data-testid'?: string;
}

export interface AnswerObjectProps extends AnswerInput, AnswerChrome {}

/** One answer: its type tag, its value coloured by type, and its picture. */
export const AnswerObject = memo(function AnswerObject({ text, payload, role, language, source, length, ...chrome }: AnswerObjectProps) {
  const { now, locale } = useAnswerContext();
  const model = useMemo(
    () => cachedAnswer({ text, payload, role, language, source, length }, now, locale),
    [text, payload, role, language, source, length, now, locale]
  );
  return <AnswerObjectView model={model} {...chrome} />;
});

const CACHE_SIZE = 256;
const answerCache = new Map<string, AnswerModel>();

/**
 * Every run remounts the editor's answers, so printed answers are read once per
 * text. Payload, text and date answers skip the cache: a payload is an object,
 * text is cheaper to read than to key, and a date's relative time moves.
 */
function cachedAnswer(input: AnswerInput, now: number, locale: string): AnswerModel {
  if (input.payload || input.role === 'text') return readAnswer(input, { now, locale });
  const key = `${input.role ?? ''}\u0000${input.language ?? ''}\u0000${locale}\u0000${input.source ?? ''}\u0000${input.length ?? ''}\u0000${input.text}`;
  const hit = answerCache.get(key);
  if (hit) return hit;
  const model = readAnswer(input, { now, locale });
  if (model.kind === 'date') return model;
  if (answerCache.size >= CACHE_SIZE) answerCache.delete(answerCache.keys().next().value!);
  answerCache.set(key, model);
  return model;
}

interface AnswerObjectViewProps extends AnswerChrome {
  readonly model: AnswerModel;
}

/** Draws an answer already read. */
function AnswerObjectView({ model, compact = false, hideTag = false, oneLine = false, muted = false, 'data-testid': testId }: AnswerObjectViewProps) {
  const { t } = useTranslation();
  const picture = compact ? undefined : model.picture;
  const value = replaceUnsafeText(compact && !model.value ? model.summary : model.value);
  const valueNode = value ? (
    <span
      className="answer-object-value"
      data-tone={model.tone}
      data-pill={model.pill ? '' : undefined}
      title={replaceUnsafeText(model.summary)}
      data-testid="answer-object-value"
    >
      {value}
    </span>
  ) : null;
  const leadsWithPicture = picture && (picture.kind === 'bars' || picture.kind === 'spark' || picture.kind === 'progress');
  return (
    <span
      className="answer-object"
      data-kind={model.kind}
      data-tone={model.tone}
      data-picture={picture?.kind}
      data-one-line={oneLine || undefined}
      data-muted={muted || undefined}
      data-testid={testId ?? 'answer-object'}
    >
      {hideTag || !model.tag ? null : (
        <span className="type-tag answer-object-tag">
          {model.tag}
        </span>
      )}
      {leadsWithPicture ? <Picture picture={picture} /> : null}
      {valueNode}
      {picture && !leadsWithPicture ? <Picture picture={picture} /> : null}
      {model.fold > 0 ? (
        <span className="answer-object-fold" data-testid="answer-object-fold">
          {t('answers.fold', { count: model.fold })}
        </span>
      ) : null}
    </span>
  );
}

function Picture({ picture }: { readonly picture: AnswerPicture }) {
  const { t } = useTranslation();
  switch (picture.kind) {
    case 'bars': {
      const width = picture.heights.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
      return (
        <svg className="answer-object-bars" width={width} height={BAR_HEIGHT} viewBox={`0 0 ${width} ${BAR_HEIGHT}`} aria-hidden data-testid="answer-picture-bars">
          {picture.heights.map((height, index) => {
            const h = (height / 100) * BAR_HEIGHT;
            return <rect key={index} x={index * (BAR_WIDTH + BAR_GAP)} y={BAR_HEIGHT - h} width={BAR_WIDTH} height={h} rx={1} />;
          })}
        </svg>
      );
    }
    case 'spark': {
      const last = picture.points.length - 1;
      const at = (index: number) => 1 + (index / Math.max(1, last)) * (SPARK_WIDTH - 2);
      const y = (point: number) => SPARK_HEIGHT - 2 - point * (SPARK_HEIGHT - 4);
      const line = picture.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${at(index).toFixed(1)} ${y(point).toFixed(1)}`).join('');
      return (
        <svg className="answer-object-spark" width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} aria-hidden data-testid="answer-picture-spark">
          <path d={`${line}L${at(last).toFixed(1)} ${SPARK_HEIGHT}L1 ${SPARK_HEIGHT}Z`} className="answer-object-spark-area" />
          <path d={line} className="answer-object-spark-line" />
          <circle cx={at(last)} cy={y(picture.points[last] ?? 0)} r={2.2} />
        </svg>
      );
    }
    case 'scale':
      return (
        <span className="answer-object-scale" data-testid="answer-picture-scale">
          {picture.entries.map((entry, index) => (
            <span key={index} className="answer-object-kv">
              <span className="answer-object-key">{replaceUnsafeText(entry.label)}</span>
              <span className="answer-object-hbar" aria-hidden style={{ width: Math.max(2, (entry.width / 100) * SCALE_WIDTH) }} />
              <span className="answer-object-value" data-tone="number">
                {entry.value}
              </span>
            </span>
          ))}
          <More count={picture.more} />
        </span>
      );
    case 'keys':
      return (
        <span className="answer-object-keys" data-testid="answer-picture-keys">
          {picture.keys.map((key, index) => (
            <span key={index} className="answer-object-value" data-tone="string" data-pill="">
              {`"${replaceUnsafeText(key)}"`}
            </span>
          ))}
          <More count={picture.more} />
          {picture.each ? <span className="answer-object-note">{t('answers.each', { tag: picture.each })}</span> : null}
        </span>
      );
    case 'colours':
      return (
        <span className="answer-object-keys" data-testid="answer-picture-colours">
          {picture.chips.map((chip, index) => (
            <span key={`${chip.label ?? ''}${index}`} className="answer-object-chip" title={chip.label}>
              <span className="answer-object-swatch" aria-hidden style={{ background: chip.css }} />
              {chip.text}
            </span>
          ))}
          <More count={picture.more} />
        </span>
      );
    case 'table':
      return (
        <span className="answer-object-table" data-testid="answer-picture-table">
          <table>
            <thead>
              <tr>
                <th aria-hidden />
                {picture.columns.map(column => (
                  <th key={column}>{replaceUnsafeText(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {picture.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="answer-object-index">{rowIndex}</td>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} data-tone={cell.tone}>
                      {cell.bar === undefined ? (
                        <span className="answer-object-value" data-tone={cell.tone} data-pill={cell.tone === 'boolean' || cell.tone === 'none' ? '' : undefined}>
                          {replaceUnsafeText(cell.text)}
                        </span>
                      ) : (
                        <span className="answer-object-cellbar">
                          <span className="answer-object-value" data-tone={cell.tone}>
                            {cell.text}
                          </span>
                          <span className="answer-object-track" aria-hidden>
                            <i style={{ width: `${cell.bar}%` }} />
                          </span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {picture.more > 0 ? <span className="answer-object-note">{t('answers.moreRows', { count: picture.more })}</span> : null}
        </span>
      );
    case 'gauge':
      return (
        <>
          <span className="answer-object-gauge" aria-hidden data-over={picture.over ? '' : undefined} data-testid="answer-picture-gauge">
            <i style={{ width: `${Math.min(picture.fill, picture.mark)}%` }} />
            {picture.over ? <i data-over="" style={{ left: `${picture.mark}%`, width: `${picture.fill - picture.mark}%` }} /> : null}
            <b style={{ left: `${picture.mark}%` }} />
          </span>
          <span className="answer-object-note">{t(picture.over ? 'answers.over' : 'answers.under', { threshold: picture.threshold })}</span>
        </>
      );
    case 'relative':
      return <span className="answer-object-note" data-testid="answer-picture-relative">{picture.text}</span>;
    case 'progress':
      return (
        <span className="answer-object-gauge" aria-hidden data-testid="answer-picture-progress">
          <i style={{ width: `${picture.fill}%` }} />
        </span>
      );
  }
}

function More({ count }: { readonly count: number }) {
  return count > 0 ? <span className="answer-object-note">+{count}</span> : null;
}

/** A line still running: the pulse stands in for its value. */
export function RunningAnswerObject({ elapsedMs }: RunningAnswer) {
  const { t } = useTranslation();
  return (
    <span className="answer-object" data-kind="running" data-tone="pulse" data-testid="answer-object">
      <span className="type-tag answer-object-tag">
        {t('answers.running')}
      </span>
      <svg className="answer-object-pulse" width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} aria-hidden>
        <path d="M0 9h46l5-6 6 12 5-9 4 3h30l5-6 6 12 5-9 4 3h30l5-6 6 12" />
        <circle cx={163} cy={15} r={2.4} />
      </svg>
      {elapsedMs === undefined ? null : (
        <>
          <span className="answer-object-value" data-tone="pulse">
            {formatRunDuration(elapsedMs)}
          </span>
          <span className="answer-object-note">{t('answers.onThisLine')}</span>
        </>
      )}
    </span>
  );
}

const MAX_LOOP_DOTS = 5;

/** A loop header: which pass it is on, and the loop variable on that pass. */
export function LoopAnswerObject({ iteration, total, binding }: LoopAnswer) {
  const { t } = useTranslation();
  const dots = Math.min(total, MAX_LOOP_DOTS);
  const current = Math.min(iteration, dots);
  return (
    <span className="answer-object" data-kind="loop" data-tone="plain" data-testid="answer-object">
      <span className="type-tag answer-object-tag">{t('answers.loop')}</span>
      <span className="answer-object-dots" aria-hidden>
        {Array.from({ length: dots }, (_, index) => (
          <i key={index} data-state={index + 1 < current ? 'done' : index + 1 === current ? 'live' : undefined} />
        ))}
      </span>
      <span className="answer-object-loop">{t('answers.pass', { iteration, total })}</span>
      {binding ? (
        <>
          <span className="answer-object-note">{`${replaceUnsafeText(binding.name)} =`}</span>
          <AnswerObjectView model={binding.value} hideTag compact data-testid="answer-object-binding" />
        </>
      ) : null}
    </span>
  );
}
