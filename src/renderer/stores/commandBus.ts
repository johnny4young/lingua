import { create } from 'zustand';
import type { ShareCreateTrigger } from '../utils/shareLink';

export type CapsuleBrowseSurface = 'palette' | 'shortcut' | 'settings' | 'action-pill';

export type SettingsTabId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'languages'
  | 'environment'
  | 'privacy'
  | 'account'
  | 'shortcuts'
  | 'plugins'
  | 'recovery';

export interface OpenFileCommand {
  readonly file?: unknown;
  readonly line?: unknown;
  readonly column?: unknown;
  readonly fnName?: unknown;
}

export interface RendererCommandPayloadMap {
  'overlay.openSnippets': undefined;
  'capsule.openImport': undefined;
  'capsule.openList': { readonly surface: CapsuleBrowseSurface };
  'file.open': OpenFileCommand;
  'share.trigger': { readonly trigger: ShareCreateTrigger };
  'share.succeeded': undefined;
  'settings.openLicense': undefined;
  'settings.navigate': { readonly tab: SettingsTabId };
  'editor.highlightLine': {
    readonly line: number;
    readonly column?: number;
    readonly durationMs?: number;
  };
  'editor.sourceLineHovered': {
    readonly line: number;
    readonly durationMs?: number;
  };
  'editor.scroll': { readonly scrollTop: number };
}

export type RendererCommandName = keyof RendererCommandPayloadMap;

export interface RendererCommandContext {
  /** Whether a higher-priority consumer has claimed the command. */
  readonly handled: boolean;
  /** Claim the command so listeners registered as fallbacks are skipped. */
  markHandled(): void;
}

export type RendererCommandListener<K extends RendererCommandName> = (
  payload: RendererCommandPayloadMap[K],
  context: RendererCommandContext
) => void;

export interface CommandListenerOptions {
  /** Higher values run first. Equal priorities preserve registration order. */
  readonly priority?: number;
  /** Fallback listeners only run while no earlier listener has claimed the command. */
  readonly delivery?: 'always' | 'fallback';
}

export interface RendererCommandDispatchResult {
  readonly handled: boolean;
  readonly delivered: number;
}

type EmitCommand = <K extends RendererCommandName>(
  ...args: RendererCommandPayloadMap[K] extends undefined
    ? [name: K, payload?: RendererCommandPayloadMap[K]]
    : [name: K, payload: RendererCommandPayloadMap[K]]
) => RendererCommandDispatchResult;

type SubscribeCommand = <K extends RendererCommandName>(
  name: K,
  listener: RendererCommandListener<K>,
  options?: CommandListenerOptions
) => () => void;

interface CommandBusState {
  emit: EmitCommand;
  subscribe: SubscribeCommand;
}

interface RegisteredListener {
  readonly id: number;
  readonly priority: number;
  readonly delivery: 'always' | 'fallback';
  readonly listener: RendererCommandListener<RendererCommandName>;
}

const listeners = new Map<RendererCommandName, Map<number, RegisteredListener>>();
let nextListenerId = 1;

const emit: EmitCommand = (...args) => {
  const [name, payload] = args;
  const registered = listeners.get(name);
  if (!registered?.size) return { handled: false, delivered: 0 };

  let handled = false;
  let delivered = 0;
  const context: RendererCommandContext = {
    get handled() {
      return handled;
    },
    markHandled() {
      handled = true;
    },
  };

  const ordered = Array.from(registered.values()).sort(
    (left, right) => right.priority - left.priority || left.id - right.id
  );
  for (const entry of ordered) {
    if (entry.delivery === 'fallback' && handled) continue;
    entry.listener(payload, context);
    delivered += 1;
  }

  return { handled, delivered };
};

const subscribe: SubscribeCommand = (name, listener, options) => {
  const id = nextListenerId;
  nextListenerId += 1;
  const registered: RegisteredListener = {
    id,
    priority: options?.priority ?? 0,
    delivery: options?.delivery ?? 'always',
    listener: listener as RendererCommandListener<RendererCommandName>,
  };
  const commandListeners = listeners.get(name) ?? new Map<number, RegisteredListener>();
  commandListeners.set(id, registered);
  listeners.set(name, commandListeners);

  return () => {
    const current = listeners.get(name);
    current?.delete(id);
    if (current?.size === 0) listeners.delete(name);
  };
};

/**
 * Typed, synchronous renderer command bus.
 *
 * Commands are delivered only to listeners that exist at emit time: there is
 * no stored command value, replay, coalescing, or Zustand state update. This
 * keeps repeated and high-frequency editor commands synchronous without
 * triggering unrelated React renders.
 */
export const useCommandBus = create<CommandBusState>(() => ({ emit, subscribe }));

export const emitCommand: EmitCommand = emit;

export const subscribeCommand: SubscribeCommand = subscribe;

/** Test-only reset for listeners registered outside React cleanup. */
export function _resetCommandBusForTesting(): void {
  listeners.clear();
  nextListenerId = 1;
}
