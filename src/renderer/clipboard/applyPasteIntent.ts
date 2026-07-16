/**
 * RL-110 Slice 1 — impure router that turns a detected {@link PasteIntent}
 * into the right import action by DELEGATING to the already-shipped importers:
 *
 *   - share-link  -> `decodeShareFragment` + `editorStore.addTab` (mirrors the
 *                    boot import in `useShareLinkBoot`)
 *   - capsule     -> `CapsuleImportOverlay` pre-filled for confirm-first import
 *   - curl        -> build an `HttpRequestV1` + `workspaceToolStore.createRequest`
 *                    + `openHttpWorkspaceTab` (mirrors `useImportPreview`'s
 *                    `curl-http` confirm branch)
 *   - stack-trace -> emit the existing `file.open` command (reveals
 *                    within-tab today; opens cross-file once RL-024 lands)
 *   - large-json  -> open a new `json` editor tab with the blob
 *
 * On a content import (everything except stack-trace navigation) the literal
 * text the paste inserted is stripped from the source buffer via
 * `pushEditOperations`, so e.g. a pasted share link does not also linger as raw
 * text — matching the spec's "abre … sin pegar el texto". The strip is a normal
 * Monaco edit, so Cmd+Z restores the paste.
 *
 * The router reads stores through `getState()` so it stays a plain async
 * function (not a hook) and is unit-tested with mocked stores
 * (`tests/renderer/clipboard/applyPasteIntent.test.ts`).
 */
import type { editor as MonacoEditor, IRange } from 'monaco-editor';
import { decodeShareFragment } from '../../shared/sharePayload';
import { parseRunCapsule } from '../../shared/runCapsule';
import {
  createBlankHttpRequest,
  type HttpRequestBody,
  type HttpRequestHeader,
  type HttpRequestV1,
} from '../../shared/httpWorkspace';
import { parseCurlCommand, type CurlCommand } from '../utils/curlToCode';
import { openHttpWorkspaceTab, openUtilitiesWorkspaceTab } from '../runtime/openWorkspaceTab';
import { setPendingCapsuleImportSource } from './pendingCapsuleImport';
import { createDefaultTab } from '../stores/editorTabUtils';
import { useEditorStore } from '../stores/editorStore';
import { useUtilityHistoryStore } from '../stores/utilityHistoryStore';
import { useWorkspaceToolStore } from '../stores/workspaceToolStore';
import type { Language } from '../types';
import type { PasteIntent } from './pasteHandlers';
import { emitCommand } from '../stores/commandBus';

/**
 * Minimal Monaco surface the router needs: the model to strip the literal
 * paste from, plus the range the paste inserted. Narrowed so tests can pass a
 * tiny fake without a real editor.
 */
export interface ApplyPasteContext {
  model: Pick<MonacoEditor.ITextModel, 'getValueInRange' | 'pushEditOperations'>;
  pastedRange: IRange;
  pastedText: string;
}

/**
 * Strip the literal pasted text once the user chooses to import instead.
 *
 * The toast is intentionally non-blocking, so the user can keep typing before
 * clicking Import. Only remove the original range if it still contains the
 * exact paste we detected; otherwise leave the user's newer edit untouched.
 */
function removePastedText(ctx: ApplyPasteContext): void {
  if (ctx.model.getValueInRange(ctx.pastedRange) !== ctx.pastedText) return;
  ctx.model.pushEditOperations([], [{ range: ctx.pastedRange, text: '' }], () => null);
}

/** Header name lookup is case-insensitive in HTTP. */
function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

/** Pick the request-body kind from the cURL Content-Type / payload shape. */
function inferBodyKind(command: CurlCommand): HttpRequestBody['kind'] {
  const contentType = headerValue(command.headers, 'content-type')?.toLowerCase() ?? '';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('x-www-form-urlencoded')) return 'form';
  const body = command.body ?? '';
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* fall through */
    }
  }
  return 'text';
}

/** A readable request name: METHOD host, falling back to METHOD import. */
function deriveCurlName(command: CurlCommand): string {
  try {
    const { hostname } = new URL(command.url);
    if (hostname) return `${command.method} ${hostname}`;
  } catch {
    /* not a parseable URL — fall through */
  }
  return `${command.method} import`;
}

async function applyShareLink(fragment: string, ctx: ApplyPasteContext): Promise<boolean> {
  const result = await decodeShareFragment(fragment);
  if (!result.ok) return false;
  const { payload } = result;
  // Mirror of useShareLinkBoot.importFromHash: build a tab from the payload and
  // hand it to addTab (which strips fields the language cannot carry + enforces
  // tier gates). Kept local rather than refactoring the boot path.
  const base = createDefaultTab(payload.tab.language as Language);
  useEditorStore.getState().addTab({
    ...base,
    name: payload.tab.name,
    content: payload.source.content,
    runtimeMode: payload.modes?.runtime ?? base.runtimeMode,
    workflowMode: payload.modes?.workflow ?? base.workflowMode,
    autoLogEnabled: payload.modes?.autoLog ?? base.autoLogEnabled,
    stdinBuffer: payload.input?.stdin ?? base.stdinBuffer,
  });
  removePastedText(ctx);
  return true;
}

function applyCapsule(source: string, ctx: ApplyPasteContext): boolean {
  // Re-validate before handing off; the overlay re-decodes for its preview.
  if (!parseRunCapsule(source).ok) return false;
  // fold E — route through the confirm-first CapsuleImportOverlay (RL-094 UX)
  // rather than opening a tab one-click. Stash the JSON + emit the command
  // App already consumes; the overlay decodes the seed on mount.
  setPendingCapsuleImportSource(source);
  emitCommand('capsule.openImport');
  removePastedText(ctx);
  return true;
}

function applyCurl(source: string, ctx: ApplyPasteContext): boolean {
  const result = parseCurlCommand(source);
  if (!result.ok) return false;
  const command = result.command;
  const id = crypto.randomUUID();
  const headers: HttpRequestHeader[] = Object.entries(command.headers).map(([name, value]) => ({
    name,
    value,
    enabled: true,
  }));
  const body: HttpRequestBody | undefined =
    command.body != null && command.body.length > 0
      ? { kind: inferBodyKind(command), content: command.body }
      : undefined;
  const request: HttpRequestV1 = {
    ...createBlankHttpRequest({ id, name: deriveCurlName(command) }),
    method: command.method as HttpRequestV1['method'],
    url: command.url,
    headers,
    ...(body ? { body } : {}),
  };
  useWorkspaceToolStore.getState().createRequest(request);
  openHttpWorkspaceTab({ adoptEntryId: id });
  removePastedText(ctx);
  return true;
}

function applyStackTrace(intent: Extract<PasteIntent, { kind: 'stack-trace' }>): boolean {
  // Reuse the existing clickable-stack-frame command. The default consumer
  // reveals within-tab; a higher-priority RL-024 consumer will open cross-file
  // once multi-file lands. Navigation, so the pasted trace is left in place.
  emitCommand('file.open', {
    file: intent.file ?? undefined,
    line: intent.line,
    column: intent.column,
  });
  return true;
}

function applyLargeJson(source: string, ctx: ApplyPasteContext): boolean {
  const base = createDefaultTab('json' as Language);
  useEditorStore.getState().addTab({ ...base, content: source });
  removePastedText(ctx);
  return true;
}

function applyUtility(
  intent: Extract<PasteIntent, { kind: 'utility' }>,
  ctx: ApplyPasteContext
): boolean {
  // IT2-F4 — stash the one-shot seed FIRST so the panel (fresh mount or
  // already mounted) finds it when the workspace tab activates, then open
  // the Utilities workspace on the matching panel. The value moved into
  // the utility, so the literal paste is stripped like the other imports.
  useUtilityHistoryStore.getState().setPendingUtilityInput({
    utilityId: intent.utilityId,
    input: intent.source,
  });
  openUtilitiesWorkspaceTab(intent.utilityId);
  removePastedText(ctx);
  return true;
}

/**
 * Route a detected paste intent to its importer. Returns `true` when the import
 * was dispatched, `false` when a late re-parse failed (the caller leaves the
 * pasted text in place and may surface the importer's own error path).
 */
export async function applyPasteIntent(
  intent: PasteIntent,
  ctx: ApplyPasteContext
): Promise<boolean> {
  switch (intent.kind) {
    case 'share-link':
      return applyShareLink(intent.fragment, ctx);
    case 'capsule':
      return applyCapsule(intent.source, ctx);
    case 'curl':
      return applyCurl(intent.source, ctx);
    case 'stack-trace':
      return applyStackTrace(intent);
    case 'large-json':
      return applyLargeJson(intent.source, ctx);
    case 'utility':
      return applyUtility(intent, ctx);
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}
