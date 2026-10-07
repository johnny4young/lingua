import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { CapsuleImportPreview } from '../../../src/renderer/components/CapsuleImport/CapsuleImportPreview';
import {
  buildCapsuleWorkspace,
  verifyCapsuleWorkspaceFiles,
  type CapsuleWorkspaceFileIntegrity,
} from '../../../src/shared/capsuleWorkspace';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';

vi.mock('../../../src/shared/capsuleWorkspace', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/shared/capsuleWorkspace')>()),
  verifyCapsuleWorkspaceFiles: vi.fn(),
}));
const verify = vi.mocked(verifyCapsuleWorkspaceFiles);
const built = await buildCapsuleWorkspace(FIXTURE_MINIMAL_JS, [
  { path: 'helper.ts', language: 'typescript', content: 'export const n = 1;' },
]);
if (!built.ok) throw new Error(built.reason);
const workspace = built.value;
function props(value = workspace) {
  return { capsule: value.capsule, workspace: value, byteLength: 1000 };
}
function showFiles() {
  fireEvent.click(screen.getByTestId('capsule-import-preview-tab-files'));
}
beforeEach(() => verify.mockReset());
afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('attached-file verification preview', () => {
  it.each(['en', 'es'])(
    'renders verified, mismatch and unavailable states in %s without opening files',
    async locale => {
      await i18next.changeLanguage(locale);
      const onOpen = vi.fn();
      verify.mockResolvedValue([{ path: 'helper.ts', status: 'verified' }]);
      const view = render(<CapsuleImportPreview {...props()} onOpenWorkspaceFile={onOpen} />);
      showFiles();
      await waitFor(() =>
        expect(screen.getByTestId('capsule-workspace-file-integrity').textContent).toBe(
          i18next.t('capsuleImport.preview.files.integrity.verified')
        )
      );
      for (const status of ['mismatch', 'not-verified'] as const) {
        verify.mockResolvedValue([{ path: 'helper.ts', status }]);
        view.rerender(
          <CapsuleImportPreview {...props({ ...workspace })} onOpenWorkspaceFile={onOpen} />
        );
        await waitFor(() =>
          expect(screen.getByTestId('capsule-workspace-file-integrity').textContent).toBe(
            i18next.t(`capsuleImport.preview.files.integrity.${status}`)
          )
        );
      }
      expect(onOpen).not.toHaveBeenCalled();
      expect(
        screen.getByText(i18next.t('capsuleImport.preview.files.integrityTrust'))
      ).toBeTruthy();
      fireEvent.click(screen.getByTestId('capsule-workspace-viewer-open-file'));
      expect(onOpen).toHaveBeenCalledExactlyOnceWith(workspace.files[0]);
    }
  );
  it('starts checking at import and ignores late results for replaced workspaces', async () => {
    let finishOld!: (files: readonly CapsuleWorkspaceFileIntegrity[]) => void;
    let finishNew!: (files: readonly CapsuleWorkspaceFileIntegrity[]) => void;
    verify
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishNew = resolve;
          })
      );
    const view = render(<CapsuleImportPreview {...props()} />);
    expect(verify).toHaveBeenCalledExactlyOnceWith(workspace);
    showFiles();
    expect(screen.getByTestId('capsule-workspace-file-integrity').textContent).toBe(
      i18next.t('capsuleImport.preview.files.integrity.pending')
    );
    view.rerender(<CapsuleImportPreview {...props({ ...workspace })} />);
    await act(async () => finishNew([{ path: 'helper.ts', status: 'mismatch' }]));
    await act(async () => finishOld([{ path: 'helper.ts', status: 'verified' }]));
    expect(screen.getByTestId('capsule-workspace-file-integrity').textContent).toBe(
      i18next.t('capsuleImport.preview.files.integrity.mismatch')
    );
  });
  it('does not verify a single-source capsule', () => {
    render(<CapsuleImportPreview capsule={FIXTURE_MINIMAL_JS} byteLength={100} />);
    expect(verify).not.toHaveBeenCalled();
  });
});
