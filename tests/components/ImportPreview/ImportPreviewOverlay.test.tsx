/**
 * RL-100 Slice 1 — `<ImportPreviewOverlay>` tests.
 *
 * Drives the overlay from the user-event perspective: empty state,
 * paste a valid cURL, confirm, see the new request in the workspace
 * store, ES locale render.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { ImportPreviewOverlay } from '../../../src/renderer/components/ImportPreview/ImportPreviewOverlay';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../../src/renderer/stores/workspaceToolStore';

beforeEach(() => {
  localStorage.clear();
  useWorkspaceToolStore.setState({
    requests: [],
    activeRequestId: null,
    responsesByRequestId: {},
    isExecutingActive: false,
  });
  useUIStore.setState({ activeBottomPanel: 'console', statusNotice: null });
  // Reset to EN before each test so a previous ES test doesn't bleed in.
  void i18next.changeLanguage('en');
});

describe('ImportPreviewOverlay', () => {
  it('renders the empty state with the description hint', () => {
    render(<ImportPreviewOverlay onClose={() => {}} />);
    expect(screen.getByTestId('import-preview-overlay')).toBeTruthy();
    expect(screen.getByTestId('import-preview-empty')).toBeTruthy();
    // Confirm starts disabled when nothing is parsed yet.
    const confirm = screen.getByTestId('import-preview-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('shows the preview band after pasting a valid cURL', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste('curl -X GET https://api.example.com/users');
    await waitFor(() => {
      expect(screen.queryByTestId('import-preview-body')).toBeTruthy();
    });
    expect(screen.getByTestId('import-preview-method').textContent).toContain('GET');
  });

  it('shows the reject band when source does not match any importer', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste('not a curl command');
    await waitFor(() => {
      const reject = screen.queryByTestId('import-preview-reject');
      expect(reject).toBeTruthy();
      expect(reject?.getAttribute('data-reject-reason')).toBe('unrecognized-format');
    });
  });

  it('shows the warning band for lossy cURL flags (fold C)', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste('curl -u user:pass https://api.example.com/me');
    await waitFor(() => {
      expect(screen.queryByTestId('import-preview-warnings')).toBeTruthy();
    });
  });

  it('redacts sensitive headers in the preview (fold D)', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(
      'curl -H "Authorization: Bearer xyz" https://api.example.com/me'
    );
    await waitFor(() => {
      expect(screen.queryByTestId('import-preview-redacted-hint')).toBeTruthy();
    });
    const headers = screen.getByTestId('import-preview-headers');
    expect(headers.textContent).toContain('<redacted>');
    expect(headers.textContent).not.toContain('Bearer xyz');
  });

  it('confirm writes the new request + flips bottom-panel + closes (fold G)', async () => {
    let closed = false;
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => (closed = true)} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste('curl -X POST https://api.example.com/items -d \'{"a":1}\'');
    await waitFor(() => {
      const btn = screen.getByTestId('import-preview-confirm') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    await user.click(screen.getByTestId('import-preview-confirm'));
    expect(closed).toBe(true);
    const requests = useWorkspaceToolStore.getState().requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(useUIStore.getState().activeBottomPanel).toBe('http');
  });

  it('cancel button closes without writing to the workspace store', async () => {
    let closed = false;
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => (closed = true)} />);
    await user.click(screen.getByTestId('import-preview-cancel'));
    expect(closed).toBe(true);
    expect(useWorkspaceToolStore.getState().requests).toHaveLength(0);
  });

  it('renders Spanish copy when i18next is set to es (tuteo)', async () => {
    await i18next.changeLanguage('es');
    render(<ImportPreviewOverlay onClose={() => {}} />);
    // Title in ES uses tuteo: "Importa datos" not "Importá datos".
    expect(screen.getByText(/Importa datos/i)).toBeTruthy();
    expect(screen.queryByText(/Importá datos/i)).toBeNull();
    // Cancel button copy.
    expect(screen.getByText(/^Cancelar$/i)).toBeTruthy();
  });
});
