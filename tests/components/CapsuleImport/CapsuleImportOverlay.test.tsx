/**
 * RL-094 Slice 2 — tests for the import overlay.
 * Exercises paste decoding, file picker, reject banner, consent prompt,
 * cancel + confirm, and the Fold G HTTP capsule bridge.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapsuleImportOverlay } from '../../../src/renderer/components/CapsuleImport';
import { setPendingCapsuleImportSource } from '../../../src/renderer/clipboard/pendingCapsuleImport';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useWorkspaceToolStore } from '../../../src/renderer/stores/workspaceToolStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_FULL_TS,
} from '../../shared/runCapsule.fixtures';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';
import type { HttpRequestV1 } from '../../../src/shared/httpWorkspace';

const MINIMAL_JSON = JSON.stringify(FIXTURE_MINIMAL_JS);

function buildHttpCapsule(): RunCapsuleV1 {
  const httpRequest: HttpRequestV1 = {
    version: 1,
    id: '00000000-0000-4000-8000-000000000abc',
    name: 'demo GET',
    method: 'GET',
    url: 'https://api.example.com/users',
    headers: [],
    body: { kind: 'none' },
    timeoutMs: 30_000,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };
  return {
    ...FIXTURE_FULL_TS,
    tab: { ...FIXTURE_FULL_TS.tab, language: 'http' },
    source: {
      content: JSON.stringify(httpRequest),
      contentHash: 'abc',
    },
    environment: {
      ...FIXTURE_FULL_TS.environment,
      runner: 'http-client',
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({
    capsuleImportClipboardOnFocusConsent: 'unset',
  });
  useWorkspaceToolStore.setState({
    requests: [],
    responsesByRequestId: {},
    activeRequestId: null,
    isExecutingActive: false,
  });
  // Reviewer fix (RL-094 Slice 2 final pass) — clear any status notice
  // a sibling test may have left in `useUIStore`. `setState({})` was a
  // no-op (zustand merges by default). The notice slot is the only
  // ui-store field the overlay touches, so resetting it is enough.
  useUIStore.setState({ statusNotice: null });
});

describe('CapsuleImportOverlay', () => {
  it('renders the title + empty state initially', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    expect(screen.getByTestId('capsule-import-overlay')).toBeTruthy();
    expect(screen.getByTestId('capsule-import-empty')).toBeTruthy();
  });

  it('seeds initial focus on the paste textarea, not a close button (UX Sweep T3)', async () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    const textarea = screen.getByTestId('capsule-import-paste-textarea');
    // ModalShell focuses the first focusable in DOM order on the next frame;
    // with headerClose="esc" that is the paste textarea, not the header X.
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it('decodes a valid paste payload and unlocks the confirm button', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    const textarea = screen.getByTestId(
      'capsule-import-paste-textarea'
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: MINIMAL_JSON } });
    const confirm = screen.getByTestId(
      'capsule-import-overlay-confirm'
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(screen.getByTestId('capsule-import-preview')).toBeTruthy();
  });

  it('RL-110 fold E — decodes a smart-paste seed on mount (pre-filled preview)', async () => {
    setPendingCapsuleImportSource(MINIMAL_JSON);
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    // The preview + enabled confirm appear without any user interaction.
    expect(await screen.findByTestId('capsule-import-preview')).toBeTruthy();
    const confirm = screen.getByTestId(
      'capsule-import-overlay-confirm'
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    // The seed is one-shot: a second overlay opens empty.
    cleanup();
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    expect(screen.getByTestId('capsule-import-empty')).toBeTruthy();
  });

  it('shows the reject banner with the closed-enum reason on bad JSON', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    const textarea = screen.getByTestId(
      'capsule-import-paste-textarea'
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{nope' } });
    const reject = screen.getByTestId('capsule-import-reject');
    expect(reject.getAttribute('data-reason')).toBe('malformed-json');
  });

  it('opens the source as a new tab on confirm + fires onClose', () => {
    const onClose = vi.fn();
    render(<CapsuleImportOverlay onClose={onClose} />);
    fireEvent.change(screen.getByTestId('capsule-import-paste-textarea'), {
      target: { value: MINIMAL_JSON },
    });
    fireEvent.click(screen.getByTestId('capsule-import-overlay-confirm'));
    expect(useEditorStore.getState().tabs.length).toBe(1);
    expect(useEditorStore.getState().tabs[0]?.content).toBe(
      FIXTURE_MINIMAL_JS.source.content
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows clipboard consent prompt when consent is unset (Fold C)', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    expect(
      screen.getByTestId('capsule-import-clipboard-consent')
    ).toBeTruthy();
  });

  it('grant button flips the consent to granted', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId('capsule-import-clipboard-grant'));
    expect(
      useSettingsStore.getState().capsuleImportClipboardOnFocusConsent
    ).toBe('granted');
  });

  it('decline button flips the consent to declined', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId('capsule-import-clipboard-decline'));
    expect(
      useSettingsStore.getState().capsuleImportClipboardOnFocusConsent
    ).toBe('declined');
  });

  it('Cancel button calls onClose without pushing a tab', () => {
    const onClose = vi.fn();
    render(<CapsuleImportOverlay onClose={onClose} />);
    fireEvent.change(screen.getByTestId('capsule-import-paste-textarea'), {
      target: { value: MINIMAL_JSON },
    });
    fireEvent.click(screen.getByTestId('capsule-import-overlay-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.length).toBe(0);
  });

  it('Escape key closes the overlay', () => {
    const onClose = vi.fn();
    render(<CapsuleImportOverlay onClose={onClose} />);
    // Escape is owned by <ModalShell> (a React onKeyDown on the scrim),
    // so fire the key through the dialog rather than document.
    act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show Open-in-HTTP for non-http capsules', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('capsule-import-paste-textarea'), {
      target: { value: MINIMAL_JSON },
    });
    expect(
      screen.queryByTestId('capsule-import-overlay-open-http')
    ).toBeNull();
  });

  it('Fold G — HTTP capsule offers Open-in-HTTP-workspace + creates a request', async () => {
    const onClose = vi.fn();
    const httpCapsule = buildHttpCapsule();
    render(<CapsuleImportOverlay onClose={onClose} />);
    fireEvent.change(screen.getByTestId('capsule-import-paste-textarea'), {
      target: { value: JSON.stringify(httpCapsule) },
    });
    const httpButton = await screen.findByTestId(
      'capsule-import-overlay-open-http'
    );
    fireEvent.click(httpButton);
    await waitFor(() => {
      expect(useWorkspaceToolStore.getState().requests.length).toBe(1);
    });
    expect(useWorkspaceToolStore.getState().requests[0]?.url).toBe(
      'https://api.example.com/users'
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('Fold E — Copy source button is rendered when decoded', () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('capsule-import-paste-textarea'), {
      target: { value: MINIMAL_JSON },
    });
    expect(
      screen.getByTestId('capsule-import-overlay-copy-source')
    ).toBeTruthy();
  });

  it('drag-drop accepts a file and decodes it', async () => {
    render(<CapsuleImportOverlay onClose={() => undefined} />);
    const overlay = screen.getByTestId('capsule-import-overlay');
    const file = new File([MINIMAL_JSON], 'capsule.json', {
      type: 'application/json',
    });
    const dataTransfer = {
      files: [file],
      types: ['Files'],
    };
    fireEvent.drop(overlay, { dataTransfer });
    await waitFor(() => {
      expect(screen.getByTestId('capsule-import-preview')).toBeTruthy();
    });
  });
});
