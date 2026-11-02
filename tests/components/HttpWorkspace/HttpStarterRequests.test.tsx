import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { HttpStarterRequests } from '../../../src/renderer/components/HttpWorkspace/HttpStarterRequests';

describe('HttpStarterRequests', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('fills a GET or a POST with a JSON body', () => {
    const onApply = vi.fn();
    render(<HttpStarterRequests onApply={onApply} />);
    fireEvent.click(screen.getByTestId('http-starter-get-json'));
    expect(onApply).toHaveBeenLastCalledWith({ method: 'GET', url: 'https://httpbin.org/json', headers: [], body: { kind: 'none' } });
    fireEvent.click(screen.getByTestId('http-starter-post-json'));
    expect(onApply.mock.lastCall![0]).toMatchObject({
      method: 'POST',
      headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
      body: { kind: 'json' },
    });
  });

  it('focuses the URL field for a pasted cURL command', () => {
    render(
      <>
        <input data-testid="http-request-editor-url" />
        <HttpStarterRequests onApply={vi.fn()} />
      </>
    );
    fireEvent.click(screen.getByTestId('http-starter-paste-curl'));
    expect(document.activeElement).toBe(screen.getByTestId('http-request-editor-url'));
  });
});
