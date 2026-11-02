import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { SqlStarterPrompts } from '../../../src/renderer/components/SqlWorkspace/SqlStarterPrompts';
import { AskSqlButton } from '../../../src/renderer/components/SqlWorkspace/AskSqlButton';
import { useAskSqlStore } from '../../../src/renderer/stores/askSqlStore';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({ useEntitlement: () => entitled }));

const orders = { name: 'orders', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'status', type: 'VARCHAR' }] };

describe('SqlStarterPrompts', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    entitled = true;
    useAskSqlStore.setState({ question: null });
  });

  const prompts = () => screen.getAllByRole('button').map(button => button.textContent);

  it('asks about the first table, grouping by a text column', () => {
    render(<SqlStarterPrompts tables={[orders]} />);
    expect(prompts()).toEqual(['Show 10 rows of orders', 'Count the rows of orders by status', 'Which columns of orders have empty values?']);
  });

  it('counts rows when the table has no text column', () => {
    render(<SqlStarterPrompts tables={[{ name: 'nums', columns: [{ name: 'n', type: 'INTEGER' }] }]} />);
    expect(prompts()[1]).toBe('How many rows does nums have?');
  });

  it('offers data to create without tables', () => {
    render(<SqlStarterPrompts tables={[]} />);
    expect(prompts()).toEqual(['Create a table of 5 sample users', 'List the next 7 days with their weekday', 'Show the current date and time']);
  });

  it('opens Ask AI with the prompt typed in', () => {
    useAiConfigStore.setState({ endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'sk-test', model: 'm' });
    render(
      <>
        <AskSqlButton tables={[orders]} onInsert={vi.fn()} />
        <SqlStarterPrompts tables={[orders]} />
      </>
    );
    fireEvent.click(screen.getByText('Show 10 rows of orders'));
    expect((screen.getByTestId('ask-sql-question') as HTMLTextAreaElement).value).toBe('Show 10 rows of orders');
    act(() => useAskSqlStore.getState().close());
    fireEvent.click(screen.getByTestId('ask-sql-trigger'));
    expect((screen.getByTestId('ask-sql-question') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows nothing without Pro', () => {
    entitled = false;
    const { container } = render(<SqlStarterPrompts tables={[orders]} />);
    expect(container.textContent).toBe('');
  });
});
