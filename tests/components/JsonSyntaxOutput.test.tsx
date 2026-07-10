import { render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonSyntaxOutput } from '../../src/renderer/components/DeveloperUtilities/JsonSyntaxOutput';
import { initI18n } from '../../src/renderer/i18n';

const monacoMock = vi.hoisted(() => {
  const colorizeElement = vi.fn(async (host: HTMLElement) => {
    const lines = (host.textContent ?? '').split('\n');
    host.replaceChildren();
    lines.forEach((line, index) => {
      const lineElement = document.createElement('span');
      const token = document.createElement('span');
      token.className = 'mtk11';
      token.textContent = line;
      lineElement.append(token);
      host.append(lineElement);
      if (index < lines.length - 1) host.append(document.createElement('br'));
    });
  });

  return {
    colorizeElement,
    monaco: {
      editor: {
        colorizeElement,
        colorize: vi.fn().mockResolvedValue(undefined),
        createModel: vi.fn(() => ({ dispose: vi.fn() })),
        defineTheme: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/renderer/monaco', () => ({
  getConfiguredMonaco: () => monacoMock.monaco,
}));

describe('JsonSyntaxOutput', () => {
  const originalCss = globalThis.CSS;

  beforeEach(async () => {
    monacoMock.colorizeElement.mockClear();
    initI18n('en');
    await i18next.changeLanguage('en');
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: originalCss,
    });
  });

  it('keeps multi-line timestamp offsets correct after Monaco inserts line breaks', async () => {
    render(
      <JsonSyntaxOutput
        ariaLabel="JSON output"
        testid="json-output"
        value={JSON.stringify({ sub: 'lingua', iat: 1783624472, exp: 1783624472 }, null, 2)}
      />
    );

    await waitFor(() => {
      expect(monacoMock.colorizeElement).toHaveBeenCalledTimes(1);
      expect(screen.getAllByTestId('json-timestamp-value').map(node => node.textContent)).toEqual([
        '1783624472',
        '1783624472',
      ]);
    });

    const output = screen.getByTestId('json-output');
    expect(output.querySelectorAll('.mtk11')).toHaveLength(5);
    expect(screen.getAllByText('Local time')).toHaveLength(2);
    expect(screen.getAllByText('UTC')).toHaveLength(2);
  });
});
