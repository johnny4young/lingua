import type { SqlDbSecretKind } from '../../../shared/sqlDb';
import { AlertTriangle, KeyRound, Shield } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlWriteConfirm } from '../../hooks/useSqlRunner';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import '../../i18n/sqlConnectionsCatalog';

const BUTTON = 'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40';

/** Red band under the connection bar while a production connection is active. */
export function SqlProdBanner({ name, readOnly }: { name: string; readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="sql-prod-banner"
      role="status"
      className="flex h-[30px] shrink-0 items-center gap-2 border-b border-error-border bg-error-bg px-3 text-body-sm text-error-fg"
    >
      <Shield size={12} aria-hidden="true" />
      <span className="min-w-0 truncate">
        <strong className="font-semibold">{name}</strong>
        {' · '}
        {readOnly ? t('sqlWorkspace.guard.bannerReadOnly') : t('sqlWorkspace.guard.banner')}
      </span>
      <span className="ml-auto hidden font-mono text-caption sm:inline">{t('sqlWorkspace.guard.bannerHint')}</span>
    </div>
  );
}

/** The typed-name confirmation before a statement writes to production or to a connection that confirms every write. */
export function SqlWriteConfirmDialog({ confirm, onResolve }: { confirm: SqlWriteConfirm; onResolve: (name: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const matches = typed === confirm.connectionName;
  return (
    <ModalShell
      onClose={() => onResolve(null)}
      size="max-w-[560px]"
      labelledById={titleId}
      headerClose="esc"
      icon={<AlertTriangle size={16} aria-hidden="true" className="text-error-fg" />}
      header={
        <h2 id={titleId} className="truncate text-body-lg font-semibold text-fg-base">
          {confirm.production ? t('sqlWorkspace.guard.title') : t('sqlWorkspace.guard.titleConfirm', { name: confirm.connectionName })}
        </h2>
      }
      footerLegend={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="sql-write-confirm-run"
            disabled={!matches}
            onClick={() => onResolve(typed)}
            className={cn(BUTTON, 'border-error-border text-error-fg')}
          >
            {confirm.readOnly ? t('sqlWorkspace.guard.runReadWrite') : t('sqlWorkspace.guard.run')}
          </button>
          <button type="button" data-testid="sql-write-confirm-cancel" onClick={() => onResolve(null)} className={BUTTON}>
            {t('sqlWorkspace.guard.cancel')}
          </button>
        </div>
      }
    >
      <div data-testid="sql-write-confirm" className="flex flex-col gap-2.5 py-1 text-body-sm">
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md [font-variant-ligatures:none] border border-border-subtle bg-bg-inset px-2.5 py-1.5 font-mono text-caption text-fg-base">
          {confirm.statements.join(';\n\n')}
        </pre>
        <p className="leading-relaxed text-fg-muted">
          {confirm.readOnly ? t('sqlWorkspace.guard.bodyReadOnly', { name: confirm.connectionName }) : t('sqlWorkspace.guard.body', { name: confirm.connectionName })}{' '}
          <span data-testid="sql-write-confirm-estimate">
            {confirm.estimate === undefined
              ? t('sqlWorkspace.guard.estimating')
              : confirm.estimate === null
                ? t('sqlWorkspace.guard.noEstimate')
                : t('sqlWorkspace.guard.estimate', { count: confirm.estimate, formatted: formatNumber(confirm.estimate, i18n.language) })}
          </span>
          {confirm.statements.length > 1 ? (
            <span data-testid="sql-write-confirm-many"> {t('sqlWorkspace.guard.manyWrites', { count: confirm.statements.length })}</span>
          ) : null}
        </p>
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches) onResolve(typed);
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('sqlWorkspace.guard.typeAria')}
          placeholder={t('sqlWorkspace.guard.typePlaceholder', { name: confirm.connectionName })}
          data-testid="sql-write-confirm-input"
          className="focus-ring h-7 w-full rounded-md border border-border-default bg-bg-inset px-2 font-mono text-body-sm text-fg-base placeholder:text-fg-subtle"
        />
      </div>
    </ModalShell>
  );
}

/** Asks once per session for the password of a connection that does not keep it. */
export function SqlPasswordPrompt({
  name,
  refused,
  kind = 'database',
  keepsInKeychain = false,
  onSubmit,
  onCancel,
}: {
  name: string;
  refused: boolean;
  /** The connection keeps its password in the keychain, so the one typed here is saved once it signs in. */
  keepsInKeychain?: boolean;
  /** `ssh` asks for the tunnel's password or key passphrase. */
  kind?: SqlDbSecretKind;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [value, setValue] = useState('');
  return (
    <ModalShell
      onClose={onCancel}
      size="max-w-[460px]"
      labelledById={titleId}
      headerClose="esc"
      icon={<KeyRound size={16} aria-hidden="true" />}
      header={
        <h2 id={titleId} className="truncate text-body-lg font-semibold text-fg-base">
          {t(kind === 'ssh' ? 'sqlWorkspace.connection.sshPasswordPromptTitle' : 'sqlWorkspace.connection.passwordPromptTitle', { name })}
        </h2>
      }
      footerLegend={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="sql-password-connect"
            disabled={value.length === 0}
            onClick={() => onSubmit(value)}
            className="focus-ring inline-flex h-[26px] items-center rounded-md bg-accent px-3 text-body-sm font-semibold text-fg-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {t('sqlWorkspace.connection.connect')}
          </button>
          <button type="button" onClick={onCancel} className={BUTTON}>
            {t('sqlWorkspace.connection.cancel')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5 py-1">
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.length > 0) onSubmit(value);
          }}
          autoComplete="off"
          aria-label={t('sqlWorkspace.connection.passwordFor', { name })}
          data-testid="sql-password-input"
          className="focus-ring h-[30px] w-full rounded-md border border-border-default bg-bg-inset px-2 font-mono text-body-sm text-fg-base"
        />
        {refused ? (
          <span role="alert" data-testid="sql-password-refused" className="text-caption text-error-fg">
            {t('sqlWorkspace.connection.passwordRefused')}
          </span>
        ) : null}
        <span className="text-caption text-fg-muted">
          {t(keepsInKeychain ? 'sqlWorkspace.connection.passwordPromptKeychainHint' : 'sqlWorkspace.connection.passwordPromptHint')}
        </span>
      </div>
    </ModalShell>
  );
}
