import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, LockKeyhole, Play, Server, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  LocalMcpRunningState,
  LocalMcpStartFailureReason,
  LocalMcpState,
} from '../../../shared/localMcp';
import { useProjectStore } from '../../stores/projectStore';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { StatusBadge } from '../ui/StatusBadge';

function startFailureKey(reason: LocalMcpStartFailureReason): string {
  return `settings.localMcp.error.${reason}`;
}

function connectionConfig(state: LocalMcpRunningState): string {
  return JSON.stringify(
    {
      name: 'lingua',
      type: 'http',
      url: state.endpoint,
      headers: { Authorization: `Bearer ${state.accessToken}` },
    },
    null,
    2
  );
}

export function LocalMcpSection() {
  const { t } = useTranslation();
  const bridge = window.lingua.localMcp;
  const currentProject = useProjectStore(state => state.currentProject);
  const [serverState, setServerState] = useState<LocalMcpState>({ status: 'stopped' });
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'endpoint' | 'token' | 'config' | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onStateChanged(next => {
      if (active) setServerState(next);
    });
    void bridge.getState().then(next => {
      if (active) setServerState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const config = useMemo(
    () => (serverState.status === 'running' ? connectionConfig(serverState) : ''),
    [serverState]
  );

  const copy = async (kind: 'endpoint' | 'token' | 'config', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(current => (current === kind ? null : current)), 1600);
    } catch {
      setErrorKey('settings.localMcp.error.copy');
    }
  };

  const start = async () => {
    if (!bridge || !currentProject || !acknowledged) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await bridge.start(currentProject.rootId, {
        readOnlySourceAccess: true,
      });
      if (result.ok) {
        setServerState(result.state);
        return;
      }
      setErrorKey(startFailureKey(result.reason));
    } catch {
      setErrorKey('settings.localMcp.error.unavailable');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!bridge) return;
    setBusy(true);
    setErrorKey(null);
    try {
      setServerState(await bridge.stop());
      setAcknowledged(false);
      setRevealed(false);
    } catch {
      setErrorKey('settings.localMcp.error.unavailable');
    } finally {
      setBusy(false);
    }
  };

  const desktopUnavailable = !bridge;
  const projectUnavailable = !currentProject;

  return (
    <div className="space-y-7" data-testid="local-mcp-section">
      <SettingsSection
        eyebrow={t('settings.localMcp.title')}
        description={t('settings.localMcp.description')}
      >
        <SpecCard>
          <SpecRow
            label={t('settings.localMcp.status.label')}
            description={
              serverState.status === 'running'
                ? t('settings.localMcp.status.runningHint', {
                    project: serverState.projectName,
                  })
                : t('settings.localMcp.status.stoppedHint')
            }
            control={
              <StatusBadge tone={serverState.status === 'running' ? 'success' : 'neutral'}>
                {t(`settings.localMcp.status.${serverState.status}`)}
              </StatusBadge>
            }
          />
          <SpecRow
            label={t('settings.localMcp.scope.label')}
            description={t('settings.localMcp.scope.hint')}
            control={
              <span className="max-w-64 truncate font-mono text-caption text-fg-muted">
                {currentProject?.name ?? t('settings.localMcp.scope.none')}
              </span>
            }
            last
          />
        </SpecCard>

        {serverState.status === 'running' ? (
          <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-4">
            <div className="flex items-start gap-3">
              <Server size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-fg-base">
                  {t('settings.localMcp.connection.title')}
                </p>
                <p className="mt-1 text-caption leading-relaxed text-fg-subtle">
                  {t('settings.localMcp.connection.hint')}
                </p>
              </div>
            </div>

            <ConnectionRow
              label={t('settings.localMcp.connection.endpoint')}
              value={serverState.endpoint}
              copied={copied === 'endpoint'}
              onCopy={() => void copy('endpoint', serverState.endpoint)}
            />
            <ConnectionRow
              label={t('settings.localMcp.connection.token')}
              value={revealed ? serverState.accessToken : '••••••••••••••••••••••••••••••••'}
              copied={copied === 'token'}
              onCopy={() => void copy('token', serverState.accessToken)}
              action={
                <button
                  type="button"
                  className="button-ghost px-2"
                  onClick={() => setRevealed(value => !value)}
                  aria-label={
                    revealed
                      ? t('settings.localMcp.connection.hideToken')
                      : t('settings.localMcp.connection.revealToken')
                  }
                >
                  {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-caption text-fg-subtle">
                {t('settings.localMcp.activity', {
                  requests: serverState.requestCount,
                  tools: serverState.toolCallCount,
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void copy('config', config)}
                >
                  {copied === 'config' ? <Check size={12} /> : <Copy size={12} />}
                  {copied === 'config'
                    ? t('settings.localMcp.connection.copied')
                    : t('settings.localMcp.connection.copyConfig')}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void stop()}
                >
                  <Square size={11} />
                  {busy
                    ? t('settings.localMcp.actions.stopping')
                    : t('settings.localMcp.actions.stop')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border-subtle bg-bg-inset p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={acknowledged}
                onChange={event => setAcknowledged(event.target.checked)}
                disabled={desktopUnavailable || projectUnavailable || busy}
              />
              <span>
                <span className="block text-body font-medium text-fg-base">
                  {t('settings.localMcp.consent.label')}
                </span>
                <span className="mt-1 block text-caption leading-relaxed text-fg-subtle">
                  {t('settings.localMcp.consent.hint')}
                </span>
              </span>
            </label>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
              <p className="text-caption text-fg-subtle">
                {desktopUnavailable
                  ? t('settings.localMcp.desktopOnly')
                  : projectUnavailable
                    ? t('settings.localMcp.openProject')
                    : t('settings.localMcp.ready')}
              </p>
              <button
                type="button"
                className="button-primary shrink-0"
                disabled={desktopUnavailable || projectUnavailable || !acknowledged || busy}
                onClick={() => void start()}
              >
                <Play size={12} />
                {busy
                  ? t('settings.localMcp.actions.starting')
                  : t('settings.localMcp.actions.start')}
              </button>
            </div>
          </div>
        )}

        {errorKey ? (
          <p role="alert" className="text-body-sm text-error" data-testid="local-mcp-error">
            {t(errorKey)}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        eyebrow={t('settings.localMcp.security.title')}
        description={t('settings.localMcp.security.description')}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {(['loopback', 'token', 'readOnly', 'lifecycle'] as const).map(item => (
            <div
              key={item}
              className="flex gap-3 rounded-lg border border-border-subtle bg-bg-inset p-3"
            >
              <LockKeyhole size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <div>
                <p className="text-body-sm font-medium text-fg-base">
                  {t(`settings.localMcp.security.${item}.title`)}
                </p>
                <p className="mt-1 text-caption leading-relaxed text-fg-subtle">
                  {t(`settings.localMcp.security.${item}.hint`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function ConnectionRow({
  label,
  value,
  copied,
  onCopy,
  action,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3 py-2">
      <span className="w-16 shrink-0 text-eyebrow font-semibold uppercase text-fg-subtle">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate text-caption text-fg-muted">{value}</code>
      {action}
      <button
        type="button"
        className="button-ghost px-2"
        onClick={onCopy}
        aria-label={t('settings.localMcp.connection.copyValue', { label })}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}
