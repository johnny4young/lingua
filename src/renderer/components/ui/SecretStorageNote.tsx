import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSecretStorageKind } from '../../hooks/useSecretStorageKind';

/** Says where typed secrets are kept: the system keychain or unencrypted local storage. */
export function SecretStorageNote({ testId }: { readonly testId?: string }) {
  const { t } = useTranslation();
  const kind = useSecretStorageKind();
  if (kind === 'unknown') return null;
  if (kind === 'session') {
    return (
      <div
        role="note"
        data-testid={testId}
        data-secret-storage={kind}
        className="flex items-start gap-2 rounded border border-warning-border bg-warning-bg p-2 text-caption text-warning-fg"
      >
        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('secrets.storage.noEncryption.title')}</p>
          <p className="mt-0.5">{t('secrets.storage.noEncryption.body')}</p>
        </div>
      </div>
    );
  }
  return (
    <p data-testid={testId} data-secret-storage={kind} className="text-caption text-fg-subtle">
      {t(kind === 'encrypted' ? 'secrets.storage.encrypted' : 'secrets.storage.browser')}
    </p>
  );
}
