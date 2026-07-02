/**
 * Main-side typed IPC helpers bound to `src/shared/ipcContract.ts`.
 *
 * `typedHandle` replaces raw `ipcMain.handle('chan', …)`: the channel name
 * must be a contract key and the handler's RETURN type is checked against
 * the contract result. That return-type binding is the whole point — it is
 * exactly the preload↔main drift the contract exists to catch (main used to
 * return one shape while preload cast the result to another, with `tsc`
 * none the wiser).
 *
 * Handler ARGUMENTS stay deliberately loose: values arrive over IPC from an
 * untrusted renderer, so every handler validates them itself (branded-id
 * minting, `typeof` guards, normalizers). Typing them as the contract tuple
 * would be a lie that discourages that validation, so the helper leaves the
 * incoming args untyped and each handler keeps its own `unknown`-typed
 * parameters.
 */

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type {
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcPushChannel,
  IpcPushPayload,
} from '../../shared/ipcContract';

export type TypedIpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  // Untrusted wire values — handlers validate them. `any[]` (not
  // `unknown[]`) so a handler declaring specific `unknown` parameters
  // stays assignable regardless of arity; the contract binds the return
  // type, which is what matters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: TypedIpcHandler<C>
): void {
  ipcMain.handle(channel, handler);
}

/**
 * Send a typed payload down a main → renderer push channel. Keeps the
 * channel name + payload type bound to `IpcPushContract` so a drifted
 * broadcast is a compile error at the main call site.
 */
export function typedSendTo<C extends IpcPushChannel>(
  contents: WebContents,
  channel: C,
  payload: IpcPushPayload<C>
): void {
  contents.send(channel, payload);
}
