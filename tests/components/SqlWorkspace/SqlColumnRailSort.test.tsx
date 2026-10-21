import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { calls } = vi.hoisted(() => ({ calls: { count: 0 } }));
vi.mock('../../../src/renderer/components/SqlWorkspace/sqlColumnStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/renderer/components/SqlWorkspace/sqlColumnStats')>();
  return {
    ...actual,
    columnStats: (...args: Parameters<typeof actual.columnStats>) => {
      calls.count += 1;
      return actual.columnStats(...args);
    },
  };
});

import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const response: SqlResponseV1 = {
  version: 1,
  status: 'success',
  rows: [{ n: '2' }, { n: '1' }, { n: '3' }],
  columns: [{ name: 'n', type: 'Int64' }],
  rowCount: 3,
  durationMs: 1,
  tooLarge: false,
  statementCount: 1,
  recordedAt: '2026-10-21T10:00:00.000Z',
};

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

describe('column rail and sort', () => {
  it('keeps its stats when the grid is only re-sorted', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response} isExecuting={false} rowDisplayLimit={1_000} />);
    expect(screen.getByTestId('sql-column-rail')).toBeTruthy();
    const before = calls.count;
    await user.click(screen.getByTestId('sql-result-preview-sort'));
    await user.click(screen.getByTestId('sql-result-preview-sort'));
    expect(screen.getAllByTestId('sql-result-preview-row')[0]!.textContent).toContain('3');
    expect(calls.count).toBe(before);
  });
});
