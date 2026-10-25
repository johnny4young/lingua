import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/httpBuilderCatalog';
import { chainOrder, chainPasses, chainValue, type HttpChainTag } from '../../../shared/httpChain';
import { HTTP_CHAIN_RULES, type HttpChainRule, type HttpRequestV1, type HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { formatRelativeTime } from '../../utils/timeLabels';
import { ENVIRONMENT_TINTS, SCOPE_TINTS, tintPill } from './httpScopeColors';

const EYEBROW = 'shrink-0 text-eyebrow font-semibold uppercase tracking-wide text-fg-subtle';
const label = (request: HttpRequestV1) => request.name || request.url;

/** The status badge of a node: green on 2xx, red otherwise, a dash before any response. */
function StatusBadge({ response }: { response: HttpResponseV1 | undefined }) {
  const tint = !response ? ENVIRONMENT_TINTS.gray : chainPasses(response) ? ENVIRONMENT_TINTS.green : ENVIRONMENT_TINTS.red;
  return (
    <span className="rounded-sm px-1 font-mono text-micro font-semibold tabular-nums" style={tintPill(tint)}>
      {response ? response.status || '!' : '—'}
    </span>
  );
}

/**
 * The chain a request's tags lead to, derived from the capture rules: each
 * source with its last status and time, then the request itself, plus the
 * open tag's source, path, live value and sending rule.
 */
export function HttpChainSection({
  request,
  tags,
  secretKeys,
  openKey,
  onClose,
  onRun,
}: {
  request: HttpRequestV1;
  tags: readonly HttpChainTag[];
  secretKeys: ReadonlySet<string>;
  openKey: string | null;
  onClose: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const requests = useWorkspaceToolStore((state) => state.requests);
  const responses = useWorkspaceToolStore((state) => state.responsesByRequestId);
  const byId = useMemo(() => new Map(requests.map((entry) => [entry.id, entry])), [requests]);
  const { order, cycle } = useMemo(
    () => chainOrder(request.id, requests.map((entry) => (entry.id === request.id ? request : entry))),
    [request, requests]
  );
  const open = tags.find((tag) => tag.key === openKey);
  const openSource = open ? byId.get(open.sourceId) : undefined;

  return (
    <section data-testid="http-chain" className="flex shrink-0 flex-col gap-2 rounded-md border border-border-subtle px-2.5 py-1.5">
      {open && openSource ? (
        <HttpChainTagPanel
          // A new response remounts the panel, so its age counts from then.
          key={`${open.key}:${responses[open.sourceId]?.[0]?.recordedAt ?? ''}`}
          tag={open}
          request={request}
          source={openSource}
          latest={responses[open.sourceId]?.[0]}
          secret={secretKeys.has(open.key)}
          onClose={onClose}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <span className={EYEBROW}>{t('httpWorkspace.chain.title')}</span>
        {cycle ? (
          <span data-testid="http-chain-cycle" className="text-error-fg">
            {t('httpWorkspace.chain.cycleShort')}
          </span>
        ) : (
          [...order, request.id].map((id, index) => {
            const node = id === request.id ? request : byId.get(id);
            const latest = responses[id]?.[0];
            if (!node) return null;
            return (
              <span key={id} data-testid="http-chain-node" data-request={id} className="inline-flex items-center gap-1.5">
                {index > 0 ? <span className="text-fg-subtle" aria-hidden="true">→</span> : null}
                <StatusBadge response={latest} />
                <span className="text-fg-base">{label(node)}</span>
                <span className="font-mono text-micro tabular-nums text-fg-subtle">
                  {latest ? `${latest.durationMs} ms` : t('httpWorkspace.chain.waits')}
                </span>
              </span>
            );
          })
        )}
        <button
          type="button"
          onClick={onRun}
          disabled={cycle}
          data-testid="http-chain-run"
          className="focus-ring ml-auto rounded-md border border-border-subtle px-2 py-0.5 text-caption font-medium text-fg-base hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('httpWorkspace.chain.run')}
        </button>
      </div>
    </section>
  );
}

function HttpChainTagPanel({
  tag,
  request,
  source,
  latest,
  secret,
  onClose,
}: {
  tag: HttpChainTag;
  request: HttpRequestV1;
  source: HttpRequestV1;
  latest: HttpResponseV1 | undefined;
  secret: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [now] = useState(() => Date.now());
  const tools = useWorkspaceToolStore.getState;
  const value = chainValue(tag, latest);
  const setPath = (path: string) =>
    tools().updateRequest(source.id, {
      captures: (source.captures ?? []).map((capture) => (capture.id === tag.capture.id ? { ...capture, path } : capture)),
    });
  const setRule = (rule: HttpChainRule) => tools().updateRequest(request.id, { chainRules: { ...request.chainRules, [tag.key]: rule } });

  return (
    <div
      data-testid="http-chain-tag"
      role="group"
      aria-label={t('httpWorkspace.chain.tag.title', { name: tag.key })}
      className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-caption"
    >
      <span className={EYEBROW}>{t('httpWorkspace.chain.tag.title', { name: tag.key })}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('httpWorkspace.chain.tag.close')}
        title={t('httpWorkspace.chain.tag.close')}
        className="focus-ring ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-fg-base"
      >
        <X size={12} aria-hidden="true" />
      </button>
      <span className="text-fg-subtle">{t('httpWorkspace.chain.tag.source')}</span>
      <span data-testid="http-chain-tag-source" className="truncate font-mono text-fg-base">
        {`${label(source)} · ${source.method} ${source.url}`}
      </span>
      <span className="text-fg-subtle">
        {t(tag.capture.source === 'body-json' ? 'httpWorkspace.chain.tag.path' : tag.capture.source === 'header' ? 'httpWorkspace.chain.tag.header' : 'httpWorkspace.chain.tag.status')}
      </span>
      {tag.capture.source === 'status' ? (
        <span className="font-mono text-fg-base">{t('httpWorkspace.chain.tag.status')}</span>
      ) : (
        <input
          type="text"
          value={tag.capture.path}
          onChange={(event) => setPath(event.target.value)}
          spellCheck={false}
          aria-label={t(tag.capture.source === 'body-json' ? 'httpWorkspace.chain.tag.path' : 'httpWorkspace.chain.tag.header')}
          data-testid="http-chain-tag-path"
          className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base focus:border-border-strong focus:outline-none"
        />
      )}
      <span className="text-fg-subtle">{t('httpWorkspace.chain.tag.preview')}</span>
      <span data-testid="http-chain-tag-preview" className="truncate font-mono">
        {value === null ? (
          <span className="text-fg-subtle">{t('httpWorkspace.chain.tag.none')}</span>
        ) : (
          <>
            <span style={{ color: SCOPE_TINTS.environment.fg }}>{secret ? '••••••' : JSON.stringify(value)}</span>
            <span className="text-fg-subtle">
              {' · '}
              {latest ? t('httpWorkspace.chain.tag.from', { age: formatRelativeTime(Math.min(Date.parse(latest.recordedAt), now), now, i18n.language) }) : null}
            </span>
          </>
        )}
      </span>
      <span className="text-fg-subtle">{t('httpWorkspace.chain.tag.when')}</span>
      <div role="radiogroup" aria-label={t('httpWorkspace.chain.tag.when')} className="flex flex-wrap gap-1">
        {HTTP_CHAIN_RULES.map((rule) => (
          <button
            key={rule}
            type="button"
            role="radio"
            aria-checked={tag.rule === rule}
            data-rule={rule}
            onClick={() => setRule(rule)}
            className={
              tag.rule === rule
                ? 'focus-ring rounded-md bg-bg-inset px-2 py-0.5 text-caption font-semibold text-fg-base'
                : 'focus-ring rounded-md px-2 py-0.5 text-caption text-fg-subtle hover:text-fg-base'
            }
          >
            {t(`httpWorkspace.chain.rule.${rule}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
