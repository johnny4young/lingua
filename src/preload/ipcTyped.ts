/**
 * Preload-side typed IPC helpers bound to `src/shared/ipcContract.ts`.
 *
 * `typedInvoke` replaces the hand-written
 * `ipcRenderer.invoke('chan', …) as Promise<X>` casts: the channel name is
 * constrained to a contract key, the argument tuple is checked against the
 * contract, and the result type is derived from it (no cast, no drift).
 * `typedSend` / `typedOn` do the same for the fire-and-forget send/push
 * channels.
 */

import { ipcRenderer } from 'electron';
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcPushChannel,
  IpcPushPayload,
  IpcSendArgs,
  IpcSendChannel,
} from '../shared/ipcContract';

export function typedInvoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
): Promise<IpcInvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>;
}

export function typedSend<C extends IpcSendChannel>(
  channel: C,
  ...args: IpcSendArgs<C>
): void {
  ipcRenderer.send(channel, ...args);
}

/**
 * Subscribe to a main → renderer push channel. Returns an unsubscribe
 * function. The payload arrives as `unknown` over the wire and is cast to
 * the contract payload type once, here, instead of at every call site.
 */
export function typedOn<C extends IpcPushChannel>(
  channel: C,
  callback: (payload: IpcPushPayload<C>) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: unknown): void =>
    callback(data as IpcPushPayload<C>);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
