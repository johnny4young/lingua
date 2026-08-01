/**
 * Build the explicit, reviewable file list offered by Capsule Workspace export.
 *
 * Only already-open code buffers are considered. Workspace tabs are excluded,
 * absolute host paths are never read, and the portable path is taken from a
 * capability-relative path or the visible tab name.
 */

import { redactSecretsFromCode } from '../../shared/ai/explainError';
import {
  MAX_CAPSULE_WORKSPACE_FILE_BYTES,
  normalizeCapsuleWorkspacePath,
} from '../../shared/capsuleWorkspace';
import { utf8ByteLength, type RunCapsuleV1 } from '../../shared/runCapsule';
import type { FileTab } from '../types';

export type CapsuleWorkspaceCandidateExclusion =
  | 'workspace-tab'
  | 'invalid-path'
  | 'duplicate-path'
  | 'primary-source'
  | 'file-too-large';

export interface CapsuleWorkspaceCandidate {
  readonly tabId: string;
  readonly path: string;
  readonly language: string;
  readonly content: string;
  readonly byteLength: number;
  readonly obviousSecretsDetected: number;
  readonly eligible: boolean;
  readonly exclusionReason?: CapsuleWorkspaceCandidateExclusion;
}

export function collectCapsuleWorkspaceCandidates(
  tabs: readonly FileTab[],
  capsule: RunCapsuleV1
): readonly CapsuleWorkspaceCandidate[] {
  const seen = new Set<string>();
  const primaryPath = normalizeCapsuleWorkspacePath(capsule.tab.name ?? '');
  const candidates: CapsuleWorkspaceCandidate[] = [];

  for (const tab of tabs) {
    const relativePath = tab.relativePath ? normalizeCapsuleWorkspacePath(tab.relativePath) : null;
    const namePath = normalizeCapsuleWorkspacePath(tab.name);
    const path = relativePath ?? namePath ?? '(invalid path)';
    const byteLength = utf8ByteLength(tab.content);
    const obviousSecretsDetected = redactSecretsFromCode(tab.content).redactedCount;
    let exclusionReason: CapsuleWorkspaceCandidateExclusion | undefined;

    if (tab.kind) {
      exclusionReason = 'workspace-tab';
    } else if (!relativePath && !namePath) {
      exclusionReason = 'invalid-path';
    } else if (
      tab.content === capsule.source.content &&
      (primaryPath === null ||
        path.toLocaleLowerCase('en-US') === primaryPath.toLocaleLowerCase('en-US'))
    ) {
      exclusionReason = 'primary-source';
    } else if (byteLength > MAX_CAPSULE_WORKSPACE_FILE_BYTES) {
      exclusionReason = 'file-too-large';
    } else {
      const key = path.toLocaleLowerCase('en-US');
      if (seen.has(key)) exclusionReason = 'duplicate-path';
      else seen.add(key);
    }

    candidates.push({
      tabId: tab.id,
      path,
      language: tab.language,
      content: tab.content,
      byteLength,
      obviousSecretsDetected,
      eligible: exclusionReason === undefined,
      ...(exclusionReason ? { exclusionReason } : {}),
    });
  }

  return candidates;
}
