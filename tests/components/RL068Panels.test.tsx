/**
 * RL-068 closeout panels — combined component-level smoke tests for
 * YamlJsonPanel, JsonCsvPanel, MarkdownPreviewPanel, SqlFormatterPanel.
 * Helper coverage lives in `tests/utils/{yamlJson,jsonCsv,markdownPreview,sqlFormatter}.test.ts`;
 * these cases verify the panels mount, render their seeded outputs,
 * and respond to mode toggles.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => <div onClick={onClose}>{children}</div>,
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

describe('YamlJsonPanel', () => {
  it('renders the seeded YAML → JSON output and surfaces the comments-dropped warning', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="yaml-json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const output = (screen.getByTestId('yaml-json-output') as HTMLTextAreaElement).value;
    expect(output).toContain('"name": "lingua"');
    expect(output).toContain('"services"');
    expect(screen.getByTestId('yaml-json-comments-dropped')).toBeTruthy();
  });

  it('switches to JSON → YAML mode and re-renders', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="yaml-json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    await user.selectOptions(screen.getByTestId('yaml-json-mode'), 'json-to-yaml');
    await waitFor(() => {
      const output = (screen.getByTestId('yaml-json-output') as HTMLTextAreaElement).value;
      expect(output).toContain('name: lingua');
    });
  });

  it('shows the empty-state hint when the input is cleared', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="yaml-json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const input = screen.getByTestId('yaml-json-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => {
      expect(
        screen.getByText(/Paste YAML or JSON above to see the converted output/),
      ).toBeTruthy();
    });
  });
});

describe('JsonCsvPanel', () => {
  it('renders the seeded JSON → CSV output with the header row', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json-csv" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const output = (screen.getByTestId('json-csv-output') as HTMLTextAreaElement).value;
    expect(output.split('\n')[0]).toBe('name,score');
    expect(output).toContain('Alice,92');
    expect(screen.getByTestId('json-csv-summary').textContent).toMatch(/3 rows/);
  });

  it('toggles to CSV → JSON mode and parses rows back into objects', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json-csv" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    await user.selectOptions(screen.getByTestId('json-csv-mode'), 'csv-to-json');
    await waitFor(() => {
      const output = (screen.getByTestId('json-csv-output') as HTMLTextAreaElement).value;
      expect(output).toContain('"name": "Alice"');
    });
  });

  it('switches the delimiter to tab and re-emits a TSV', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json-csv" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    await user.selectOptions(screen.getByTestId('json-csv-delimiter'), '\t');
    await waitFor(() => {
      const output = (screen.getByTestId('json-csv-output') as HTMLTextAreaElement).value;
      expect(output.includes('\t')).toBe(true);
    });
  });
});

describe('MarkdownPreviewPanel', () => {
  it('renders the seeded Markdown into sanitized HTML', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="markdown-preview" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    await screen.findByTestId('markdown-preview-rendered');
    const html = (
      (await screen.findByTestId('markdown-preview-html')) as HTMLTextAreaElement
    ).value;
    expect(html).toContain('<h1>Hello, Lingua</h1>');
    expect(html).toContain('<strong>Markdown Preview</strong>');
  });

  it('toggles GFM off and continues to render plain Markdown', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="markdown-preview" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    await screen.findByTestId('markdown-preview-html');
    fireEvent.click(screen.getByTestId('markdown-preview-gfm'));
    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview-html')).toBeTruthy();
    });
  });
});

describe('SqlFormatterPanel', () => {
  it(
    'renders the dialect select and lets the user format the seeded statement',
    async () => {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="sql-formatter" />);
      await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
      // The dialect select renders synchronously even while the format
      // promise is in flight; use it as the deterministic mount anchor.
      await screen.findByTestId('sql-formatter-dialect', undefined, { timeout: 5000 });
      expect(
        (screen.getByTestId('sql-formatter-input') as HTMLTextAreaElement).value,
      ).toContain('select');
      await waitFor(
        () => {
          const text = (screen.getByTestId('sql-formatter-output') as HTMLTextAreaElement).value;
          expect(text.length).toBeGreaterThan(0);
          expect(text).toContain('SELECT');
        },
        { timeout: 8000 },
      );
    },
    10_000,
  );

  it('localizes the dialect label set to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="sql-formatter" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const select = (await screen.findByTestId('sql-formatter-dialect', undefined, {
      timeout: 5000,
    })) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('PostgreSQL');
    expect(labels).toContain('MySQL');
    expect(labels).toContain('ANSI estándar');
  });
});
