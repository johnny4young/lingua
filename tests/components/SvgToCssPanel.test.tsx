/**
 * internal — SvgToCssPanel tests. The pure helper is covered in
 * tests/utils/svgToCss.test.ts, so this suite focuses on wiring: mode
 * toggle, live data-URI + CSS block outputs, size hint visibility,
 * error banner surfacing, CopyButton plumbing, ES locale.
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

describe('SvgToCssPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to Base64 mode and renders a full data-URI plus CSS block for the seeded SVG', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect((screen.getByTestId('svg-to-css-mode') as HTMLSelectElement).value).toBe('base64');

    const dataUri = (screen.getByTestId('svg-to-css-data-uri') as HTMLTextAreaElement).value;
    expect(dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);

    const cssBlock = (screen.getByTestId('svg-to-css-block') as HTMLTextAreaElement).value;
    expect(cssBlock).toContain('background-image: url("data:image/svg+xml;base64,');
    expect(cssBlock).toContain('background-size: 24px 24px;');
    expect(cssBlock).toContain('background-repeat: no-repeat;');

    expect(screen.getByTestId('svg-to-css-size').textContent).toContain('24');
  });

  it('switching to URL-encoded flips the data-URI prefix without mutating the input', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const inputBefore = (screen.getByTestId('svg-to-css-input') as HTMLTextAreaElement).value;

    await user.selectOptions(screen.getByTestId('svg-to-css-mode'), 'percent');

    await waitFor(() => {
      const dataUri = (screen.getByTestId('svg-to-css-data-uri') as HTMLTextAreaElement).value;
      expect(dataUri.startsWith('data:image/svg+xml,')).toBe(true);
      expect(dataUri.includes(';base64,')).toBe(false);
      expect(dataUri).toContain('%3Csvg');
    });

    expect((screen.getByTestId('svg-to-css-input') as HTMLTextAreaElement).value).toBe(inputBefore);
  });

  it('hides the size hint when the SVG root has no width/height and no viewBox', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const inputArea = screen.getByTestId('svg-to-css-input') as HTMLTextAreaElement;
    fireEvent.change(inputArea, {
      target: { value: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('svg-to-css-size')).toBeNull();
    });
    const cssBlock = (screen.getByTestId('svg-to-css-block') as HTMLTextAreaElement).value;
    expect(cssBlock.includes('background-size')).toBe(false);
  });

  it('shows the error banner when the input is not SVG', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const inputArea = screen.getByTestId('svg-to-css-input') as HTMLTextAreaElement;
    fireEvent.change(inputArea, { target: { value: 'definitely not svg' } });

    await waitFor(() => {
      expect(screen.queryByTestId('svg-to-css-data-uri')).toBeNull();
      expect(screen.queryByTestId('svg-to-css-block')).toBeNull();
      expect(screen.getByText(/Input does not contain an <svg> element/)).toBeTruthy();
    });
  });

  it('shows the empty hint when the textarea is cleared', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const inputArea = screen.getByTestId('svg-to-css-input') as HTMLTextAreaElement;
    fireEvent.change(inputArea, { target: { value: '' } });

    // Assert the empty-state swap atomically — hint appears AND the
    // output pane vanishes. Keeping the `queryByTestId` inside the
    // waitFor guards against any future debounce landing between the
    // input change and the re-render.
    await waitFor(() => {
      expect(
        screen.getByText(/Paste SVG markup above to see the CSS output/),
      ).toBeTruthy();
      expect(screen.queryByTestId('svg-to-css-data-uri')).toBeNull();
    });
  });

  it('localizes the mode selector and panel description to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="svg-to-css" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const select = screen.getByTestId('svg-to-css-mode') as HTMLSelectElement;
    const labels = Array.from(select.options).map((opt) => opt.textContent);
    expect(labels).toContain('Base64');
    expect(labels).toContain('URL-encoded');
    expect(
      screen.getByRole('heading', { level: 3, name: /Conversor de SVG a CSS/ }),
    ).toBeTruthy();
  });
});
