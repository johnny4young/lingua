import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when the module at `moduleUrl` is the entry script Node was started
 * with. Node realpaths the main module's `import.meta.url` but not `argv[1]`,
 * so both sides are realpathed: a symlinked or percent-encoded invocation must
 * still run `main()` instead of silently exiting 0.
 *
 * @param {string} moduleUrl the caller's `import.meta.url`
 * @param {string | undefined} [invokedPath] defaults to `process.argv[1]`
 * @returns {boolean} false when `invokedPath` is missing or unresolvable
 */
export function isDirectInvocation(moduleUrl, invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  try {
    return realpathSync(path.resolve(invokedPath)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
