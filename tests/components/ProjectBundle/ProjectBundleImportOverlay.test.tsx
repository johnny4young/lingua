/**
 * implementation — tests for the project bundle import overlay.
 * Exercises the empty state, file-pick → preview, the malformed reject
 * banner, the disabled-until-valid Import CTA, the confirm → hook call,
 * and an ES-locale render.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { strToU8 } from 'fflate';
import { packBundle } from '../../../src/shared/projectBundle';

const { importProjectBundle, exportProjectBundle } = vi.hoisted(() => ({
  importProjectBundle: vi.fn().mockResolvedValue(undefined),
  exportProjectBundle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/renderer/hooks/useProjectBundle', () => ({
  useProjectBundle: () => ({ importProjectBundle, exportProjectBundle }),
}));

import { ProjectBundleImportOverlay } from '../../../src/renderer/components/ProjectBundle/ProjectBundleImportOverlay';

function validBundleFile(): File {
  const zip = packBundle(
    [
      { path: 'index.js', bytes: strToU8('console.log(1)') },
      { path: 'src/lib.ts', bytes: strToU8('export const x = 1;') },
    ],
    { createdAt: '2026-05-30T00:00:00.000Z', entryFile: 'index.js' }
  );
  return new File([zip], 'project.zip', { type: 'application/zip' });
}

beforeEach(() => {
  importProjectBundle.mockClear();
  exportProjectBundle.mockClear();
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('internal — ProjectBundleImportOverlay', () => {
  it('renders the empty state with a disabled Import CTA', () => {
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('project-bundle-import-empty')).toBeTruthy();
    const cta = screen.getByTestId('project-bundle-import-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('gives the drop-zone affordance a visible keyboard focus ring (accessibility pass)', () => {
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    expect(
      screen.getByTestId('project-bundle-import-open-file').className
    ).toContain('focus-ring');
  });

  it('previews a valid bundle, enables Import, and forwards the bytes on confirm', async () => {
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    const input = screen.getByTestId('project-bundle-import-file-input');
    fireEvent.change(input, { target: { files: [validBundleFile()] } });

    await waitFor(() =>
      expect(screen.getByTestId('project-bundle-import-preview')).toBeTruthy()
    );
    expect(screen.getByText('index.js')).toBeTruthy();
    expect(screen.getByText('src/lib.ts')).toBeTruthy();

    const cta = screen.getByTestId('project-bundle-import-cta') as HTMLButtonElement;
    await waitFor(() => expect(cta.disabled).toBe(false));
    fireEvent.click(cta);
    await waitFor(() => expect(importProjectBundle).toHaveBeenCalledTimes(1));
    expect(importProjectBundle.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
  });

  it('shows the reject banner for a malformed (non-zip) file', async () => {
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    const input = screen.getByTestId('project-bundle-import-file-input');
    const bad = new File([strToU8('not a zip')], 'bad.zip', {
      type: 'application/zip',
    });
    fireEvent.change(input, { target: { files: [bad] } });

    await waitFor(() =>
      expect(screen.getByTestId('project-bundle-import-reject')).toBeTruthy()
    );
    expect(
      screen.getByTestId('project-bundle-import-reject').getAttribute('data-reason')
    ).toBe('malformed-zip');
    const cta = screen.getByTestId('project-bundle-import-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('shows the reject banner when the selected file cannot be read', async () => {
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    const input = screen.getByTestId('project-bundle-import-file-input');
    const unreadable = validBundleFile();
    vi.spyOn(unreadable, 'arrayBuffer').mockRejectedValue(new Error('denied'));
    fireEvent.change(input, { target: { files: [unreadable] } });

    await waitFor(() =>
      expect(screen.getByTestId('project-bundle-import-reject')).toBeTruthy()
    );
    expect(
      screen.getByTestId('project-bundle-import-reject').getAttribute('data-reason')
    ).toBe('malformed-zip');
    expect(importProjectBundle).not.toHaveBeenCalled();
  });

  it('renders the title in Spanish (tuteo) under the es locale', async () => {
    await i18next.changeLanguage('es');
    render(<ProjectBundleImportOverlay onClose={vi.fn()} />);
    expect(screen.getByText('Importa un bundle de proyecto')).toBeTruthy();
  });
});
