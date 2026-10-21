import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeQuery, exportCapsuleToClipboard } = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  exportCapsuleToClipboard: vi.fn(),
}));
vi.mock('../../../src/renderer/runtime/duckdbClient', async importOriginal => ({
  ...(await importOriginal<object>()),
  executeQuery,
}));
vi.mock('../../../src/renderer/components/Editor/runCapsuleExportLoader', () => ({
  loadCapsuleExporter: async () => ({ exportCapsuleToClipboard }),
}));
vi.mock('../../../src/renderer/runtime/sqlResponseCapsule', () => ({
  buildSqlResponseCapsule: async (input: { query: { query: string }; platform: string }) => ({
    sql: input.query.query,
    platform: input.platform,
  }),
}));

import { useSqlResultHandoffs } from '../../../src/renderer/hooks/useSqlResultHandoffs';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const response: SqlResponseV1 = {
  version: 1,
  status: 'success',
  rows: [{ city: 'Lima', orders: '7' }],
  columns: [
    { name: 'city', type: 'Utf8' },
    { name: 'orders', type: 'Int64' },
  ],
  rowCount: 1,
  durationMs: 3,
  tooLarge: false,
  statementCount: 1,
  recordedAt: '2026-10-20T00:00:00.000Z',
};

function handoffs(
  sql: string | undefined,
  onTableCreated = vi.fn(),
  tableName?: string
) {
  return renderHook(() =>
    useSqlResultHandoffs({
      response,
      source:
        sql === undefined
          ? undefined
          : tableName !== undefined
            ? { origin: 'table', sql, tableName }
            : { origin: 'editor', sql },
      query: undefined,
      existingTableNames: ['cities', 'result'],
      timeoutMs: 1000,
      onTableCreated,
    })
  ).result.current;
}

describe('SQL result hand-offs', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    exportCapsuleToClipboard.mockReset();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({ statusNotice: null });
  });

  it('saves a single read query as a new table and refreshes the Explorer', async () => {
    executeQuery.mockResolvedValue({ status: 'success' });
    const onTableCreated = vi.fn();
    const result = handoffs('SELECT city FROM cities;', onTableCreated);
    expect(result.saveAsTable?.suggestedName).toBe('result_2');
    await expect(result.saveAsTable!.onSave('top cities')).resolves.toBe(true);
    expect(executeQuery).toHaveBeenCalledWith(
      'CREATE TABLE "top cities" AS SELECT city FROM cities;',
      {
        timeoutMs: 1000,
      }
    );
    expect(onTableCreated).toHaveBeenCalledOnce();
  });

  it('offers no Save as table for a mutating or unknown source', () => {
    expect(handoffs('DELETE FROM cities').saveAsTable).toBeUndefined();
    expect(handoffs(undefined).saveAsTable).toBeUndefined();
    expect(handoffs(undefined).onSaveCapsule).toBeUndefined();
  });

  it('opens a Python tab with the rows as dicts', () => {
    handoffs('SELECT 1').onSendToPython!(response.rows);
    const tab = useEditorStore.getState().tabs[0]!;
    expect(tab.language).toBe('python');
    expect(tab.content).toContain('{"city": "Lima", "orders": 7}');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('sqlWorkspace.handoff.pythonSent');
  });

  it('copies a run capsule built from the SQL behind the rows', async () => {
    exportCapsuleToClipboard.mockResolvedValue({ ok: true });
    handoffs('SELECT city FROM cities').onSaveCapsule!();
    await waitFor(() =>
      expect(exportCapsuleToClipboard).toHaveBeenCalledWith(
        { sql: 'SELECT city FROM cities', platform: 'web' },
        'result-panel-export'
      )
    );
  });

  it('labels the copied capsule desktop when the preload reports an OS platform', async () => {
    exportCapsuleToClipboard.mockResolvedValue({ ok: true });
    (window as unknown as { lingua?: unknown }).lingua = { platform: 'darwin' };
    try {
      handoffs('SELECT 1').onSaveCapsule!();
      await waitFor(() =>
        expect(exportCapsuleToClipboard).toHaveBeenCalledWith(
          { sql: 'SELECT 1', platform: 'desktop' },
          'result-panel-export'
        )
      );
    } finally {
      delete (window as unknown as { lingua?: unknown }).lingua;
    }
  });

  it('keeps a table name with line breaks inside the Python header comment', () => {
    handoffs('SELECT 1', vi.fn(), 'x\nimport js\n#').onSendToPython!(response.rows);
    const [header, second] = useEditorStore.getState().tabs[0]!.content.split('\n');
    expect(header).toBe('# Rows from x import js #: 1 of 1');
    expect(second).toBe('rows = [');
  });
});
