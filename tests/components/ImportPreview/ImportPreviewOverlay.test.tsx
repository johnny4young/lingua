/**
 * RL-100 Slice 1 — `<ImportPreviewOverlay>` tests.
 *
 * Drives the overlay from the user-event perspective: empty state,
 * paste a valid cURL, confirm, see the new request in the workspace
 * store, ES locale render.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { ImportPreviewOverlay } from '../../../src/renderer/components/ImportPreview/ImportPreviewOverlay';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../../src/renderer/stores/workspaceToolStore';
import {
  useEditorStore,
  HTTP_WORKSPACE_TAB_ID,
} from '../../../src/renderer/stores/editorStore';

beforeEach(() => {
  localStorage.clear();
  useWorkspaceToolStore.setState({
    requests: [],
    activeRequestId: null,
    responsesByRequestId: {},
    isExecutingActive: false,
  });
  // MOV.02 (FASE 3) — the cURL import now opens a full-screen HTTP
  // tab via the editor store, which enforces the tab budget. Reset
  // the editor tab list so a leaked tab from a prior test can't push
  // a fresh single-tab import past the Free ceiling.
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useUIStore.setState({ activeBottomPanel: 'console', statusNotice: null });
  useSettingsStore.setState({ importPreviewClipboardOnFocusConsent: 'unset' });
  // Reset to EN before each test so a previous ES test doesn't bleed in.
  void i18next.changeLanguage('en');
});

describe('ImportPreviewOverlay', () => {
  it('renders the empty state with the description hint', () => {
    render(<ImportPreviewOverlay onClose={() => {}} />);
    expect(screen.getByTestId('import-preview-overlay')).toBeTruthy();
    expect(screen.getByTestId('import-preview-empty')).toBeTruthy();
    expect(screen.getByTestId('import-preview-empty').textContent).toMatch(
      /Postman/i
    );
    expect(screen.getByTestId('import-preview-empty').textContent).toMatch(
      /Bruno/i
    );
    expect(screen.getByTestId('import-preview-pick-file').textContent).toMatch(
      /Postman/i
    );
    expect(screen.getByTestId('import-preview-pick-file').textContent).toMatch(
      /Bruno/i
    );
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

  it('confirm writes the request + opens a full-screen HTTP tab + closes (fold G, MOV.02)', async () => {
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
    // SQL/HTTP MODEL rework — the imported request lands in the HTTP
    // collection (its own id); a single HTTP workspace tab (stable id)
    // is opened/focused and active. The rail selects the imported
    // request — the workspace tab id is NOT the request id.
    const { tabs, activeTabId } = useEditorStore.getState();
    const httpTabs = tabs.filter((tab) => tab.kind === 'http');
    expect(httpTabs).toHaveLength(1);
    expect(httpTabs[0]?.id).toBe(HTTP_WORKSPACE_TAB_ID);
    expect(activeTabId).toBe(HTTP_WORKSPACE_TAB_ID);
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(
      requests[0]?.id
    );
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

describe('ImportPreviewOverlay — ipynb arm (RL-100 Slice 2)', () => {
  const sampleIpynb = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Hello'] },
      { cell_type: 'code', source: ["print('hi')"], outputs: [] },
    ],
  });

  it('renders the notebook preview band on paste', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(sampleIpynb);
    await waitFor(() => {
      const body = screen.getByTestId('import-preview-body');
      expect(body.getAttribute('data-preview-kind')).toBe('ipynb-notebook');
    });
    expect(screen.getByTestId('import-preview-notebook-summary').textContent).toMatch(
      /2 cells/
    );
  });

  it('flips the confirm button label to the notebook variant (fold C)', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(sampleIpynb);
    await waitFor(() => {
      const btn = screen.getByTestId('import-preview-confirm');
      expect(btn.textContent).toMatch(/Import as notebook/i);
    });
  });

  it('shows the ipynb-specific reject hint for nbformat: 3', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(JSON.stringify({ nbformat: 3, cells: [] }));
    await waitFor(() => {
      expect(screen.getByTestId('import-preview-reject-detail')).toBeTruthy();
    });
    expect(
      screen.getByTestId('import-preview-reject-detail').textContent
    ).toMatch(/v4/i);
  });

  it('ignores unrelated JSON on clipboard auto-detect instead of labeling it .ipynb', async () => {
    const readText = vi.fn().mockResolvedValue('{"hello":"world"}');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
    useSettingsStore.setState({ importPreviewClipboardOnFocusConsent: 'granted' });

    render(<ImportPreviewOverlay onClose={() => {}} />);

    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId('import-preview-paste') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('import-preview-empty')).toBeTruthy();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});

describe('ImportPreviewOverlay — collection arm (RL-100 Slice 3)', () => {
  const samplePostman = JSON.stringify({
    info: {
      name: 'Demo API',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      { name: 'List', request: { method: 'GET', url: 'https://x.dev/items' } },
      { name: 'Create', request: { method: 'POST', url: 'https://x.dev/items' } },
    ],
  });

  it('renders the collection preview band + summary on paste', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(samplePostman);
    await waitFor(() => {
      const body = screen.getByTestId('import-preview-body');
      expect(body.getAttribute('data-preview-kind')).toBe('http-collection');
      expect(body.getAttribute('data-collection-source')).toBe('postman');
    });
    expect(
      screen.getByTestId('import-preview-collection-summary').textContent
    ).toMatch(/2 requests/);
    expect(
      screen.getByTestId('import-preview-collection-requests').children.length
    ).toBe(2);
  });

  it('surfaces a resolved-variables chip when collection vars are substituted (fold C)', async () => {
    const withVars = JSON.stringify({
      info: {
        name: 'Var API',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [{ key: 'base_url', value: 'api.example.com' }],
      item: [
        { name: 'List', request: { method: 'GET', url: 'https://{{base_url}}/items' } },
      ],
    });
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(withVars);
    await waitFor(() => {
      const chip = screen.getByTestId('import-preview-collection-variables');
      expect(chip.textContent).toMatch(/1 variable resolved/i);
    });
    // The substituted URL reaches the request row, not the placeholder.
    expect(
      screen.getByTestId('import-preview-collection-requests').textContent
    ).toMatch(/api\.example\.com/);
  });

  it('flips the confirm label to the collection variant with the count (fold C)', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(samplePostman);
    await waitFor(() => {
      const btn = screen.getByTestId('import-preview-confirm');
      expect(btn.textContent).toMatch(/Import 2 requests/i);
    });
  });

  it('shows the postman-specific reject hint for a v2.0 schema', async () => {
    const user = userEvent.setup();
    render(<ImportPreviewOverlay onClose={() => {}} />);
    const paste = screen.getByTestId('import-preview-paste') as HTMLTextAreaElement;
    await user.click(paste);
    await user.paste(
      JSON.stringify({
        info: { name: 'Old', schema: 'v1.0.0' },
        item: [],
      })
    );
    await waitFor(() => {
      expect(screen.getByTestId('import-preview-reject-detail')).toBeTruthy();
    });
    expect(
      screen.getByTestId('import-preview-reject-detail').textContent
    ).toMatch(/v2\.1/i);
  });

  it('labels Postman clipboard auto-detect as Postman, not Jupyter', async () => {
    const readText = vi.fn().mockResolvedValue(samplePostman);
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
    useSettingsStore.setState({ importPreviewClipboardOnFocusConsent: 'granted' });

    render(<ImportPreviewOverlay onClose={() => {}} />);

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'importPreview.notice.clipboardAutoDetected'
      );
    });
    expect(useUIStore.getState().statusNotice?.values).toMatchObject({
      format: 'Postman collection',
    });
  });
});
