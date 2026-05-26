import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

function response(overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [{ a: 1 }],
    columns: [{ name: 'a', type: 'INTEGER' }],
    rowCount: 1,
    durationMs: 5,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqlResultPreview', () => {
  beforeEach(() => {
    useUIStore.setState({ statusNotice: null });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('discloses when copy actions use a truncated preview', async () => {
    const user = userEvent.setup();
    render(
      <SqlResultPreview
        response={response({
          status: 'too-large',
          rowCount: 20,
          tooLarge: true,
        })}
        isExecuting={false}
        rowDisplayLimit={1000}
        knownTableNames={[]}
        onShowTables={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('sql-result-preview-copy-json'));

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'sqlWorkspace.action.copiedJsonPreview',
        values: { shown: 1, total: 20 },
      });
    });
  });
});
