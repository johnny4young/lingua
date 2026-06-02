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

// formatSource dynamic-imports Prettier; stub it to avoid that in unit tests.
vi.mock('../../src/renderer/utils/formatters', () => ({
  formatSource: vi.fn(async (language: string, source: string) => {
    if (source.trim() === '') return { ok: true, formatted: '', changed: false };
    if (language === 'html' || language === 'xml') {
      // Cheap stand-in: wrap tags onto their own lines so the test can assert
      // the beautify path ran without importing Prettier in unit tests.
      const formatted = source.replace(/></g, '>\n<');
      return { ok: true, formatted, changed: formatted !== source };
    }
    if (language === 'css' || language === 'scss' || language === 'less') {
      // Cheap stand-in for the CSS family: insert a newline after `{`
      // and before `}` so the test can assert "beautify ran" without
      // importing Prettier.
      const formatted = source.replace(/\{/g, '{\n  ').replace(/\}/g, '\n}');
      return { ok: true, formatted, changed: formatted !== source };
    }
    try {
      const parsed = JSON.parse(source);
      return { ok: true, formatted: JSON.stringify(parsed, null, 2), changed: true };
    } catch (error) {
      return {
        ok: false,
        failure: 'parse-error' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }),
}));

describe('BeautifyMinifyUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('beautifies the initial JSON input and shows the indented output', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
    await waitFor(() => {
      expect(output.value).toContain('"greeting"');
      expect(output.value).toContain('\n  ');
    });
  });

  it('minify mode compacts the seeded JSON into the standard minified form', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      expect(output.value).toBe('{"greeting":"Hello, World!","count":3}');
    });
  });

  it('shows the parseError copy when the JSON input is malformed', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');
    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    await user.clear(input);
    // userEvent treats `{` as a keysym sequence — escape with double brace.
    await user.type(input, '{{ not: json }');

    expect(
      await screen.findByText(/Could not parse the input under the selected language/)
    ).toBeTruthy();
  });

  it('switching language resets an existing error banner when the new language accepts the input', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');
    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'export const x = 1;' } });
    // Valid JS, invalid JSON → parse error in JSON mode.
    expect(
      await screen.findByText(/Could not parse the input under the selected language/),
    ).toBeTruthy();

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'javascript');
    // Terser parses the same source cleanly → the banner disappears.
    await waitFor(() => {
      expect(
        screen.queryByText(/Could not parse the input under the selected language/),
      ).toBeNull();
    });
  });

  it('renders Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(
      screen.getByRole('heading', { level: 3, name: /Embellecer \/ Minificar/ })
    ).toBeTruthy();
  });

  it('lists the full 7-language set in order (JSON, JS, HTML, CSS, SCSS, LESS, XML)', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const select = screen.getByTestId('beautify-minify-language') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toEqual(['json', 'javascript', 'html', 'css', 'scss', 'less', 'xml']);
  });

  it('beautifies HTML through formatSource when the HTML language is picked', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'html');
    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    // fireEvent.change skips the per-keystroke useEffect re-runs that a
    // user.type() would cause — much faster and deterministic for a 20+ char
    // payload that has no need for keystroke fidelity.
    fireEvent.change(input, { target: { value: '<div><span>hi</span></div>' } });

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      // The stub wraps each `><` boundary onto its own line; asserting the
      // newline shape proves the HTML branch of formatSource was hit.
      expect(output.value).toContain('<span>hi</span>');
      expect(output.value).toContain('\n');
    });
  });

  it('minifies HTML using the real minifier and shows the html hint', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'html');
    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: '<div>  <span>hi</span>  </div>' },
    });

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      expect(output.value).toBe('<div><span>hi</span></div>');
    });

    // The honesty hint surfaces specifically for HTML minify mode.
    expect(screen.getByText(/pre, textarea, script/)).toBeTruthy();
  });

  it('minifies CSS using the real minifier and shows the css hint', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'css');
    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: '/* note */ .x { color: red; }' },
    });

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      expect(output.value).toBe('.x{color:red}');
    });

    expect(screen.getByText(/url\(\) values are preserved/)).toBeTruthy();
  });

  it('minifies XML using the real minifier and shows the xml hint', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'xml');
    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: '<!-- note --><root>\n  <child>hi</child>\n</root>' },
    });

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      expect(output.value).toBe('<root><child>hi</child></root>');
    });

    expect(screen.getByText(/CDATA sections/)).toBeTruthy();
  });
});
