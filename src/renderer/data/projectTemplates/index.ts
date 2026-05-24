// SPDX-License-Identifier: MIT
/**
 * Catalog of curated multi-file project templates (RL-103 Slice 1).
 *
 * The exported tuple is ordered: the renderer renders cards in this
 * exact order so dashboards stay readable and screenshots are
 * deterministic. The `PROJECT_TEMPLATE_IDS` constant mirrors the
 * order and is also re-used by `src/shared/telemetry.ts` as the
 * closed-enum allowlist for the `template_project_applied` event so
 * the parity test on update-server can validate without a second
 * source of truth.
 *
 * Naming is intentional: `PROJECT_TEMPLATES` is multi-file scaffolds
 * shipped by THIS module; `BUILT_IN_TEMPLATES` (in
 * `src/renderer/data/templates.ts`) is single-file new-tab starters.
 * The two surfaces never overlap; callers always use the fully
 * qualified name.
 */

import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';
import { expressApiHelloTemplate } from './expressApiHello';
import { fastapiHelloTemplate } from './fastapiHello';
import { nodeCliArgparseTemplate } from './nodeCliArgparse';
import { reactComponentSandboxTemplate } from './reactComponentSandbox';
import { pythonDataExplorerTemplate } from './pythonDataExplorer';

export const PROJECT_TEMPLATES: readonly ProjectTemplateV1[] = [
  expressApiHelloTemplate,
  fastapiHelloTemplate,
  nodeCliArgparseTemplate,
  reactComponentSandboxTemplate,
  pythonDataExplorerTemplate,
];

/**
 * Closed-enum of allowed template ids. Source of truth for the
 * renderer + the `template_project_applied` telemetry validator.
 * The update-server mirror duplicates the literal list and the
 * parity test enforces byte-for-byte equality.
 */
export const PROJECT_TEMPLATE_IDS: readonly string[] = PROJECT_TEMPLATES.map(
  (template) => template.id
);

export function findProjectTemplate(id: string): ProjectTemplateV1 | undefined {
  return PROJECT_TEMPLATES.find((template) => template.id === id);
}
