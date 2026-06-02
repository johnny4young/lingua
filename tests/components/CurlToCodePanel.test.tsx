/**
 * RL-070 — CurlToCodePanel tests. Helper coverage lives in
 * tests/utils/curlToCode.test.ts; this suite focuses on wiring:
 * default target + output, target swap re-renders, error banner
 * for an invalid command, warnings surface for unknown flags, ES
 * locale.
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

describe('CurlToCodePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to the fetch target and renders a POST body from the seeded cURL', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect((screen.getByTestId('curl-to-code-target') as HTMLSelectElement).value).toBe('fetch');
    const output = (screen.getByTestId('curl-to-code-output') as HTMLTextAreaElement).value;
    expect(output).toContain('await fetch("https://api.example.com/users"');
    expect(output).toContain('method: "POST"');
    expect(output).toContain('"Content-Type": "application/json"');
  });

  it('re-renders in Python when the target switches to requests', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('curl-to-code-target'), 'requests');

    await waitFor(() => {
      const output = (screen.getByTestId('curl-to-code-output') as HTMLTextAreaElement).value;
      expect(output).toContain('import requests');
      expect(output).toContain('requests.request("POST", "https://api.example.com/users"');
    });
  });

  it('re-renders as Go when the target switches to net-http', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('curl-to-code-target'), 'net-http');

    await waitFor(() => {
      const output = (screen.getByTestId('curl-to-code-output') as HTMLTextAreaElement).value;
      expect(output).toContain('package main');
      expect(output).toContain('http.NewRequest("POST"');
    });
  });

  it('shows the error banner for an unclosed quote input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('curl-to-code-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'curl -H "unclosed' } });

    await waitFor(() => {
      expect(screen.getByText(/Could not parse the cURL command/)).toBeTruthy();
      expect(screen.queryByTestId('curl-to-code-output')).toBeNull();
    });
  });

  it('surfaces warnings when the input contains an unknown flag', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('curl-to-code-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'curl --retry 3 https://api.example.com/health' } });

    await waitFor(() => {
      expect(screen.getByTestId('curl-to-code-warnings')).toBeTruthy();
      const output = (screen.getByTestId('curl-to-code-output') as HTMLTextAreaElement).value;
      expect(output).toContain('// Unknown flag ignored: --retry');
    });
  });

  it('localizes the target dropdown to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="curl-to-code" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const select = screen.getByTestId('curl-to-code-target') as HTMLSelectElement;
    const labels = Array.from(select.options).map((opt) => opt.textContent);
    expect(labels).toContain('fetch (navegador)');
    expect(labels).toContain('requests (Python)');
  });
});
