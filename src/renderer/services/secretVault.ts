/**
 * Renderer access to the desktop secret vault (`window.lingua.secrets`).
 * Web builds have no vault: callers keep today's localStorage behavior.
 */

import {
  AI_API_KEY_SECRET_ID,
  HTTP_ENV_SECRET_PREFIX,
  type SecretVaultBridge,
} from '../../shared/secretVault';

export function getSecretVault(): SecretVaultBridge | null {
  if (typeof window === 'undefined') return null;
  return window.lingua?.secrets ?? null;
}

const pendingWrites = new Map<string, Promise<boolean>>();

/** Writes run in order per id so the last value typed is the one stored; '' deletes. */
export function writeSecret(vault: SecretVaultBridge, id: string, value: string): Promise<boolean> {
  const previous = pendingWrites.get(id) ?? Promise.resolve(true);
  const next = previous
    .then(async () => (value ? (await vault.set(id, value)).ok : (await vault.delete(id)).ok))
    .catch(() => false);
  pendingWrites.set(id, next);
  void next.finally(() => {
    if (pendingWrites.get(id) === next) pendingWrites.delete(id);
  });
  return next;
}

/** Writes and reads back, so a migration only drops the plaintext copy once the vault holds it. */
export async function writeSecretVerified(
  vault: SecretVaultBridge,
  id: string,
  value: string
): Promise<boolean> {
  if (!(await writeSecret(vault, id, value))) return false;
  try {
    return (await vault.get(id)) === value;
  } catch {
    return false;
  }
}

export async function clearVaultSecrets(): Promise<void> {
  const vault = getSecretVault();
  if (!vault) return;
  try {
    const ids = [AI_API_KEY_SECRET_ID, ...(await vault.list(HTTP_ENV_SECRET_PREFIX))];
    await Promise.all(ids.map((id) => writeSecret(vault, id, '')));
  } catch {
    // Best effort: a failed delete leaves an encrypted blob, never plaintext.
  }
}
