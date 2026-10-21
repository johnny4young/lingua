/**
 * `secrets:*` IPC handlers over the encrypted secret store.
 *
 * Every argument is validated here: ids against the shared charset, values
 * against the size cap. Errors never echo the value back.
 */

import { typedHandle } from './typedHandle';
import type { SecretStore } from '../secretStore';
import { isValidSecretId, isValidSecretPrefix } from '../../shared/secretVault';

// Database passwords go to the SQL host from main; the renderer can neither read nor write them.
const MAIN_ONLY = 'db.';
const rendererId = (id: unknown): id is string => isValidSecretId(id) && !id.startsWith(MAIN_ONLY);

export function registerSecretHandlers(store: SecretStore): void {
  typedHandle('secrets:status', () => store.status());

  typedHandle('secrets:set', (_event, id: unknown, value: unknown) =>
    rendererId(id) && typeof value === 'string'
      ? store.set(id, value)
      : { ok: false as const, reason: rendererId(id) ? 'invalid-value' as const : 'invalid-id' as const }
  );

  typedHandle('secrets:get', (_event, id: unknown) =>
    rendererId(id) ? store.get(id) : null
  );

  typedHandle('secrets:delete', async (_event, id: unknown) => ({
    ok: rendererId(id) ? await store.delete(id) : false,
  }));

  typedHandle('secrets:list', (_event, prefix: unknown) =>
    isValidSecretPrefix(prefix) && !prefix.startsWith(MAIN_ONLY) ? store.list(prefix) : []
  );
}
