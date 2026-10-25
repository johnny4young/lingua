import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { HttpResponsePreview } from '@/components/HttpWorkspace/HttpResponsePreview';
import { DEFAULT_SNAPSHOT_SCRUBBERS, takeSnapshot } from '@/../shared/httpSnapshot';
import type { HttpResponseSnapshot, HttpResponseV1 } from '@/../shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const response = (body: unknown, extra: Partial<HttpResponseV1> = {}): HttpResponseV1 => ({
  version: 1,
  kind: 'success',
  status: 200,
  statusText: 'OK',
  url: 'https://api.example.com/repo',
  finalUrl: 'https://api.example.com/repo',
  headers: [],
  body: JSON.stringify(body),
  contentType: 'application/json',
  sizeBytes: 10,
  durationMs: 12,
  tooLarge: false,
  redactedHeaders: [],
  recordedAt: NOW,
  ...extra,
});
const baseline = takeSnapshot(response({ name: 'janusly', stars: 12, updated_at: '2026-10-24T00:00:00Z' }), DEFAULT_SNAPSHOT_SCRUBBERS)!;

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

function preview(current: HttpResponseV1, snapshot: HttpResponseSnapshot | undefined, extra: Partial<React.ComponentProps<typeof HttpResponsePreview>> = {}) {
  const onChange = vi.fn();
  const onAddAssertion = vi.fn();
  render(<HttpResponsePreview response={current} isExecuting={false} snapshots={{ snapshot, onChange, onAddAssertion }} {...extra} />);
  return { onChange, onAddAssertion };
}

describe('snapshot tab', () => {
  it('takes the shown response as the snapshot', async () => {
    const { onChange } = preview(response({ name: 'janusly' }), undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect(screen.getByTestId('http-snapshot').dataset.state).toBe('off');
    await userEvent.click(screen.getByTestId('http-snapshot-toggle'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ version: 1, status: 200, body: '{"name":"janusly"}', scrubbers: DEFAULT_SNAPSHOT_SCRUBBERS }));
  });

  it('shows a changed response as a failed check and a diff to accept or reject', async () => {
    const { onChange } = preview(response({ name: 'janusly', stars: 14, updated_at: '2026-10-25T09:00:00Z' }), baseline);
    expect(screen.getByTestId('http-response-assertions-summary').textContent).toBe('0/1 tests passed');
    expect(screen.getByTestId('http-response-snapshot-row').dataset.pass).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect(screen.getByTestId('http-snapshot-badge').textContent).toBe('1 change');
    expect(screen.getByTestId('http-snapshot-diff').textContent).toBe('- stars: 12+ stars: 14');
    await userEvent.click(screen.getByTestId('http-snapshot-reject'));
    expect(screen.queryByTestId('http-snapshot-accept')).toBeNull();
    expect(screen.getByTestId('http-response-snapshot-row').dataset.pass).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect(screen.queryByTestId('http-snapshot-accept')).toBeNull();
  });

  it('accepts a response as the new snapshot', async () => {
    const current = response({ name: 'janusly', stars: 14 });
    const { onChange } = preview(current, baseline);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(screen.getByTestId('http-snapshot-accept'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ body: current.body, scrubbers: baseline.scrubbers }));
  });

  it('changes scrubbers on the snapshot', async () => {
    const { onChange } = preview(response({ name: 'janusly', stars: 12, updated_at: '2026-10-24T00:00:00Z' }), baseline);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(screen.getByRole('button', { name: 'hostname' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...baseline, scrubbers: { ...baseline.scrubbers, hostname: true } });
    fireEvent.change(screen.getByTestId('http-snapshot-regex'), { target: { value: 'v\\d+' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.blur(screen.getByTestId('http-snapshot-regex'));
    expect(screen.getByTestId('http-snapshot-regex').getAttribute('aria-invalid')).toBe('false');
    expect(onChange).toHaveBeenLastCalledWith({ ...baseline, scrubbers: { ...baseline.scrubbers, regex: 'v\\d+' } });
  });

  it('flags a custom pattern it ignores', async () => {
    preview(response({ name: 'janusly' }), baseline);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    fireEvent.change(screen.getByTestId('http-snapshot-regex'), { target: { value: '(a+)+$' } });
    expect(screen.getByTestId('http-snapshot-regex').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('http-snapshot-regex').getAttribute('title')).toContain('ignored');
  });

  it('cannot snapshot a response over the cap', async () => {
    preview(response('x'.repeat(300 * 1024)), undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect(screen.getByTestId('http-snapshot-toggle').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('http-snapshot').textContent).toContain('larger than 256 KB');
  });

  it('stays hidden with the flag off', () => {
    render(<HttpResponsePreview response={response({})} isExecuting={false} />);
    expect(screen.queryByRole('button', { name: 'Snapshot' })).toBeNull();
    expect(screen.queryByTestId('http-response-suggestions')).toBeNull();
  });
});

describe('suggested assertions', () => {
  it('adds a suggestion in one click', async () => {
    const { onAddAssertion } = preview(response({ name: 'janusly' }), undefined, { assertions: [] });
    const chips = screen.getAllByTestId('http-response-suggestion').map((chip) => chip.textContent);
    expect(chips).toEqual(['+ Status equals 200', '+ Header content-type contains json', '+ Body (JSON) name equals janusly']);
    await userEvent.click(screen.getAllByTestId('http-response-suggestion')[2]!);
    expect(onAddAssertion).toHaveBeenCalledWith({ source: 'body-json', path: 'name', comparator: 'equals', expected: 'janusly', enabled: true });
  });
});
