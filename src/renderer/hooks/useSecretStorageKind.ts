import { useEffect, useState } from 'react';
import type { SecretVaultStatus } from '../../shared/secretVault';
import { getSecretVault } from '../services/secretVault';

export type SecretStorageKind = 'browser' | 'encrypted' | 'session' | 'unknown';

/** Where secrets typed into Settings end up, for the storage note under the field. */
export function useSecretStorageKind(): SecretStorageKind {
  const [kind, setKind] = useState<SecretStorageKind>(() =>
    getSecretVault() ? 'unknown' : 'browser'
  );
  useEffect(() => {
    const vault = getSecretVault();
    if (!vault) return;
    let cancelled = false;
    vault
      .status()
      .then((status: SecretVaultStatus) => {
        if (!cancelled) setKind(status.mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return kind;
}
