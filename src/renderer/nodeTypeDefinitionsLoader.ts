import nodeTypingUrl from 'virtual:lingua-node-typing-url';

type Definitions = typeof import('./monacoNodeTypes');
let failedAttempts = 0;

export async function loadNodeTypeDefinitions(): Promise<Definitions> {
  // Native ESM caches rejected imports. A later demand gets a fresh module
  // identity, but the successful path still downloads exactly one lazy chunk.
  const url =
    failedAttempts === 0
      ? nodeTypingUrl
      : `${nodeTypingUrl}${nodeTypingUrl.includes('?') ? '&' : '?'}retry=${failedAttempts}`;
  try {
    return (await import(/* @vite-ignore */ url)) as Definitions;
  } catch (error) {
    failedAttempts += 1;
    throw error;
  }
}
