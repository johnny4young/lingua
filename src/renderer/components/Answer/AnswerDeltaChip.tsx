import { useTranslation } from 'react-i18next';
import { replaceUnsafeText } from '../../utils/unsafeText';
import type { AnswerDelta } from './answerDelta';
import { cn } from '../../utils/cn';
import '../../i18n/answersCatalog';
import './answerObject.css';

/** The old value struck through and how the answer moved since run `since`. */
export function AnswerDeltaChip({ delta, since }: { readonly delta: AnswerDelta; readonly since: number }) {
  const { t } = useTranslation();
  const { change } = delta;
  const was = (value: string) => (
    <s className="answer-delta-before">
      <span className="sr-only">{`${t('answers.delta.was')} `}</span>
      {replaceUnsafeText(value)}
    </s>
  );
  const step = (up: boolean, by: string) => (
    <>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span className="sr-only">{t(up ? 'answers.delta.up' : 'answers.delta.down')}</span>
      {` ${by}`}
    </>
  );
  return (
    <span className="answer-delta" data-testid="answer-delta" data-kind={change.kind}>
      <span className="sr-only">{`${t('answers.delta.label', { number: since })}: `}</span>
      {change.kind === 'number' ? (
        <>
          {was(change.before)} {step(change.up, change.by)}
        </>
      ) : change.kind === 'key' ? (
        <>
          {`${replaceUnsafeText(change.key)} `}
          {step(change.up, change.by)}
        </>
      ) : change.kind === 'item' ? (
        <>
          {`${replaceUnsafeText(change.at)} `}
          {was(change.before)}
          {` → ${replaceUnsafeText(change.after)}`}
        </>
      ) : change.kind === 'size' ? (
        <>
          {was(t('answers.delta.items', { count: change.before }))}
          {` → ${t('answers.delta.items', { count: change.after })}`}
        </>
      ) : (
        was(change.before)
      )}
      {delta.edited ? ` · ${t('answers.delta.edited')}` : null}
    </span>
  );
}

/** A value the answer replaced, struck through; long values end in an ellipsis and keep the full text as a tooltip. */
export function AnswerWasChip({ value, className }: { readonly value: string; readonly className?: string }) {
  const { t } = useTranslation();
  const text = replaceUnsafeText(value);
  return (
    <span className={cn('answer-delta answer-was', className)} data-testid="answer-was" title={text}>
      <s className="answer-delta-before">
        <span className="sr-only">{`${t('answers.delta.was')} `}</span>
        {text}
      </s>
    </span>
  );
}
