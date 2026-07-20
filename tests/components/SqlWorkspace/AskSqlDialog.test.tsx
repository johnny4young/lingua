/**
 * implementation follow-on — "Ask AI" NL→SQL dialog. Verifies the consent gate (live
 * schema-only preview, nothing sent until Send), the generated-SQL insert
 * path, and the entitlement/config degradations.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { AskSqlDialog } from '../../../src/renderer/components/SqlWorkspace/AskSqlDialog';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

function configureAi(): void {
  useAiConfigStore.setState({
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
  });
}

const tables = [
  {
    name: 'orders',
    columns: [
      { name: 'id', type: 'BIGINT' },
      { name: 'total', type: 'DOUBLE' },
    ],
  },
];

describe('AskSqlDialog (implementation NL→SQL)', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    entitled = true;
    useAiConfigStore.getState().clear();
  });

  it('shows an upsell without the entitlement', () => {
    entitled = false;
    configureAi();
    render(<AskSqlDialog tables={tables} onInsert={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('ask-sql-upsell')).toBeTruthy();
    expect(screen.queryByTestId('ask-sql-send')).toBeNull();
  });

  it('previews the schema-only payload live and sends nothing on mount', () => {
    configureAi();
    const impl = vi.fn();
    render(
      <AskSqlDialog
        tables={tables}
        onInsert={() => {}}
        onClose={() => {}}
        runChatCompletionImpl={impl as never}
      />
    );
    const preview = screen.getByTestId('ask-sql-preview');
    expect(preview.textContent).toContain('orders(id BIGINT, total DOUBLE)');
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'top 5 orders by total' },
    });
    expect(screen.getByTestId('ask-sql-preview').textContent).toContain(
      'top 5 orders by total'
    );
    expect(impl).not.toHaveBeenCalled();
  });

  it('disables Send until a question is typed', () => {
    configureAi();
    render(<AskSqlDialog tables={tables} onInsert={() => {}} onClose={() => {}} />);
    const sendButton = screen.getByTestId('ask-sql-send');
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'count orders' },
    });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends on click, renders the answer, and inserts the generated SQL', async () => {
    configureAi();
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const impl = vi.fn().mockResolvedValue({
      ok: true,
      content:
        'Here you go:\n```sql\nSELECT * FROM orders ORDER BY total DESC LIMIT 5;\n```',
    });
    render(
      <AskSqlDialog
        tables={tables}
        onInsert={onInsert}
        onClose={onClose}
        runChatCompletionImpl={impl as never}
      />
    );
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'top 5 orders by total' },
    });
    fireEvent.click(screen.getByTestId('ask-sql-send'));
    await waitFor(() => expect(screen.getByTestId('ask-sql-insert')).toBeTruthy());

    // The payload carried the schema + question.
    const sent = impl.mock.calls[0]![0] as {
      messages: readonly { role: string; content: string }[];
    };
    expect(sent.messages[1]!.content).toContain('orders(id BIGINT, total DOUBLE)');

    fireEvent.click(screen.getByTestId('ask-sql-insert'));
    expect(onInsert).toHaveBeenCalledWith(
      'SELECT * FROM orders ORDER BY total DESC LIMIT 5;'
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('aborts an in-flight SQL request when the dialog closes', async () => {
    configureAi();
    const onClose = vi.fn();
    let signal: AbortSignal | undefined;
    const impl = vi.fn(
      async (
        _req: unknown,
        _cfg: unknown,
        options?: { signal?: AbortSignal }
      ) => {
        signal = options?.signal;
        return new Promise<never>(() => {});
      }
    );
    render(
      <AskSqlDialog
        tables={tables}
        onInsert={() => {}}
        onClose={onClose}
        runChatCompletionImpl={impl as never}
      />
    );
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'count orders' },
    });
    fireEvent.click(screen.getByTestId('ask-sql-send'));
    await waitFor(() => expect(impl).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('ask-sql-close'));

    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers Ask again instead of Insert when the answer has no SQL block', async () => {
    configureAi();
    const impl = vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'I need more details.' });
    render(
      <AskSqlDialog
        tables={tables}
        onInsert={() => {}}
        onClose={() => {}}
        runChatCompletionImpl={impl as never}
      />
    );
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'do something vague' },
    });
    fireEvent.click(screen.getByTestId('ask-sql-send'));
    await waitFor(() => expect(screen.getByTestId('ask-sql-again')).toBeTruthy());
    expect(screen.queryByTestId('ask-sql-insert')).toBeNull();
  });

  it('renders a failure with a retry back to the question', async () => {
    configureAi();
    const impl = vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'network', message: 'offline' });
    render(
      <AskSqlDialog
        tables={tables}
        onInsert={() => {}}
        onClose={() => {}}
        runChatCompletionImpl={impl as never}
      />
    );
    fireEvent.change(screen.getByTestId('ask-sql-question'), {
      target: { value: 'count orders' },
    });
    fireEvent.click(screen.getByTestId('ask-sql-send'));
    await waitFor(() => expect(screen.getByTestId('ask-sql-error')).toBeTruthy());
    fireEvent.click(screen.getByTestId('ask-sql-retry'));
    expect(screen.getByTestId('ask-sql-question')).toBeTruthy();
  });
});
