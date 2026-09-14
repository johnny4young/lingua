/**
 * The execution-history record for a finished manual run: the run capsule,
 * the opt-in code snapshot, and the run-start git posture the capsule carries.
 */

import { getBundledAppInfo } from '../../../shared/appInfo';
import { isEntitled } from '../../../shared/entitlements';
import { buildRunCapsule, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { currentEffectiveTier } from '../../hooks/useEntitlement';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useGitStore } from '../../stores/gitStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { FileTab } from '../../types/editor';
import type { ConsoleOutput, ExecutionResult } from '../../types/execution';

export type GitSnapshot = { branch?: string; commit?: string };

/**
 * implementation — gate the optional code snapshot for the
 * execution-history ring buffer. The snapshot only attaches when the
 * user opted in via Settings AND the active tier covers
 * `EXECUTION_HISTORY`. The Pro check is a defense-in-depth gate —
 * the toggle UI in Editor settings already disables itself for Free
 * users, but a state-shadowing bug (or a future surface that flips
 * the flag programmatically) must not be able to leak captures. The
 * try/catch hardens against a license-store throw (mocked imports in
 * tests, an unexpected refactor) — fall back to no-snapshot rather
 * than dropping the entire history record on the floor.
 *
 * Caller passes the `code` + `language` it actually executed, not
 * the live `FileTab` reference. The tab's buffer can mutate during
 * the awaited `runner.execute(...)` window (autosave, Format on
 * Save, the user typing into the editor); a snapshot built from
 * the stale tab ref would not match what `runner.execute()` ran,
 * defeating the whole point of replay. Snapshot whatever was passed
 * to the runner — same string the runner saw.
 */
function snapshotPayloadFor(
  code: string,
  language: string
): { code: string; language: string } | null {
  try {
    const enabled = useSettingsStore.getState().executionHistorySnapshotEnabled;
    if (enabled !== true) return null;
    if (!isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY')) return null;
    return { code, language };
  } catch {
    return null;
  }
}

/**
 * Collect rich payloads from every runner channel that can surface them:
 * streamed stdout/stderr entries and magic-comment side results. Capsules keep
 * these as opaque payloads so replay/import flows preserve the renderer-visible
 * artifact without this module knowing every rich-output kind.
 */
function collectRichOutputs(result: ExecutionResult): unknown[] | undefined {
  const richOutputs: unknown[] = [];
  const collectFromConsole = (outputs: ConsoleOutput[]) => {
    for (const output of outputs) {
      if (Array.isArray(output.payload)) {
        richOutputs.push(...output.payload);
      }
    }
  };

  collectFromConsole(result.stdout);
  collectFromConsole(result.stderr);
  for (const magicResult of result.magicResults ?? []) {
    if (magicResult.payload !== undefined) {
      richOutputs.push(magicResult.payload);
    }
  }

  return richOutputs.length > 0 ? richOutputs : undefined;
}

/**
 * implementation — capsule construction wrapper. Returns the built
 * capsule on the happy path; returns `null` and swallows the error
 * on any failure (Web Crypto unavailable in a test env, etc.) so a
 * capsule failure never breaks the actual execution / history record.
 *
 * The history store applies the LRU cap on its end, so this helper
 * does not need to gate on the entitlement or the size budget —
 * capsules are always built when possible and the store prunes the
 * tail.
 */
async function tryBuildCapsule(args: {
  language: string;
  content: string;
  tabName: string;
  runtimeMode: string;
  workflowMode: string;
  runnerId: string;
  status: 'success' | 'error' | 'timeout' | 'stopped';
  durationMs: number;
  stdout?: string;
  stderr?: string;
  lineResults?: unknown[];
  richOutputs?: unknown[];
  diagnostics?: unknown[];
  errorMessage?: string;
  stdin?: string;
  inputSetName?: string;
  inputArgs?: string[];
  /**
   * implementation note — pre-run branch snapshot. Captured at
   * run-START (not at this builder-call time) so a mid-run sibling
   * checkout does not pollute the capsule. The caller threads the
   * pre-run snapshot through; this builder simply forwards it onto
   * the schema's optional `environment.git` slot. Undefined when
   * the run started without a usable git posture (web, no-git
   * folder, detached HEAD).
   */
  gitSnapshot?: GitSnapshot;
}): Promise<RunCapsuleV1 | null> {
  try {
    const appInfo = getBundledAppInfo();
    const platform: 'web' | 'desktop' =
      typeof window !== 'undefined' &&
      (window as { lingua?: { platform?: string } }).lingua?.platform === 'desktop'
        ? 'desktop'
        : 'web';
    return await buildRunCapsule({
      appVersion: appInfo.version,
      tab: {
        name: args.tabName,
        language: args.language,
        runtimeMode: args.runtimeMode,
        workflowMode: args.workflowMode,
      },
      source: { content: args.content },
      input: {
        ...(args.stdin !== undefined && args.stdin.length > 0
          ? { stdin: args.stdin }
          : {}),
        ...(args.inputSetName ? { setName: args.inputSetName } : {}),
        ...(args.inputArgs && args.inputArgs.length > 0
          ? { args: args.inputArgs }
          : {}),
      },
      result: {
        status: args.status,
        durationMs: Math.max(0, args.durationMs),
        ...(args.stdout !== undefined ? { stdout: args.stdout } : {}),
        ...(args.stderr !== undefined ? { stderr: args.stderr } : {}),
        ...(args.lineResults !== undefined && args.lineResults.length > 0
          ? { lineResults: args.lineResults }
          : {}),
        ...(args.richOutputs !== undefined && args.richOutputs.length > 0
          ? { richOutputs: args.richOutputs }
          : {}),
        ...(args.diagnostics !== undefined && args.diagnostics.length > 0
          ? { diagnostics: args.diagnostics }
          : {}),
        ...(args.errorMessage !== undefined
          ? { errorMessage: args.errorMessage }
          : {}),
      },
      environment: {
        platform,
        runner: args.runnerId,
        // implementation note — branch snapshot from run START. Omitted (rather
        // than included as an empty object) when the snapshot carries
        // neither branch nor commit so a no-git run keeps the
        // existing capsule shape unchanged.
        ...(args.gitSnapshot &&
        (args.gitSnapshot.branch !== undefined ||
          args.gitSnapshot.commit !== undefined)
          ? {
              git: {
                ...(args.gitSnapshot.branch !== undefined
                  ? { branch: args.gitSnapshot.branch }
                  : {}),
                ...(args.gitSnapshot.commit !== undefined
                  ? { commit: args.gitSnapshot.commit }
                  : {}),
              },
            }
          : {}),
      },
    });
  } catch {
    return null;
  }
}

/**
 * implementation note — snapshot the current git posture for the
 * capsule. Reads `useGitStore.posture` synchronously at run START
 * so a mid-run `git checkout` from a sibling terminal does NOT
 * change the capture. Returns `undefined` when the posture is
 * unavailable (web build, no-git folder, detached HEAD), in which
 * case the capsule's `environment.git` slot is omitted entirely.
 *
 * The git store is imported statically: this module only loads with
 * the manual run pipeline, after a run starts, so the import adds
 * nothing to startup. A lazy CommonJS `require()` would be undefined
 * in Vite's browser-style renderer bundle and would silently drop
 * the Git snapshot.
 */
export function snapshotGitPosture(): GitSnapshot | undefined {
  try {
    const posture = useGitStore.getState().posture as
      | { available?: boolean; branch?: string; commit?: string }
      | null
      | undefined;
    if (!posture || posture.available !== true) return undefined;
    const branch = typeof posture.branch === 'string' ? posture.branch : undefined;
    const commit = typeof posture.commit === 'string' ? posture.commit : undefined;
    if (branch === undefined && commit === undefined) return undefined;
    return {
      ...(branch !== undefined ? { branch } : {}),
      ...(commit !== undefined ? { commit } : {}),
    };
  } catch {
    return undefined;
  }
}

function joinConsoleEntries(entries: ConsoleOutput[]): string {
  return entries.map((entry) => entry.args.join(' ')).join('\n');
}

/** Capsule fields every record shares, read from the tab that ran. */
function capsuleTabFields(activeTab: FileTab, gitSnapshot: GitSnapshot | undefined) {
  return {
    language: activeTab.language,
    content: activeTab.content,
    tabName: activeTab.name,
    runtimeMode: activeTab.runtimeMode ?? 'worker',
    workflowMode: activeTab.workflowMode ?? 'run',
    runnerId: activeTab.language,
    stdin: activeTab.stdinBuffer ?? undefined,
    inputSetName: activeTab.inputSets?.find(
      (inputSet) => inputSet.id === activeTab.activeInputSetId
    )?.name,
    inputArgs: activeTab.inputArgs,
    // implementation note — pre-run branch snapshot.
    ...(gitSnapshot !== undefined ? { gitSnapshot } : {}),
  };
}

/**
 * Record a run that finished, successfully or with a runner-reported error.
 * implementation — the capsule is built before `history.record` so the entry
 * carries it atomically and the LRU prune sees the latest entry-with-capsule
 * on the same set() tick. Metadata is always recorded; the code snapshot only
 * attaches when opted in and entitled.
 */
export async function recordCompletedRun(args: {
  activeTab: FileTab;
  result: ExecutionResult;
  runStatus: 'ok' | 'error' | 'timeout' | 'stopped';
  lineResults: unknown[];
  diagnostics: unknown[];
  gitSnapshot: GitSnapshot | undefined;
}): Promise<void> {
  const { activeTab, result, runStatus, lineResults, diagnostics, gitSnapshot } = args;
  const { language, content } = activeTab;
  const capsule = await tryBuildCapsule({
    ...capsuleTabFields(activeTab, gitSnapshot),
    status: runStatus === 'ok' ? 'success' : runStatus,
    durationMs: result.executionTime ?? 0,
    stdout: result.stdout.length > 0 ? joinConsoleEntries(result.stdout) : undefined,
    stderr: result.stderr.length > 0 ? joinConsoleEntries(result.stderr) : undefined,
    lineResults: lineResults.length > 0 ? lineResults : undefined,
    richOutputs: collectRichOutputs(result),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    errorMessage: result.error?.message,
  });

  useExecutionHistoryStore.getState().record({
    language,
    status: runStatus === 'ok' ? 'ok' : 'error',
    durationMs: result.executionTime ?? null,
    snapshot: snapshotPayloadFor(content, language),
    // implementation — anchor the entry to the source tab so the per-tab
    // pill can filter via `byTabId`.
    tabId: activeTab.id,
    // implementation — omit the capsule when construction failed so the
    // entry's wire shape stays clean.
    ...(capsule !== null ? { lastCapsule: capsule } : {}),
  });
}

/**
 * Record a run that threw before the runner produced a result. internal —
 * "Recent runs" still reflects the failure, with `durationMs: null` because
 * timing never ran, and the snapshot still attaches when opted in: a failure
 * is the case where the user most likely wants to replay. implementation —
 * the capsule carries status `'error'` and the thrown message (already
 * redactable by sanitizeRunCapsule) so a failed run stays exportable.
 */
export async function recordFailedRun(
  activeTab: FileTab,
  message: string,
  gitSnapshot: GitSnapshot | undefined
): Promise<void> {
  const { language, content } = activeTab;
  const capsule = await tryBuildCapsule({
    ...capsuleTabFields(activeTab, gitSnapshot),
    status: 'error',
    durationMs: 0,
    errorMessage: message,
  });
  useExecutionHistoryStore.getState().record({
    language,
    status: 'error',
    durationMs: null,
    snapshot: snapshotPayloadFor(content, language),
    tabId: activeTab.id,
    ...(capsule !== null ? { lastCapsule: capsule } : {}),
  });
}
