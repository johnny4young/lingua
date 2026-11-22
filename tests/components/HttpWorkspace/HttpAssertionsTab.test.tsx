import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HttpAssertionsTab } from '../../../src/renderer/components/HttpWorkspace/HttpAssertionsTab';
import { createBlankAssertion, runAssertions } from '../../../src/shared/httpWorkspace';
import type { HttpAssertion, HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

describe('HttpAssertionsTab', () => {
  it('shows the empty state and adds a row', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <HttpAssertionsTab
        assertions={[]}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByTestId('http-request-editor-assert-empty')).toBeTruthy();
    await user.click(screen.getByTestId('http-request-editor-assert-add'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('renders a row and edits the comparator', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <HttpAssertionsTab
        assertions={[{ ...createBlankAssertion(), id: 'a1' }]}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );
    await user.selectOptions(
      screen.getByTestId('http-request-editor-assert-comparator'),
      'contains'
    );
    expect(onUpdate).toHaveBeenCalledWith(0, { comparator: 'contains' });
  });

  it('disables the path input for status and response-time sources', () => {
    render(
      <HttpAssertionsTab
        assertions={[{ ...createBlankAssertion(), id: 'a1', source: 'status' }]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      (screen.getByTestId('http-request-editor-assert-path') as HTMLInputElement).disabled
    ).toBe(true);
  });

  it('disables the expected input for exists / not-exists', async () => {
    render(
      <HttpAssertionsTab
        assertions={[
          { ...createBlankAssertion(), id: 'a1', comparator: 'exists' },
        ]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    // A complete check reads as a line until it is selected.
    expect(screen.getByTestId('http-test-line').textContent).toContain('status exists');
    await userEvent.click(screen.getByRole('button', { name: 'Edit test 1: status exists' }));
    expect(
      (screen.getByTestId('http-request-editor-assert-expected') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });

  it('uses row-scoped accessible names when multiple tests are present', () => {
    render(
      <HttpAssertionsTab
        assertions={[
          { ...createBlankAssertion(), id: 'a1' },
          { ...createBlankAssertion(), id: 'a2' },
        ]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Test 1 source')).toBeTruthy();
    expect(screen.getByLabelText('Test 2 source')).toBeTruthy();
    expect(screen.getByLabelText('Test 1 expected value')).toBeTruthy();
    expect(screen.getByLabelText('Test 2 expected value')).toBeTruthy();
  });

  it('keeps assertion actions on the shared focus-ring contract', () => {
    render(
      <HttpAssertionsTab
        assertions={[{ ...createBlankAssertion(), id: 'a1' }]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByTestId('http-request-editor-assert-add').className).toContain(
      'focus-ring'
    );
    expect(screen.getByLabelText('Remove test 1').className).toContain('focus-ring');
  });

  describe('answers', () => {
    const NOW = '2026-11-20T10:00:00.000Z';
    const response: HttpResponseV1 = {
      version: 1,
      kind: 'success',
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/services',
      finalUrl: 'https://api.example.com/services',
      headers: [{ name: 'content-type', value: 'application/json' }],
      body: JSON.stringify({ items: [{ status: 'healthy' }], total: 4, next: null }),
      contentType: 'application/json',
      sizeBytes: 64,
      durationMs: 142,
      tooLarge: false,
      redactedHeaders: [],
      recordedAt: NOW,
    };
    const rows: HttpAssertion[] = [
      { id: 'a1', source: 'status', path: '', comparator: 'equals', expected: '200', enabled: true },
      { id: 'a2', source: 'response-time', path: '', comparator: 'less-than', expected: '100', enabled: true },
      { id: 'a3', source: 'body-json', path: 'items[0].status', comparator: 'equals', expected: 'healthy', enabled: true },
      { id: 'a4', source: 'body-json', path: 'missing', comparator: 'exists', expected: '', enabled: true },
    ];
    const results = new Map(runAssertions(response, rows).map((result) => [result.id, result]));

    it('answers each check with its actual value, type and a gauge against the threshold', () => {
      render(<HttpAssertionsTab assertions={rows} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} response={response} results={results} />);
      const lines = screen.getAllByTestId('http-test-line');
      expect(lines.map((line) => line.querySelector('.http-test-code')?.textContent)).toEqual([
        'status == 200',
        'duration < 100 ms',
        'body.items[0].status == "healthy"',
        'body.missing exists',
      ]);
      expect(lines.map((line) => line.dataset.pass)).toEqual(['true', 'false', 'true', 'false']);
      const answers = screen.getAllByTestId('http-test-answer').map((answer) => answer.textContent);
      expect(answers).toEqual(['status200', 'ms142', 'string"healthy"', 'bodyno value']);
      const gauge = within(lines[1]!).getByTestId('http-test-gauge');
      const [under, over] = [...gauge.querySelectorAll('i')];
      expect(under?.style.width).toBe(`${(100 / 142) * 100}%`);
      expect(over?.hasAttribute('data-over')).toBe(true);
      expect(gauge.querySelector('b')?.style.left).toBe(`${(100 / 142) * 100}%`);
    });

    it('closes an open row on Escape and opens rows added blank, not suggested ones', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<HttpAssertionsTab assertions={[rows[0]!]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />);
      await user.click(screen.getByTestId('http-test-line-edit'));
      expect(screen.getByTestId('http-test-edit')).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(screen.queryByTestId('http-test-edit')).toBeNull();
      rerender(<HttpAssertionsTab assertions={[rows[0]!, rows[2]!, { ...createBlankAssertion(), id: 'blank' }]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />);
      expect(screen.getAllByTestId('http-test-line')).toHaveLength(2);
      expect(screen.getAllByTestId('http-test-edit')).toHaveLength(1);
    });

    it('offers suggested checks, the snapshot check and the variables the request resolves', async () => {
      const onAddSuggestion = vi.fn();
      const suggestion = { source: 'body-json' as const, path: 'total', comparator: 'equals' as const, expected: '4', enabled: true };
      render(
        <HttpAssertionsTab
          assertions={[]}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          onRemove={vi.fn()}
          response={response}
          results={new Map()}
          snapshotChanges={2}
          suggestions={[suggestion]}
          onAddSuggestion={onAddSuggestion}
          variables={[
            { key: 'baseUrl', scope: 'environment', scopeLabel: 'staging', state: 'resolved', value: 'https://api.example.com' },
            { key: 'token', scope: 'environment', scopeLabel: 'staging', state: 'secret' },
            { key: 'tenant', scopeLabel: '', state: 'unresolved' },
          ]}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add test body.total == 4' }));
      expect(onAddSuggestion).toHaveBeenCalledWith(suggestion);
      const snapshot = screen.getByTestId('http-response-snapshot-row');
      expect(snapshot.dataset.pass).toBe('false');
      expect(snapshot.textContent).toContain('2 changes');
      expect(screen.getAllByTestId('http-test-variable').map((row) => row.textContent)).toEqual([
        '{{baseUrl}}staging"https://api.example.com"',
        '{{token}}staging••••••',
        '{{tenant}}unresolved',
      ]);
    });
  });
});
