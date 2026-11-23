import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeShowcase } from '../../../src/renderer/devShowcase/RecipeShowcase';

const root = document.documentElement;

// jsdom has no canvas; returning null skips the swatch readout without its not-implemented noise.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  root.className = '';
  root.style.colorScheme = '';
  document.head.querySelector('meta[name="theme-color"]')?.remove();
  for (const key of ['theme', 'palette', 'codeFont']) delete root.dataset[key];
});

describe('RecipeShowcase palette switch', () => {
  it('starts on the palette the boot script applied', () => {
    root.dataset.theme = 'dark';
    root.dataset.palette = 'ink';
    render(<RecipeShowcase />);
    expect(screen.getByTestId('showcase-palette-lingua-ink').getAttribute('aria-checked')).toBe('true');
    expect(root.dataset.codeFont).toBe('recursive');
  });

  it.each([
    ['lingua-light', 'light', undefined],
    ['lingua-dark', 'dark', undefined],
    ['lingua-paper', 'light', 'paper'],
    ['lingua-ink', 'dark', 'ink'],
  ])('%s sets the theme and data-palette together', (id, theme, palette) => {
    root.dataset.theme = 'dark';
    root.dataset.palette = 'ink';
    render(<RecipeShowcase />);
    fireEvent.click(screen.getByTestId(`showcase-palette-${id}`));
    expect(root.dataset.theme).toBe(theme);
    expect(root.classList.contains(theme)).toBe(true);
    expect(root.dataset.palette).toBe(palette);
    expect(root.dataset.codeFont).toBe(palette ? 'recursive' : undefined);
    const checked = within(screen.getByRole('radiogroup', { name: 'Palette' }))
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked.map((radio) => radio.dataset.testid)).toEqual([`showcase-palette-${id}`]);
  });
});

describe('RecipeShowcase recipes', () => {
  it('lists the palette tokens as swatches', () => {
    render(<RecipeShowcase />);
    const swatches = within(screen.getByTestId('showcase-swatches'));
    for (const name of ['ground', 'pulse', 'number', 'none']) expect(swatches.getByText(name)).toBeTruthy();
  });

  it('renders each result header as the numeral grammar with its views', () => {
    render(<RecipeShowcase />);
    const headers = within(screen.getByTestId('showcase-result-header')).getAllByTestId('result-header');
    expect(headers).toHaveLength(3);
    const http = headers[2];
    expect(within(http).getByTestId('result-header-workspace').textContent).toBe('HTTP');
    expect(within(http).getByTestId('result-header-numeral').textContent).toBe('200ok');
    fireEvent.click(within(http).getByRole('button', { name: 'Headers' }));
    expect(within(http).getByRole('button', { name: 'Headers' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('colours inline marker values by type', () => {
    render(<RecipeShowcase />);
    const values = within(screen.getByTestId('showcase-inline-markers')).getAllByTestId('inline-marker-value');
    expect(values.map((value) => value.dataset.tone)).toEqual(['number', 'number', 'string']);
  });
});
