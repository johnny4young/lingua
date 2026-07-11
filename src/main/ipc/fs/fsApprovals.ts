/** User-approved filesystem scope persistence and read-only scope checks. */

import { app } from 'electron';
import { mkdir as mkdirFs, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinProject } from '../permissions';

interface FilesystemApprovalsFile {
  version: 1;
  roots: string[];
  files: string[];
}

const FILESYSTEM_APPROVALS_FILENAME = 'filesystem-approvals.json';

// Approval persistence is only a convenience layer for recent projects/files.
// Authority still comes from minting a fresh process-local rootId and routing
// every later operation through resolveCapabilityPath.
let filesystemApprovalsLoaded = false;
let approvedRoots = new Set<string>();
let approvedFiles = new Set<string>();

function normalizeApprovalPath(absolutePath: string): string {
  return path.normalize(path.resolve(absolutePath));
}

function approvalsFilePath(): string | null {
  if (typeof app?.getPath !== 'function') return null;
  try {
    return path.join(app.getPath('userData'), FILESYSTEM_APPROVALS_FILENAME);
  } catch {
    return null;
  }
}

async function loadFilesystemApprovals(): Promise<void> {
  if (filesystemApprovalsLoaded) return;
  filesystemApprovalsLoaded = true;
  const filePath = approvalsFilePath();
  if (!filePath) return;

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FilesystemApprovalsFile>;
    if (parsed.version !== 1) return;
    approvedRoots = new Set(
      (parsed.roots ?? [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeApprovalPath)
    );
    approvedFiles = new Set(
      (parsed.files ?? [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeApprovalPath)
    );
  } catch {
    // Missing or corrupt approval state should degrade to prompting the
    // user again, not to reopening arbitrary paths.
  }
}

async function persistFilesystemApprovals(): Promise<void> {
  const filePath = approvalsFilePath();
  if (!filePath) return;
  try {
    await mkdirFs(path.dirname(filePath), { recursive: true });
    const payload: FilesystemApprovalsFile = {
      version: 1,
      roots: [...approvedRoots].sort(),
      files: [...approvedFiles].sort(),
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch {
    // Persistence is convenience, not authority. The current process
    // still keeps the approval; the next boot will require a fresh pick.
  }
}

export async function rememberApprovedRoot(absolutePath: string): Promise<void> {
  await loadFilesystemApprovals();
  approvedRoots.add(normalizeApprovalPath(absolutePath));
  await persistFilesystemApprovals();
}

export async function rememberApprovedFile(absolutePath: string): Promise<void> {
  await loadFilesystemApprovals();
  approvedFiles.add(normalizeApprovalPath(absolutePath));
  await persistFilesystemApprovals();
}

export async function hasApprovedRoot(absolutePath: string): Promise<boolean> {
  await loadFilesystemApprovals();
  return approvedRoots.has(normalizeApprovalPath(absolutePath));
}

export async function hasApprovedFile(absolutePath: string): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedFiles.has(normalized)) return true;
  // Files under an approved project root can be reopened individually for
  // recent-file/session restore flows without approving every child file.
  for (const root of approvedRoots) {
    if (isPathWithinProject(normalized, root)) return true;
  }
  return false;
}

/**
 * True when `absolutePath` intersects the user-approved filesystem scope:
 * it IS an approved root (or exactly an approved file), lives INSIDE an
 * approved root, or is an ANCESTOR of an approved root. The ancestor arm
 * exists for the git read-only layer, where the repository toplevel of an
 * approved project subfolder legitimately sits ABOVE the approved root
 * (monorepo case: project opened at repo/packages/app, repoRoot = repo).
 *
 * Read-only consumers outside the rootId capability system (the git:*
 * handlers) gate on this so a compromised renderer cannot point them at
 * arbitrary disk locations — closing the one IPC door that previously
 * accepted raw absolute paths with no approval check, and aligning git
 * with the RL-077 defense-in-depth posture.
 */
export async function pathIntersectsApprovedScope(
  absolutePath: string
): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedRoots.has(normalized) || approvedFiles.has(normalized)) {
    return true;
  }
  for (const root of approvedRoots) {
    // Inside an approved root, or an ancestor of one. Intentionally NOT
    // widened to ancestors of approved single files: the git layer only
    // ever operates on project roots, and narrower is safer.
    if (isPathWithinProject(normalized, root)) return true;
    if (isPathWithinProject(root, normalized)) return true;
  }
  return false;
}

/**
 * Stricter, containment-only variant of `pathIntersectsApprovedScope` for
 * consumers that read FILE CONTENTS off disk (git:status / git:diff). The
 * path must BE an approved root/file or live INSIDE an approved root. The
 * ancestor arm is intentionally absent: a repo toplevel sitting above the
 * approved project is a legitimate repoRoot argument, but being an ancestor
 * must never be enough to read arbitrary sibling files outside the approved
 * subtree (unversioned monorepo secrets included).
 */
export async function pathInsideApprovedScope(
  absolutePath: string
): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedRoots.has(normalized) || approvedFiles.has(normalized)) {
    return true;
  }
  for (const root of approvedRoots) {
    if (isPathWithinProject(normalized, root)) return true;
  }
  return false;
}

export function _resetFilesystemApprovalsForTests(): void {
  filesystemApprovalsLoaded = false;
  approvedRoots = new Set();
  approvedFiles = new Set();
}
