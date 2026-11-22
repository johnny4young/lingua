import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotebookCellLanguage, NotebookLineAnswerV1 } from '../../../shared/notebook';
import type { RichOutputTable } from '../../../shared/richOutput';
import { replaceUnsafeText } from '../../utils/unsafeText';
import { answerGrid, answerTag, answerTone, numericSeries } from './notebookAnswerView';
import '../../i18n/notebookCatalog';
import './notebookAnswers.css';

/** Top of the first code line beside the code box: its 1px border plus 8px padding. */
const NOTEBOOK_CODE_INSET = 9;

export interface NotebookCellAnswersProps {
  /** One answer per line, sorted by line. */
  readonly rows: ReadonlyArray<NotebookLineAnswerV1>;
  readonly lineCount: number;
  readonly lineHeight: number;
  readonly language: NotebookCellLanguage;
  readonly cellIndex: number;
  /** The run is older than a change above it; answers read as dated. */
  readonly stale: boolean;
  /** A query's result set, drawn beside the cell instead of summarized. */
  readonly table: RichOutputTable | null;
}

/** The answer column: what each line answered, on that line. */
export const NotebookCellAnswers = memo(function NotebookCellAnswers({
  rows,
  lineCount,
  lineHeight,
  language,
  cellIndex,
  stale,
  table,
}: NotebookCellAnswersProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('notebookAnswers.region', { index: cellIndex + 1 })}
      data-testid="notebook-cell-answers"
      data-stale={stale ? 'true' : undefined}
      className="notebook-answers"
      style={{
        ['--notebook-line-height' as string]: `${lineHeight}px`,
        paddingTop: NOTEBOOK_CODE_INSET,
        gridTemplateRows: `repeat(${Math.max(1, lineCount)}, ${lineHeight}px) auto`,
      }}
    >
      {rows.map((answer) => {
        const spansTable = answer.kind === 'result' && table !== null;
        return (
          <div
            key={`${answer.line}:${answer.kind}`}
            data-testid="notebook-cell-answer"
            data-line={answer.line}
            data-kind={answer.kind}
            className="notebook-answer"
            style={{
              gridRow: spansTable ? `${answer.line} / -1` : answer.line,
              ...(spansTable ? {} : { height: lineHeight }),
            }}
          >
            <span className="notebook-answer-tag" data-tone={answer.kind === 'error' ? 'error' : undefined}>
              {answerTag(answer, language)}
            </span>
            {spansTable ? <AnswerTable table={table} /> : <AnswerValue answer={answer} />}
          </div>
        );
      })}
    </div>
  );
});

function AnswerValue({ answer }: { readonly answer: NotebookLineAnswerV1 }) {
  const { t } = useTranslation();
  const text = replaceUnsafeText(answer.text);
  if (answer.kind === 'table' || answer.kind === 'result') {
    return (
      <>
        {text ? (
          <span className="notebook-answer-name" title={text}>
            {text}
          </span>
        ) : null}
        {answer.rows !== undefined ? (
          <>
            <span className="notebook-answer-pill" data-tone="number">
              {answer.rows}
            </span>
            <span className="notebook-answer-text">{t('notebookAnswers.rows', { count: answer.rows })}</span>
          </>
        ) : null}
        {answer.columns !== undefined ? (
          <span className="notebook-answer-text">
            {answer.rows !== undefined ? '× ' : null}
            {t('notebookAnswers.columns', { count: answer.columns })}
          </span>
        ) : null}
      </>
    );
  }
  const series = numericSeries(answer);
  if (series) {
    return (
      <>
        <span className="notebook-answer-bars" aria-hidden="true">
          {series.bars.map((height, index) => (
            <i key={index} style={{ height: `${Math.round(height)}%` }} />
          ))}
        </span>
        <span className="notebook-answer-value" data-tone="number" title={text}>
          {series.range}
        </span>
      </>
    );
  }
  const tone = answerTone(answer);
  if (tone === 'text') {
    return (
      <span className="notebook-answer-text" data-kind={answer.kind} title={text}>
        {text}
      </span>
    );
  }
  return (
    <span className="notebook-answer-pill" data-tone={tone} title={text}>
      {text}
    </span>
  );
}

function AnswerTable({ table }: { readonly table: RichOutputTable }) {
  const grid = useMemo(() => answerGrid(table.columns, table.rows), [table]);
  return (
    <div className="notebook-answer-table" data-testid="notebook-cell-answer-table">
      <table>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="notebook-answer-table-index">{rowIndex + 1}</td>
              {row.map((cell, columnIndex) => {
                const text = replaceUnsafeText(cell.text);
                return (
                  <td key={table.columns[columnIndex]} data-numeric={cell.numeric ? 'true' : undefined}>
                    {columnIndex === grid.barColumn ? (
                      <span className="notebook-answer-cellbar">
                        <span>{text}</span>
                        <span className="notebook-answer-track" aria-hidden="true">
                          <i style={{ width: `${grid.barWidths[rowIndex]}%` }} />
                        </span>
                      </span>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
