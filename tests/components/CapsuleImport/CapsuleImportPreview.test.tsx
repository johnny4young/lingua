/**
 * implementation — tests for the pure preview component.
 * Asserts the metadata strip + tab switching + redacted banner.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapsuleImportPreview } from '../../../src/renderer/components/CapsuleImport/CapsuleImportPreview';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_LARGE_STDOUT,
} from '../../shared/runCapsule.fixtures';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';
import { buildCapsuleWorkspace } from '../../../src/shared/capsuleWorkspace';

describe('CapsuleImportPreview', () => {
  it('renders the metadata strip with language + runner + size', () => {
    render(
      <CapsuleImportPreview capsule={FIXTURE_MINIMAL_JS} byteLength={520} />
    );
    expect(
      screen.getByTestId('capsule-import-preview-metadata-language').textContent
    ).toContain('javascript');
    expect(
      screen.getByTestId('capsule-import-preview-metadata-runner')
    ).toBeTruthy();
    expect(
      screen.getByTestId('capsule-import-preview-metadata-size').textContent
    ).toContain('520');
  });

  it('starts on the Source tab and renders the source content', () => {
    render(
      <CapsuleImportPreview capsule={FIXTURE_MINIMAL_JS} byteLength={520} />
    );
    expect(
      screen.getByTestId('capsule-import-preview-panel-source')
    ).toBeTruthy();
    expect(
      screen.getByTestId('capsule-import-preview-source-content').textContent
    ).toContain(FIXTURE_MINIMAL_JS.source.content);
  });

  it('switches to Result tab on click', () => {
    render(
      <CapsuleImportPreview capsule={FIXTURE_MINIMAL_JS} byteLength={520} />
    );
    fireEvent.click(screen.getByTestId('capsule-import-preview-tab-result'));
    expect(
      screen.getByTestId('capsule-import-preview-panel-result')
    ).toBeTruthy();
  });

  it('switches to Environment tab on click', () => {
    render(
      <CapsuleImportPreview capsule={FIXTURE_MINIMAL_JS} byteLength={520} />
    );
    fireEvent.click(
      screen.getByTestId('capsule-import-preview-tab-environment')
    );
    expect(
      screen.getByTestId('capsule-import-preview-panel-environment')
    ).toBeTruthy();
  });

  it('shows supplemental Capsule Workspace files without executing them', async () => {
    const built = await buildCapsuleWorkspace(FIXTURE_MINIMAL_JS, [
      { path: 'src/helper.ts', language: 'typescript', content: 'export const n = 1;' },
      { path: 'README.md', language: 'markdown', content: '# Notes' },
    ]);
    if (!built.ok) throw new Error(built.reason);
    const onOpen = vi.fn();
    render(
      <CapsuleImportPreview
        capsule={built.value.capsule}
        workspace={built.value}
        byteLength={1000}
        onOpenWorkspaceFile={onOpen}
      />
    );
    fireEvent.click(screen.getByTestId('capsule-import-preview-tab-files'));
    expect(screen.getAllByTestId('capsule-workspace-viewer-file')).toHaveLength(2);
    expect(screen.getByTestId('capsule-workspace-viewer-content').textContent).toContain(
      'export const n = 1;'
    );
    fireEvent.click(screen.getAllByTestId('capsule-workspace-viewer-file')[1]!);
    expect(screen.getByTestId('capsule-workspace-viewer-content').textContent).toContain('# Notes');
    fireEvent.click(screen.getByTestId('capsule-workspace-viewer-open-file'));
    expect(onOpen).toHaveBeenCalledWith(built.value.files[1]);
  });

  it('surfaces the omitted-fields privacy banner when present (implementation note)', () => {
    const withOmitted: RunCapsuleV1 = {
      ...FIXTURE_LARGE_STDOUT,
      privacy: {
        redactionVersion: FIXTURE_LARGE_STDOUT.privacy.redactionVersion,
        omittedFields: ['result.stdout'],
      },
    };
    render(<CapsuleImportPreview capsule={withOmitted} byteLength={2000} />);
    expect(
      screen.getByTestId('capsule-import-preview-omitted-banner')
    ).toBeTruthy();
  });

  it('renders truncated marker on stdout when omittedFields lists it', () => {
    const withOmitted: RunCapsuleV1 = {
      ...FIXTURE_MINIMAL_JS,
      result: {
        ...FIXTURE_MINIMAL_JS.result,
        stdout: 'truncated',
      },
      privacy: {
        redactionVersion: FIXTURE_MINIMAL_JS.privacy.redactionVersion,
        omittedFields: ['result.stdout'],
      },
    };
    render(<CapsuleImportPreview capsule={withOmitted} byteLength={520} />);
    fireEvent.click(screen.getByTestId('capsule-import-preview-tab-result'));
    expect(
      screen.getByTestId('capsule-import-preview-result-stdout-truncated')
    ).toBeTruthy();
  });
});
