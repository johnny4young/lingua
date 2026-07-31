import type { ComponentType } from 'react';
import type { RunCapsuleV1 } from '../../../shared/runCapsule';

export interface RunCapsuleExportButtonProps {
  readonly capsule: RunCapsuleV1;
}

interface RunCapsuleExportButtonModule {
  RunCapsuleExportButton: ComponentType<RunCapsuleExportButtonProps>;
}

type CapsuleExporterModule = Pick<
  typeof import('../../utils/exportCapsule'),
  'exportCapsuleToClipboard'
>;

let buttonPromise: Promise<RunCapsuleExportButtonModule> | null = null;
let exporterPromise: Promise<CapsuleExporterModule> | null = null;

/**
 * Load the result-header control only after a captured capsule makes it useful.
 *
 * Failed module URLs stay cached for the current document because browsers do
 * the same. Recovery is a page reload rather than a retry that would repeat the
 * same rejected import.
 */
export function loadRunCapsuleExportButton(): Promise<RunCapsuleExportButtonModule> {
  buttonPromise ??= import('./RunCapsuleExportButton');
  return buttonPromise;
}

/**
 * Load the sanitizer, serializer, clipboard writer, and telemetry pipeline only
 * when an export action actually has a capsule to process.
 */
export function loadCapsuleExporter(): Promise<CapsuleExporterModule> {
  exporterPromise ??= import('../../utils/exportCapsule');
  return exporterPromise;
}
