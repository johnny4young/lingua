import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ResultHeader, type ResultHeaderTab } from '../ui/ResultHeader';
import { DotLeader, TypeTag } from '../ui/answer';
import type { PhaseBarSegment } from '../ui/PhaseBar';
import { formatNumber } from '../../i18n/formatNumber';
import { countAnswer, countChars, invalidAnswer, isOneOf, type ToolAnswer } from './toolAnswers';
import '../../i18n/toolAnswersCatalog';
import '../Answer/answerObject.css';
import './toolAnswers.css';

interface ToolResultHeaderProps {
  /** The tool's type tag (JWT, HASH): code vocabulary, never translated. */
  tag: string;
  answer: ToolAnswer | null;
  meta?: string;
  /** Proportional parts under the meta, e.g. a token's segments by size. */
  segments?: { parts: ReadonlyArray<PhaseBarSegment>; label: string; testId: string };
  tabs?: ReadonlyArray<ResultHeaderTab>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  testId: string;
}

/** The result header every tool panel opens with: tag, one numeral, one meta line, the mode segment. */
export function ToolResultHeader({ tag, answer, meta, segments, tabs, activeTab, onTabChange, testId }: ToolResultHeaderProps) {
  return (
    <div className="tool-answer-header" data-testid={testId}>
      <ResultHeader
        tag={tag}
        numeral={answer ?? undefined}
        meta={meta}
        phases={segments ? { segments: segments.parts, label: segments.label, testId: segments.testId, hideLabel: true } : undefined}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />
    </div>
  );
}

const TRANSFORM_MODES = ['encode', 'decode'] as const;
type TransformMode = (typeof TRANSFORM_MODES)[number];

/** An encode/decode tool's header: characters out, characters in, and the mode segment. */
export function TransformResultHeader({
  tag,
  testIdPrefix,
  input,
  output,
  errorKey,
  mode,
  onModeChange,
}: {
  tag: string;
  testIdPrefix: string;
  input: string;
  output: string;
  errorKey: string | null;
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const inputChars = countChars(input);
  return (
    <ToolResultHeader
      testId={`${testIdPrefix}-result-header`}
      tag={tag}
      answer={errorKey ? invalidAnswer(t) : input ? countAnswer(countChars(output), 'utilities.answer.chars', t, locale) : null}
      meta={input ? t('utilities.answer.charsIn', { count: inputChars, chars: formatNumber(inputChars, locale) }) : undefined}
      tabs={TRANSFORM_MODES.map(id => ({ id, label: t(`utilities.actions.${id}`), testId: `${testIdPrefix}-mode-${id}` }))}
      activeTab={mode}
      onTabChange={id => {
        if (isOneOf(TRANSFORM_MODES, id)) onModeChange(id);
      }}
    />
  );
}

/** A section opens with its tag; a colour square ties it to a segment of the header bar. */
export function ToolSection({
  label,
  swatch,
  trailing,
  columnWidth,
  children,
  testId,
}: {
  label: string;
  swatch?: string;
  trailing?: ReactNode;
  /** Width of the rows' type-and-value column, so values line up down the section; `auto` fits each value. */
  columnWidth?: number | 'auto';
  children: ReactNode;
  testId?: string;
}) {
  const style =
    columnWidth === undefined
      ? undefined
      : ({ '--tool-leaf-width': columnWidth === 'auto' ? 'auto' : `${columnWidth}px` } as CSSProperties);
  return (
    <section className="tool-answer-section answer-scope" data-testid={testId} style={style}>
      <div className="tool-answer-section-head">
        <TypeTag>
          {swatch ? <span aria-hidden className="tool-answer-swatch" style={{ background: swatch }} /> : null}
          {label}
        </TypeTag>
        {trailing}
      </div>
      {children}
    </section>
  );
}

/** Key, dot leader, then type and value in a column every row of the section shares. */
export function ToolLeafRow({
  label,
  type,
  children,
  testId,
  state,
}: {
  label: ReactNode;
  type?: string;
  children: ReactNode;
  testId?: string;
  state?: string;
}) {
  return (
    <div className="tool-leaf-row" data-testid={testId} data-state={state}>
      <span className="tool-leaf-key">{label}</span>
      <DotLeader className="tool-leaf-leader" />
      <span className="tool-leaf-answer">
        {type ? <TypeTag className="tool-leaf-type">{type}</TypeTag> : null}
        {children}
      </span>
    </div>
  );
}
