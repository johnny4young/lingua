import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineAnswerLine } from '@/components/Editor/InlineAnswerLine';

describe('InlineAnswerLine', () => {
  it('badges only watch results, not arrow magic results', () => {
    const { container } = render(
      <InlineAnswerLine
        items={[
          { line: 1, value: 'arrow value', type: 'magic' },
          { line: 1, value: 'pinned value', type: 'watch' },
        ]}
      />
    );
    expect(container.querySelectorAll('.lingua-inline-result-watch')).toHaveLength(1);
    const parts = [...container.querySelectorAll('.lingua-inline-result-part')];
    expect(parts.map(part => part.getAttribute('data-result-kind'))).toEqual(['magic', 'watch']);
  });

  it('draws a single answer with its picture and reads its source for a threshold', () => {
    render(<InlineAnswerLine items={[{ line: 1, value: '-31.4', type: 'autoLog' }]} language="python" source="budget = 120 - p95" />);
    expect(screen.getByTestId('answer-picture-gauge')).toBeTruthy();
  });

  it('shares the row as values only when a line has several answers', () => {
    render(
      <InlineAnswerLine
        items={[
          { line: 2, value: '[1, 2, 3]', type: 'log', name: 'a' },
          { line: 2, value: '[4, 5, 6]', type: 'log', name: 'b' },
        ]}
      />
    );
    expect(screen.queryByTestId('answer-picture-bars')).toBeNull();
    expect(screen.getAllByTestId('answer-object-value').map(value => value.textContent)).toEqual(['1 – 3', '4 – 6']);
  });

  it('shows the latest of a line answered on every pass, with the count', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ line: 3, value: `tick ${index}`, type: 'log' as const }));
    const { container } = render(<InlineAnswerLine items={items} />);
    expect(screen.getAllByTestId('answer-object-value').map(value => value.textContent)).toEqual(['tick 11']);
    expect(screen.getByTestId('lingua-inline-result-repeat').textContent).toBe('last of 12');
    expect(container.querySelector('[data-testid="lingua-inline-result-overflow"]')).toBeNull();
  });

  it('names the variable of a paused value and shows control characters as spaces', () => {
    const { container } = render(<InlineAnswerLine items={[{ line: 2, name: 'a‮b', value: '1', type: 'log' }]} />);
    expect(container.querySelector('.lingua-inline-result-name')?.textContent).toBe('a b:');
    expect(container.querySelector('[data-testid="answer-object-value"]')?.textContent).toBe('1');
    // The variable name labels a paused value, so its type tag steps aside.
    expect(screen.queryByText('number')).toBeNull();
  });

  it('prints console output as stdout and errors with their kind', () => {
    const { container } = render(
      <InlineAnswerLine
        items={[
          { line: 4, value: 'Error: invalid device id', type: 'error' },
          { line: 4, value: 'hello', type: 'log' },
        ]}
      />
    );
    expect(container.querySelector('[data-result-kind="error"] [data-kind="error"]')).not.toBeNull();
    expect(container.querySelector('[data-result-kind="log"] [data-kind="stdout"]')).not.toBeNull();
  });

  it('counts mixed answers past the third', () => {
    const items = [1, 2, 3, 4, 5].map(n => ({ line: 1, value: String(n), type: n % 2 ? ('log' as const) : ('autoLog' as const) }));
    render(<InlineAnswerLine items={items} />);
    expect(screen.getByTestId('lingua-inline-result-overflow').textContent).toContain('+2');
  });

  it('renders the timing chip after the answers and marks the slowest', () => {
    render(<InlineAnswerLine items={[{ line: 1, value: '42', type: 'autoLog' }]} timing={{ durationMs: 320.4, slowest: false }} />);
    expect(screen.getByTestId('lingua-inline-timing').textContent).toContain('▸ 320 ms');
    expect(screen.getByTestId('lingua-inline-timing').hasAttribute('data-slowest')).toBe(false);
  });

  it('draws a leader only for a line that has answers', () => {
    const { container, rerender } = render(<InlineAnswerLine items={[{ line: 1, value: '1', type: 'autoLog' }]} />);
    expect(container.querySelectorAll('.lingua-inline-result-leader')).toHaveLength(1);
    rerender(<InlineAnswerLine items={[]} timing={{ durationMs: 3, slowest: false }} />);
    expect(container.querySelectorAll('.lingua-inline-result-leader')).toHaveLength(0);
  });

  it('renders a timing-only line with sub-100 ms precision', () => {
    const { container } = render(<InlineAnswerLine items={[]} timing={{ durationMs: 1.26, slowest: true }} />);
    expect(screen.getByTestId('lingua-inline-timing').textContent).toContain('▸ 1.3 ms');
    expect(screen.getByTestId('lingua-inline-timing').getAttribute('data-slowest')).toBe('true');
    expect(container.querySelectorAll('.lingua-inline-result-part')).toHaveLength(0);
  });

  it('adds the change since the previous run after the answer', () => {
    render(
      <InlineAnswerLine
        items={[{ line: 1, value: '-31.4', type: 'autoLog' }]}
        change={{ delta: { change: { kind: 'number', before: '-10.6', up: false, by: '20.8' }, edited: true }, since: 6 }}
      />
    );
    const chip = screen.getByTestId('answer-delta');
    expect(chip.querySelector('s')?.textContent).toContain('-10.6');
    expect(chip.textContent).toContain('▼');
    expect(chip.textContent).toContain('20.8');
    expect(chip.textContent).toContain('· edited');
  });
});
