import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ResultHeader } from '../../../src/renderer/components/ui/ResultHeader';
import { HttpStatusPill } from '../../../src/renderer/components/HttpWorkspace/HttpStatusPill';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

describe('ResultHeader meta line', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('keeps timing and size on one line and lets the status shrink first', () => {
    render(<ResultHeader status={<span data-testid="status">200 OK</span>} meta="385 ms · 5.6 KiB" />);
    const meta = screen.getByText('385 ms · 5.6 KiB');
    expect(meta.className).toContain('whitespace-nowrap');
    expect(meta.className).toContain('tabular-nums');
    expect(meta.className).toContain('shrink-0');
    expect(screen.getByTestId('status').parentElement?.className).toContain('min-w-0');
  });

  it('truncates a long HTTP status text with the full text as a tooltip', () => {
    const response = {
      kind: 'http',
      status: 503,
      statusText: 'Service Unavailable Because The Upstream Gateway Timed Out',
    } as unknown as HttpResponseV1;
    render(<HttpStatusPill response={response} />);
    const pill = screen.getByTestId('http-status-pill');
    expect(pill.getAttribute('title')).toBe(`503 ${response.statusText}`);
    expect(pill.querySelector('.truncate')?.textContent).toBe(`503 ${response.statusText}`);
  });
});
