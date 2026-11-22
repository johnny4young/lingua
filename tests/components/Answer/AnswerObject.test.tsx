import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { AnswerObject, LoopAnswerObject, RunningAnswerObject } from '@/components/Answer/AnswerObject';
import { readAnswer } from '@/components/Answer/answerObjectModel';
import type { RichOutputPayload } from '../../../src/shared/richOutput';

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage('en');
});

const num = (repr: string) => ({ kind: 'primitive', type: 'number', repr }) as const;

describe('AnswerObject', () => {
  it('draws the tag, the typed value and the picture', () => {
    render(<AnswerObject text="[38, 41, 35, 44, 39, 52, 37]" language="python" />);
    const answer = screen.getByTestId('answer-object');
    expect(answer.getAttribute('data-kind')).toBe('array');
    expect(answer.getAttribute('data-picture')).toBe('bars');
    expect(within(answer).getByText('list·7').classList.contains('type-tag')).toBe(true);
    expect(screen.getByTestId('answer-object-value').textContent).toContain('35 – 52');
    expect(screen.getByTestId('answer-object-value').getAttribute('data-tone')).toBe('number');
    expect(screen.getByTestId('answer-picture-bars').querySelectorAll('rect')).toHaveLength(7);
  });

  it('renders a picture for every payload kind that has one', () => {
    const cases: Array<[RichOutputPayload | string, string]> = [
      [JSON.stringify(Array.from({ length: 40 }, (_, i) => i % 7)), 'answer-picture-spark'],
      ['{"api": 40.9, "db": 96.9}', 'answer-picture-scale'],
      ['{"api": [1, 2], "db": [3, 4]}', 'answer-picture-keys'],
      ['{"api": "#7FD8C4"}', 'answer-picture-colours'],
      [{ kind: 'table', columns: ['a'], rows: [[num('1')], [num('3')]] }, 'answer-picture-table'],
      [{ kind: 'date', iso: new Date(Date.now() + 7_200_000).toISOString() }, 'answer-picture-relative'],
      [{ kind: 'progress', id: 'p', label: 'load', value: 0.4 }, 'answer-picture-progress'],
    ];
    for (const [input, testId] of cases) {
      const view =
        typeof input === 'string' ? render(<AnswerObject text={input} />) : render(<AnswerObject text="" payload={input} />);
      expect(screen.getByTestId(testId)).toBeTruthy();
      view.unmount();
    }
  });

  it('gauges a number against the threshold in its source line', () => {
    render(<AnswerObject text="-31.4" language="python" source="budget = 120 - p95[slowest]" />);
    expect(screen.getByTestId('answer-picture-gauge').hasAttribute('data-over')).toBe(true);
    expect(screen.getByText('over 120')).toBeTruthy();
  });

  it('keeps a colour chip strict about what it paints', () => {
    render(<AnswerObject text='{"a": "#FF7566", "b": "#00BFDF"}' />);
    const swatches = screen.getByTestId('answer-picture-colours').querySelectorAll<HTMLElement>('.answer-object-swatch');
    expect([...swatches].map(swatch => swatch.style.background)).toEqual(['rgb(255, 117, 102)', 'rgb(0, 191, 223)']);
    cleanup();
    render(<AnswerObject text='"url(javascript:alert(1))"' />);
    expect(screen.queryByTestId('answer-picture-colours')).toBeNull();
  });

  it('folds a long string and translates the fold', async () => {
    render(<AnswerObject text={'"a\\nb\\nc"'} />);
    expect(screen.getByTestId('answer-object-fold').textContent).toContain('+2 lines');
    await i18next.changeLanguage('es');
    cleanup();
    render(<AnswerObject text={'"a\\nb"'} />);
    expect(screen.getByTestId('answer-object-fold').textContent).toContain('+1 línea');
  });

  it('shows control characters as spaces and keeps the full value in the tooltip', () => {
    render(<AnswerObject text={'"admin‮nimda"'} />);
    const value = screen.getByTestId('answer-object-value');
    expect(value.textContent).toContain('"admin nimda"');
    expect(value.getAttribute('title')).toBe('admin nimda');
  });

  it('shows values only in compact mode', () => {
    render(<AnswerObject text='{"api": 40.9}' compact />);
    expect(screen.queryByTestId('answer-picture-scale')).toBeNull();
    expect(screen.getByTestId('answer-object-value').textContent).toContain('api 40.9');
  });

  it('colours an error and nothing else red', () => {
    render(<AnswerObject text="KeyError: 'cache'" role="error" />);
    expect(screen.getByTestId('answer-object').getAttribute('data-tone')).toBe('error');
    expect(screen.getByText('error').classList.contains('answer-object-tag')).toBe(true);
  });
});

describe('state answers', () => {
  it('stands the pulse in for a running line', async () => {
    render(<RunningAnswerObject elapsedMs={310} />);
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('310 ms')).toBeTruthy();
    expect(screen.getByText('on this line')).toBeTruthy();
  });

  it('names the loop pass and its variable', () => {
    const value = readAnswer({ text: "'db'", language: 'python' }, { now: 0, locale: 'en' });
    render(<LoopAnswerObject iteration={3} total={3} binding={{ name: 'name', value }} />);
    expect(screen.getByText('loop')).toBeTruthy();
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(screen.getByText('name =')).toBeTruthy();
    expect(screen.getByTestId('answer-object-binding').textContent).toContain("'db'");
  });
});
