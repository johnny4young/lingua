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
    if (language === 'html') {
      // Cheap stand-in: wrap tags onto their own lines so the test can assert
      // the beautify path ran without importing Prettier in unit tests.
      const formatted = source.replace(/></g, '>\n<');
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

    const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
    await waitFor(() => {
      expect(output.value).toContain('"greeting"');
      expect(output.value).toContain('\n  ');
    });
  });

  it('minify mode compacts JSON and hides the JS hint', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    await waitFor(() => {
      const output = screen.getByTestId('beautify-minify-output') as HTMLTextAreaElement;
      expect(output.value).toBe('{"greeting":"Hello, World!","count":3}');
    });
    expect(screen.queryByText(/whitespace-only/)).toBeNull();
  });

  it('shows the parseError copy when the JSON input is malformed', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');
    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    await user.clear(input);
    // userEvent treats `{` as a keysym sequence — escape with double brace.
    await user.type(input, '{{ not: json }');

    expect(
      await screen.findByText(/Could not parse the input under the selected language/)
    ).toBeTruthy();
  });

  it('surfaces the whitespace-only hint when JS + minify are selected', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'javascript');
    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');

    expect(screen.getByText(/whitespace-only/)).toBeTruthy();
  });

  it('switching language resets an existing error banner', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    await user.selectOptions(screen.getByTestId('beautify-minify-mode'), 'minify');
    const input = screen.getByTestId('beautify-minify-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, '{{ broken');
    expect(
      await screen.findByText(/Could not parse the input under the selected language/)
    ).toBeTruthy();

    await user.selectOptions(screen.getByTestId('beautify-minify-language'), 'javascript');
    // With JS minify the same "{ broken" input now parses (as whitespace-only
    // JS, not strict JSON), so the error banner should disappear.
    await waitFor(() => {
      expect(
        screen.queryByText(/Could not parse the input under the selected language/)
      ).toBeNull();
    });
  });

  it('renders Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    expect(
      screen.getByRole('heading', { level: 3, name: /Embellecer \/ Minificar/ })
    ).toBeTruthy();
  });

  it('lists HTML as an available language', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

    const select = screen.getByTestId('beautify-minify-language') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toContain('html');
  });

  it('beautifies HTML through formatSource when the HTML language is picked', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="beautify-minify" />);

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
});
