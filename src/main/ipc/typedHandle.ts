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
 * Handler ARGUMENTS stay deliberately loose in `typedHandle`: values arrive
 * over IPC from an untrusted renderer, so those handlers validate their own
 * `unknown` inputs. Higher-risk channels use `validatedHandle`, which parses
 * the raw tuple before invoking an implementation typed to the contract.
 */

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type {
  IpcInvokeArgs,
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

export type RuntimeIpcArgsParser<C extends IpcInvokeChannel> = (
  args: readonly unknown[]
) => IpcInvokeArgs<C>;

export type ValidatedIpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

/**
 * Register an invoke handler whose wire arguments are parsed before the
 * implementation runs. IPC values are untrusted at runtime even when preload
 * exposes a typed API; this wrapper keeps them `unknown` until the supplied
 * parser returns the exact contract tuple.
 */
export function validatedHandle<C extends IpcInvokeChannel>(
  channel: C,
  parseArgs: RuntimeIpcArgsParser<C>,
  handler: ValidatedIpcHandler<C>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...parseArgs(args)));
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
