/**
 * T2 — HttpCaptureTab isolated UI tests: empty state, add, per-row edits
 * (source / path / target), the status-source path lockout, and remove.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && opts.name !== undefined ? `${key}:${String(opts.name)}` : key,
  }),
}));

import { HttpCaptureTab } from '../../../src/renderer/components/HttpWorkspace/HttpCaptureTab';
import type { HttpCaptureRule } from '../../../src/shared/httpWorkspace';

const rule = (overrides: Partial<HttpCaptureRule> = {}): HttpCaptureRule => ({
  id: 'c1',
  source: 'body-json',
  path: 'data.token',
  targetVariable: 'TOKEN',
  enabled: true,
  ...overrides,
});

describe('HttpCaptureTab', () => {
  it('shows the empty state and fires onAdd', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <HttpCaptureTab
        captures={[]}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByTestId('http-request-editor-capture-empty')).toBeTruthy();
    await user.click(screen.getByTestId('http-request-editor-capture-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders a rule row with its source, path and target', () => {
    render(
      <HttpCaptureTab
        captures={[rule()]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      (screen.getByTestId('http-request-editor-capture-source') as HTMLSelectElement)
        .value
    ).toBe('body-json');
    expect(
      (screen.getByTestId('http-request-editor-capture-path') as HTMLInputElement)
        .value
    ).toBe('data.token');
    expect(
      (screen.getByTestId('http-request-editor-capture-target') as HTMLInputElement)
        .value
    ).toBe('TOKEN');
  });

  it('locks the path input when the source is status', () => {
    render(
      <HttpCaptureTab
        captures={[rule({ source: 'status', path: '' })]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      (screen.getByTestId('http-request-editor-capture-path') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });

  it('fires onUpdate on source change and target typing, onRemove on delete', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(
      <HttpCaptureTab
        captures={[rule({ targetVariable: '' })]}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    );

    await user.selectOptions(
      screen.getByTestId('http-request-editor-capture-source'),
      'header'
    );
    expect(onUpdate).toHaveBeenCalledWith(0, { source: 'header' });

    await user.type(screen.getByTestId('http-request-editor-capture-target'), 'X');
    expect(onUpdate).toHaveBeenLastCalledWith(0, { targetVariable: 'X' });

    await user.click(
      screen.getByRole('button', {
        name: 'httpWorkspace.editor.capture.remove.aria',
      })
    );
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
