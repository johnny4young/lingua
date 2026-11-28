import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotebookCellLanguage, NotebookLineAnswerV1 } from '../../../shared/notebook';
import type { RichOutputTable } from '../../../shared/richOutput';
import { replaceUnsafeText } from '../../utils/unsafeText';
import { AnswerObject } from '../Answer/AnswerObject';
import { TypeTag } from '../ui/answer';
import { answerGrid, cutCollectionTag, notebookAnswerInput } from './notebookAnswerView';
import '../../i18n/notebookCatalog';
import './notebookAnswers.css';

/** Top of the first code line beside the code box: its 1px border plus 8px padding. */
const NOTEBOOK_CODE_INSET = 9;
/** Type tags are code vocabulary, like the answer renderer's, and stay untranslated. */
const TABLE_TAG = 'table';
const ROWS_TAG = 'rows';

export interface NotebookCellAnswersProps {
  /** One answer per line, sorted by line. */
  readonly rows: ReadonlyArray<NotebookLineAnswerV1>;
  /** A cell that never ran offers the key that runs it on this line (0 for none). */
  readonly hintLine: number;
  readonly lineCount: number;
  readonly lineHeight: number;
  readonly language: NotebookCellLanguage;
  readonly cellIndex: number;
  /** The run is older than a change above it; answers read as dated. */
  readonly stale: boolean;
  /** The run the answers came from, named when they read as dated. */
  readonly runNumber: number | null;
  /** A query's result set, drawn beside the cell instead of summarized. */
  readonly table: RichOutputTable | null;
  /** The cell's lines, read for a threshold to gauge a number against. */
  readonly sourceLines: ReadonlyArray<string>;
}

/** The answer column: what each line answered, on that line. */
export const NotebookCellAnswers = memo(function NotebookCellAnswers({
  rows,
  hintLine,
  lineCount,
  lineHeight,
  language,
  cellIndex,
  stale,
  runNumber,
  table,
  sourceLines,
}: NotebookCellAnswersProps) {
  const { t } = useTranslation();
  // Built once per answer set, so each AnswerObject keeps its memo across re-renders.
  const inputs = useMemo(
    () => rows.map(answer => notebookAnswerInput(answer, language, sourceLines[answer.line - 1])),
    [rows, language, sourceLines]
  );
  const lines = Math.max(1, lineCount);
  const last = rows.length - 1;
  const lastSpansTable = last >= 0 && rows[last]!.kind === 'result' && table !== null;
  // A table runs to the end of the column, so its date gets a footer row of its own.
  const footer = stale && lastSpansTable;
  const dated = stale ? (
    <span className="notebook-answer-dated" data-testid="notebook-cell-answer-dated">
      {runNumber === null ? t('notebookAnswers.dated') : t('notebookAnswers.datedRun', { n: runNumber })}
    </span>
  ) : null;
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
        gridTemplateRows: `repeat(${lines}, ${lineHeight}px) auto${footer ? ' auto' : ''}`,
      }}
    >
      {rows.map((answer, index) => {
        const spansTable = answer.kind === 'result' && table !== null;
        // The last answer has the lines below it free, so long text wraps into them.
        const wraps = index === last && !spansTable;
        const cutTag = cutCollectionTag(answer);
        return (
          <div
            key={`${answer.line}:${answer.kind}`}
            data-testid="notebook-cell-answer"
            data-line={answer.line}
            data-kind={answer.kind}
            data-wrap={wraps ? 'true' : undefined}
            className="notebook-answer"
            style={{
              gridRow: spansTable || wraps ? `${answer.line} / ${lines + 2}` : answer.line,
              ...(spansTable || wraps ? {} : { height: lineHeight }),
            }}
          >
            {answer.kind === 'table' || answer.kind === 'result' ? (
              <>
                <TypeTag className="answer-object-tag">{TABLE_TAG}</TypeTag>
                {spansTable ? <AnswerTable table={table} /> : <RelationAnswer answer={answer} stale={stale} />}
              </>
            ) : answer.type === 'rows' ? (
              <>
                <TypeTag className="answer-object-tag">{ROWS_TAG}</TypeTag>
                <AnswerObject text={answer.text} hideTag oneLine muted={stale} />
              </>
            ) : (
              <>
                {cutTag ? <TypeTag className="answer-object-tag">{cutTag}</TypeTag> : null}
                <AnswerObject {...inputs[index]!} hideTag={cutTag !== null} oneLine={!wraps} muted={stale} />
              </>
            )}
            {index === last && !spansTable ? dated : null}
          </div>
        );
      })}
      {footer ? (
        <div className="notebook-answer" data-wrap="true" style={{ gridRow: lines + 2 }}>
          <span className="answer-object-tag" />
          {dated}
        </div>
      ) : null}
      {hintLine > 0 ? (
        <p
          data-testid="notebook-cell-run-hint"
          className="notebook-answer"
          style={{ gridRow: hintLine, height: lineHeight }}
        >
          <span className="answer-object-tag" aria-hidden="true" />
          <kbd className="notebook-answer-kbd" role="img" aria-label={t('notebookAnswers.runHintKeys')}>
            ⇧↵
          </kbd>
          <span className="notebook-answer-text">{t('notebookAnswers.runHint')}</span>
        </p>
      ) : null}
    </div>
  );
});

/** A table a statement made or read: its name and size. */
function RelationAnswer({ answer, stale }: { readonly answer: NotebookLineAnswerV1; readonly stale: boolean }) {
  const { t } = useTranslation();
  const text = replaceUnsafeText(answer.text);
  return (
    <>
      {text ? (
        <span className="notebook-answer-name" title={text}>
          {text}
        </span>
      ) : null}
      {answer.rows !== undefined ? (
        <>
          <AnswerObject text={String(answer.rows)} hideTag oneLine muted={stale} />
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

function AnswerTable({ table }: { readonly table: RichOutputTable }) {
  const { i18n } = useTranslation();
  const grid = useMemo(() => answerGrid(table.columns, table.rows, i18n.language), [table, i18n.language]);
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
