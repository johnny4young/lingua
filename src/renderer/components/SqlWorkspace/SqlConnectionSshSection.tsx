/**
 * The SSH tunnel part of the connection sheet: bastion, sign-in (password,
 * key and passphrase, or the agent), jump hosts, and what ~/.ssh/config and
 * the agent say about the bastion. The password or passphrase stays in the
 * sheet's state until it goes to main.
 */

import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SSH_JUMPS, SQL_SSH_AUTHS, type SqlConnectionSsh, type SqlSshHop } from '../../../shared/sqlConnections';
import type { SqlDbSshInfo } from '../../../shared/sqlDb';
import { sqlDbBridge } from '../../runtime/sqlRemote';
import { cn } from '../../utils/cn';
import { Toggle } from '../Settings/shared';
import { BUTTON, INPUT, LABEL, Segmented } from './sqlConnectionForm';

const BLANK: SqlConnectionSsh = { host: '', port: 22, user: '', auth: 'agent', secretMode: 'none' };
const LOOKUP_DELAY_MS = 400;
const portOf = (value: string) => Number(value.replace(/\D/g, '')) || 22;

interface Props {
  ssh: SqlConnectionSsh | undefined;
  /** The database as the bastion reaches it, for the chain. */
  target: string;
  onChange: (ssh: SqlConnectionSsh | undefined) => void;
  secret: string;
  onSecret: (value: string) => void;
  /** Main keeps a password or passphrase for this tunnel already. */
  secretKept: boolean;
  /** No keychain on this system: secrets last the session. */
  sessionOnly: boolean;
  onPickKey: () => void;
}

export function SqlConnectionSshSection({ ssh, target, onChange, secret, onSecret, secretKept, sessionOnly, onPickKey }: Props) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SqlDbSshInfo | null>(null);
  const host = ssh?.host ?? '';

  useEffect(() => {
    if (!host) return;
    let live = true;
    const timer = setTimeout(() => {
      void sqlDbBridge()
        ?.sshInfo(host)
        .then((next) => {
          if (live) setInfo(next);
        })
        .catch(() => undefined);
    }, LOOKUP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [host]);

  const set = (next: Partial<SqlConnectionSsh>) => onChange({ ...(ssh ?? BLANK), ...next });
  const setHop = (index: number, next: Partial<SqlSshHop>) => set({ jumps: (ssh?.jumps ?? []).map((hop, i) => (i === index ? { ...hop, ...next } : hop)) });
  const keepModes = sessionOnly ? (['session'] as const) : (['keychain', 'session'] as const);

  const useConfig = () => {
    const found = info?.config;
    if (!found || !ssh) return;
    const jumps = found.proxyJump?.slice(0, MAX_SSH_JUMPS).map((hop) => ({ host: hop.host, port: hop.port ?? 22, user: hop.user ?? found.user ?? ssh.user }));
    set({
      host: found.hostName ?? found.alias,
      ...(found.port ? { port: found.port } : {}),
      ...(found.user ? { user: found.user } : {}),
      ...(found.identityFile ? { auth: 'key' as const, keyPath: found.identityFile, secretMode: ssh.secretMode === 'none' ? 'none' : ssh.secretMode } : {}),
      ...(jumps && jumps.length > 0 ? { jumps } : {}),
    });
  };

  return (
    <section data-testid="sql-connection-ssh" className="flex flex-col gap-2.5 rounded-[10px] border border-border-subtle px-3 py-2.5">
      <span className="flex items-center gap-2 text-body-sm text-fg-base">
        <Toggle value={ssh !== undefined} onChange={() => onChange(ssh ? undefined : BLANK)} aria-label={t('sqlWorkspace.connection.ssh.toggle')} data-testid="sql-connection-ssh-toggle" />
        {t('sqlWorkspace.connection.ssh.toggle')}
      </span>
      {ssh ? (
        <>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-2.5">
            <label>
              <span className={LABEL}>{t('sqlWorkspace.connection.ssh.host')}</span>
              <input value={ssh.host} onChange={(event) => set({ host: event.target.value.trim() })} spellCheck={false} data-testid="sql-connection-ssh-host" className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t('sqlWorkspace.connection.port')}</span>
              <input value={String(ssh.port)} inputMode="numeric" onChange={(event) => set({ port: portOf(event.target.value) })} data-testid="sql-connection-ssh-port" className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t('sqlWorkspace.connection.user')}</span>
              <input value={ssh.user} onChange={(event) => set({ user: event.target.value.trim() })} spellCheck={false} autoComplete="off" data-testid="sql-connection-ssh-user" className={INPUT} />
            </label>
          </div>

          <div>
            <span className={LABEL}>{t('sqlWorkspace.connection.ssh.auth')}</span>
            <Segmented
              value={ssh.auth}
              options={SQL_SSH_AUTHS}
              onChange={(auth) => {
                onSecret('');
                set({
                  auth,
                  secretMode: auth === 'agent' ? 'none' : auth === 'password' ? keepModes[0] : 'none',
                  ...(auth === 'password' ? { jumps: undefined } : {}),
                  ...(auth === 'key' ? {} : { keyPath: undefined }),
                });
              }}
              label={t('sqlWorkspace.connection.ssh.auth')}
              testId="sql-connection-ssh-auth"
              render={(option) => t(`sqlWorkspace.connection.ssh.authOption.${option}`)}
            />
            <p data-testid="sql-connection-ssh-info" className="mt-1.5 text-caption text-fg-muted">
              {[
                ssh.auth === 'agent'
                  ? info?.agent.available
                    ? t('sqlWorkspace.connection.ssh.agentKeys', { count: info.agent.keys ?? 0 })
                    : t('sqlWorkspace.connection.ssh.noAgent')
                  : null,
                info?.config ? t('sqlWorkspace.connection.ssh.configDetected', { alias: info.config.alias }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {info?.config ? (
                <button type="button" onClick={useConfig} data-testid="sql-connection-ssh-use-config" className="focus-ring ml-2 rounded font-medium text-accent-fg hover:underline">
                  {t('sqlWorkspace.connection.ssh.useConfig')}
                </button>
              ) : null}
            </p>
          </div>

          {ssh.auth === 'key' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-testid="sql-connection-ssh-key" onClick={onPickKey} className={cn(BUTTON, 'h-6 rounded-full text-caption', ssh.keyPath && 'border-accent text-accent-fg')}>
                {ssh.keyPath ? ssh.keyPath.split(/[\\/]/).pop() : t('sqlWorkspace.connection.ssh.chooseKey')}
              </button>
              <Segmented
                value={ssh.secretMode}
                options={['none', ...keepModes]}
                onChange={(secretMode) => {
                  if (secretMode === 'none') onSecret('');
                  set({ secretMode });
                }}
                label={t('sqlWorkspace.connection.ssh.passphrase')}
                testId="sql-connection-ssh-passphrase-mode"
                render={(option) => (option === 'none' ? t('sqlWorkspace.connection.ssh.noPassphrase') : t(`sqlWorkspace.connection.passwordMode.${option}`))}
              />
            </div>
          ) : null}
          {(ssh.auth === 'password' || (ssh.auth === 'key' && ssh.secretMode !== 'none')) ? (
            <div className="grid grid-cols-[1fr_1fr] items-start gap-2.5">
              <label>
                <span className={LABEL}>{t(ssh.auth === 'password' ? 'sqlWorkspace.connection.ssh.password' : 'sqlWorkspace.connection.ssh.passphrase')}</span>
                <input
                  type="password"
                  value={secret}
                  onChange={(event) => onSecret(event.target.value)}
                  placeholder={secretKept ? t('sqlWorkspace.connection.passwordKept') : ''}
                  autoComplete="off"
                  data-testid="sql-connection-ssh-secret"
                  className={INPUT}
                />
              </label>
              {ssh.auth === 'password' ? (
                <div>
                  <span className={LABEL}>{t('sqlWorkspace.connection.savePassword')}</span>
                  <Segmented
                    value={ssh.secretMode === 'none' ? keepModes[0] : ssh.secretMode}
                    options={keepModes}
                    onChange={(secretMode) => set({ secretMode })}
                    label={t('sqlWorkspace.connection.savePassword')}
                    testId="sql-connection-ssh-password-mode"
                    render={(option) => t(`sqlWorkspace.connection.passwordMode.${option}`)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <span className={LABEL}>{t('sqlWorkspace.connection.ssh.jumps')}</span>
            {(ssh.jumps ?? []).map((hop, index) => (
              <div key={index} data-testid="sql-connection-ssh-jump" className="mt-1 grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-2">
                <input value={hop.host} onChange={(event) => setHop(index, { host: event.target.value.trim() })} spellCheck={false} aria-label={t('sqlWorkspace.connection.ssh.jumpHost', { n: index + 1 })} className={cn(INPUT, 'mt-0')} />
                <input value={String(hop.port)} inputMode="numeric" onChange={(event) => setHop(index, { port: portOf(event.target.value) })} aria-label={t('sqlWorkspace.connection.port')} className={cn(INPUT, 'mt-0')} />
                <input value={hop.user} onChange={(event) => setHop(index, { user: event.target.value.trim() })} spellCheck={false} aria-label={t('sqlWorkspace.connection.user')} className={cn(INPUT, 'mt-0')} />
                <button
                  type="button"
                  onClick={() => set({ jumps: (ssh.jumps ?? []).filter((_, i) => i !== index) })}
                  aria-label={t('sqlWorkspace.connection.ssh.removeJump', { host: hop.host || index + 1 })}
                  className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg-base"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="sql-connection-ssh-add-jump"
                disabled={ssh.auth === 'password' || (ssh.jumps?.length ?? 0) >= MAX_SSH_JUMPS}
                onClick={() => set({ jumps: [...(ssh.jumps ?? []), { host: '', port: 22, user: ssh.user }] })}
                className={cn(BUTTON, 'h-6 text-caption')}
              >
                <Plus size={12} aria-hidden="true" />
                {t('sqlWorkspace.connection.ssh.addJump')}
              </button>
              {ssh.auth === 'password' ? <span className="text-caption text-fg-subtle">{t('sqlWorkspace.connection.ssh.jumpsNeedKey')}</span> : null}
            </div>
            <p data-testid="sql-connection-ssh-chain" className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-caption text-fg-muted">
              {[t('sqlWorkspace.connection.ssh.you'), ...(ssh.jumps ?? []).map((hop) => hop.host || '…'), ssh.host || '…', target || '…'].map((part, index) => (
                <span key={index} className="flex items-center gap-1.5">
                  {index > 0 ? <span aria-hidden="true" className="text-fg-subtle">→</span> : null}
                  <span className="rounded border border-border-subtle px-1.5">{part}</span>
                </span>
              ))}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
