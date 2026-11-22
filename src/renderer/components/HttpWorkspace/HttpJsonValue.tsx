import { Variable } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnswerContext } from '../Answer/answerObjectModel';
import { capturePath, isContainer, jsonPointer, normalizeCapturePath, primitiveText, type JsonSearch, type JsonSegment } from './httpJsonTreeModel';
import { containerSummary, readJsonLeaf, type JsonTableShape } from './httpJsonAnswer';
import '../Answer/answerObject.css';
import './httpInstruments.css';

const BAR_WIDTH = 56;

interface JsonLeafProps {
  readonly value: unknown;
  /** The value as the tree shows it, possibly cut short. */
  readonly text: string;
  readonly context: AnswerContext;
  readonly highlight: (text: string) => ReactNode;
  /** Pills for scalars (`auto`), for strings too (`all`), or none, as in table cells. */
  readonly pill?: 'auto' | 'all' | 'none';
}

/** A primitive in the answer grammar: coloured by type, scalars in a pill, colours with a swatch, dates with when. */
export function JsonLeaf({ value, text, context, highlight, pill = 'auto' }: JsonLeafProps) {
  const leaf = readJsonLeaf(value, context);
  if (leaf.swatch) {
    return (
      <span className="answer-object-chip json-leaf-chip" data-testid="http-json-colour">
        <span className="answer-object-swatch" aria-hidden style={{ background: leaf.swatch }} />
        {highlight(leaf.swatch)}
      </span>
    );
  }
  return (
    <>
      <span className="answer-object-value json-leaf" data-tone={leaf.tone} data-pill={pill === 'all' || (pill === 'auto' && leaf.pill) ? '' : undefined}>
        {highlight(text)}
      </span>
      {leaf.note ? (
        <span className="json-leaf-note" data-testid="http-json-date-note">
          {leaf.note}
        </span>
      ) : null}
    </>
  );
}

interface HttpJsonTableProps {
  readonly items: readonly unknown[];
  readonly shape: JsonTableShape;
  readonly segments: readonly JsonSegment[];
  /** Row indexes shown: the page, plus any row a search hit sits in. */
  readonly shown: readonly number[];
  readonly search: JsonSearch;
  readonly captured: ReadonlyMap<string, string>;
  readonly onCapture?: (path: string, segments: readonly JsonSegment[]) => void;
  readonly context: AnswerContext;
  readonly highlight: (text: string) => ReactNode;
  readonly indent: number;
}

/** An array of objects as a table: one row per item, bars on the columns that measure. */
export function HttpJsonTable({ items, shape, segments, shown, search, captured, onCapture, context, highlight, indent }: HttpJsonTableProps) {
  const { t } = useTranslation();
  return (
    <div role="group" className="json-table answer-scope" style={{ marginLeft: indent, '--json-indent': `${indent}px` } as CSSProperties} data-testid="http-json-table">
      <table>
        <thead>
          <tr>
            <th aria-hidden />
            {shape.columns.map((column) => (
              <th key={column} scope="col">
                {highlight(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((index) => {
            const record = items[index] as Record<string, unknown>;
            return (
              <tr key={index} data-testid="http-json-table-row">
                <td className="json-table-index">{index}</td>
                {shape.columns.map((column) => {
                  const cellSegments = [...segments, index, column];
                  const pointer = jsonPointer(cellSegments);
                  const has = Object.prototype.hasOwnProperty.call(record, column);
                  const value = record[column];
                  const path = has && !isContainer(value) ? capturePath(cellSegments) : null;
                  const capturedAs = path === null ? undefined : captured.get(normalizeCapturePath(path));
                  const scale = shape.scales.get(column);
                  return (
                    <td
                      key={column}
                      data-testid="http-json-cell"
                      data-pointer={pointer}
                      // A hit nested inside a cell's object marks the cell that holds it.
                      data-hit={search.hits.has(pointer) || search.open.has(pointer)}
                      data-number={typeof value === 'number' ? '' : undefined}
                      {...(capturedAs !== undefined ? { 'data-captured': capturedAs, title: t('httpWorkspace.response.tree.captured', { name: capturedAs }) } : {})}
                    >
                      {!has ? null : isContainer(value) ? (
                        <span className="json-table-nested">{containerSummary(value)}</span>
                      ) : (
                        <span className={scale === undefined ? undefined : 'answer-object-cellbar'}>
                          <JsonLeaf value={value} text={primitiveText(value)} context={context} highlight={highlight} pill="none" />
                          {scale === undefined ? null : (
                            <span className="answer-object-hbar" aria-hidden style={{ width: Math.max(2, ((value as number) / scale) * BAR_WIDTH) }} />
                          )}
                        </span>
                      )}
                      {path !== null && capturedAs === undefined && onCapture ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="http-json-cell-capture"
                          aria-label={t('httpWorkspace.response.tree.captureAria', { path })}
                          title={t('httpWorkspace.response.tree.captureAria', { path })}
                          onClick={() => onCapture(path, cellSegments)}
                          className="json-table-capture focus-ring"
                        >
                          <Variable size={11} aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
