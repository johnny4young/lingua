import type { WebContents } from 'electron';
import type { RootId } from '../../shared/fs/brandedIds';
import type { LocalMcpState } from '../../shared/localMcp';
import {
  disposeLocalMcpServerForOwner,
  getLocalMcpState,
  startLocalMcpServer,
  stopLocalMcpServer,
} from '../localMcp';
import { typedHandle } from './typedHandle';

const hookedOwners = new Set<number>();

function sendState(sender: WebContents, state: LocalMcpState): void {
  if (sender.isDestroyed()) return;
  try {
    sender.send('local-mcp:state-changed', state);
  } catch {
    // A renderer can disappear between isDestroyed() and send().
  }
}

function installOwnerLifecycle(sender: WebContents): void {
  if (hookedOwners.has(sender.id)) return;
  hookedOwners.add(sender.id);
  sender.once('destroyed', () => {
    hookedOwners.delete(sender.id);
    void disposeLocalMcpServerForOwner(sender.id);
  });
}

export function registerLocalMcpHandlers(getAppVersion: () => string): void {
  typedHandle('local-mcp:get-state', event => getLocalMcpState(event.sender.id));

  typedHandle(
    'local-mcp:start',
    async (event, rootId: RootId, acknowledgement: { readonly readOnlySourceAccess: true }) => {
      const sender = event.sender;
      installOwnerLifecycle(sender);
      return startLocalMcpServer({
        rootId,
        ownerId: sender.id,
        appVersion: getAppVersion(),
        acknowledged: acknowledgement?.readOnlySourceAccess === true,
        isOwnerAlive: () => !sender.isDestroyed(),
        onStateChanged: state => sendState(sender, state),
      });
    }
  );

  typedHandle('local-mcp:stop', event => stopLocalMcpServer(event.sender.id));
}
