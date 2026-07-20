/**
 * internal — HtmlToJsxPanel tests. Helper coverage lives in
 * tests/utils/htmlToJsx.test.ts; this suite focuses on wiring:
 * default output render, fragment-wrap toggle, error banner, ES
 * locale.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('HtmlToJsxPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders the seeded output with className and a JSX comment', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-to-jsx" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const output = (screen.getByTestId('html-to-jsx-output') as HTMLTextAreaElement).value;
    expect(output).toContain('className="card"');
    expect(output).toContain('htmlFor="name"');
    expect(output).toContain('<br />');
    expect(output).toContain('{/* a comment */}');
    expect(output).toContain('style={{ color: "red", margin: "10px" }}');
  });

  it('reports the root-count status line', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-to-jsx" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.getByTestId('html-to-jsx-root-count').textContent).toMatch(/1 root/);
  });

  it('surfaces the empty-state hint when the input is cleared', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-to-jsx" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const input = screen.getByTestId('html-to-jsx-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '' } });

    await waitFor(() => {
      expect(
        screen.getByText(/Paste HTML markup above to see the JSX output/),
      ).toBeTruthy();
      expect(screen.queryByTestId('html-to-jsx-output')).toBeNull();
    });
  });

  it('wraps multi-root input in a fragment and unwraps when the toggle flips off', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-to-jsx" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const input = screen.getByTestId('html-to-jsx-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '<p>a</p><p>b</p>' } });

    await waitFor(() => {
      const output = (screen.getByTestId('html-to-jsx-output') as HTMLTextAreaElement).value;
      expect(output.startsWith('<>')).toBe(true);
      expect(output.endsWith('</>')).toBe(true);
    });

    const toggle = screen.getByTestId('html-to-jsx-wrap-fragment') as HTMLInputElement;
    fireEvent.click(toggle);

    await waitFor(() => {
      const output = (screen.getByTestId('html-to-jsx-output') as HTMLTextAreaElement).value;
      expect(output.startsWith('<>')).toBe(false);
    });
  });

  it('localizes the panel heading to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-to-jsx" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(
      screen.getByRole('heading', { level: 3, name: /Conversor de HTML a JSX/ }),
    ).toBeTruthy();
  });
});
