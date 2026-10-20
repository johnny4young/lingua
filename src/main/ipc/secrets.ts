/**
 * `secrets:*` IPC handlers over the encrypted secret store.
 *
 * Every argument is validated here: ids against the shared charset, values
 * against the size cap. Errors never echo the value back.
 */

import { typedHandle } from './typedHandle';
import type { SecretStore } from '../secretStore';
import { isValidSecretId, isValidSecretPrefix } from '../../shared/secretVault';

export function registerSecretHandlers(store: SecretStore): void {
  typedHandle('secrets:status', () => store.status());

  typedHandle('secrets:set', (_event, id: unknown, value: unknown) =>
    typeof id === 'string' && typeof value === 'string'
      ? store.set(id, value)
      : { ok: false as const, reason: typeof id === 'string' ? 'invalid-value' as const : 'invalid-id' as const }
  );

  typedHandle('secrets:get', (_event, id: unknown) =>
    isValidSecretId(id) ? store.get(id) : null
  );

  typedHandle('secrets:delete', async (_event, id: unknown) => ({
    ok: isValidSecretId(id) ? await store.delete(id) : false,
  }));

  typedHandle('secrets:list', (_event, prefix: unknown) =>
    isValidSecretPrefix(prefix) ? store.list(prefix) : []
  );
}
