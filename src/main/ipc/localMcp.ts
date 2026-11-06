import type { WebContents } from 'electron';
import type { RootId } from '../../shared/fs/brandedIds';
import type { LocalMcpState } from '../../shared/localMcp';
import { typedHandle } from './typedHandle';

const hookedOwners = new Set<number>();

// The server pulls the MCP SDK and zod; a session that never starts it should not load them.
let localMcp: Promise<typeof import('../localMcp')> | null = null;
const loadLocalMcp = () => (localMcp ??= import('../localMcp'));

export async function disposeLocalMcpServerIfLoaded(): Promise<void> {
  if (localMcp) await (await localMcp).disposeLocalMcpServer();
}

export async function disposeLocalMcpServerForRootIfLoaded(rootId: string): Promise<void> {
  if (localMcp) await (await localMcp).disposeLocalMcpServerForRoot(rootId);
}

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
    if (localMcp) void localMcp.then(mcp => mcp.disposeLocalMcpServerForOwner(sender.id));
  });
}

export function registerLocalMcpHandlers(getAppVersion: () => string): void {
  typedHandle('local-mcp:get-state', async event =>
    localMcp ? (await localMcp).getLocalMcpState(event.sender.id) : { status: 'stopped' as const }
  );

  typedHandle(
    'local-mcp:start',
    async (event, rootId: RootId, acknowledgement: { readonly readOnlySourceAccess: true }) => {
      const sender = event.sender;
      installOwnerLifecycle(sender);
      const { startLocalMcpServer } = await loadLocalMcp();
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

  typedHandle('local-mcp:stop', async event =>
    (await loadLocalMcp()).stopLocalMcpServer(event.sender.id)
  );
}
