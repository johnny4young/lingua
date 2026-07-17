/** Visual request-builder tabs for the HTTP workspace editor. */

import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  HttpAssertion,
  HttpCaptureRule,
  HttpMethod,
  HttpQueryParam,
  HttpRequestAuth,
  HttpRequestBody,
  HttpRequestBodyKind,
  HttpRequestHeader,
} from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';
import { HttpAssertionsTab } from './HttpAssertionsTab';
import { HttpAuthTab } from './HttpAuthTab';
import { HttpCaptureTab } from './HttpCaptureTab';
import { HttpParamsTab } from './HttpParamsTab';

export type HttpRequestBuilderTab =
  | 'params'
  | 'auth'
  | 'headers'
  | 'body'
  | 'capture'
  | 'assert';

interface HttpRequestBuilderTabsProps {
  readonly method: HttpMethod;
  readonly activeTab: HttpRequestBuilderTab;
  readonly onSelectTab: (tab: HttpRequestBuilderTab) => void;
  readonly params: readonly HttpQueryParam[];
  readonly onAddParam: () => void;
  readonly onUpdateParam: (index: number, patch: Partial<HttpQueryParam>) => void;
  readonly onRemoveParam: (index: number) => void;
  readonly auth: HttpRequestAuth | undefined;
  readonly onAuthChange: (auth: HttpRequestAuth) => void;
  readonly headers: readonly HttpRequestHeader[];
  readonly onAddHeader: () => void;
  readonly onUpdateHeader: (index: number, patch: Partial<HttpRequestHeader>) => void;
  readonly onRemoveHeader: (index: number) => void;
  readonly body: HttpRequestBody | undefined;
  readonly onBodyKindChange: (kind: HttpRequestBodyKind) => void;
  readonly onBodyContentChange: (content: string) => void;
  readonly captures: readonly HttpCaptureRule[];
  readonly onAddCapture: () => void;
  readonly onUpdateCapture: (index: number, patch: Partial<HttpCaptureRule>) => void;
  readonly onRemoveCapture: (index: number) => void;
  readonly assertions: readonly HttpAssertion[];
  readonly onAddAssertion: () => void;
  readonly onUpdateAssertion: (index: number, patch: Partial<HttpAssertion>) => void;
  readonly onRemoveAssertion: (index: number) => void;
}

export function HttpRequestBuilderTabs({
  method,
  activeTab,
  onSelectTab,
  params,
  onAddParam,
  onUpdateParam,
  onRemoveParam,
  auth,
  onAuthChange,
  headers,
  onAddHeader,
  onUpdateHeader,
  onRemoveHeader,
  body,
  onBodyKindChange,
  onBodyContentChange,
  captures,
  onAddCapture,
  onUpdateCapture,
  onRemoveCapture,
  assertions,
  onAddAssertion,
  onUpdateAssertion,
  onRemoveAssertion,
}: HttpRequestBuilderTabsProps) {
  const { t } = useTranslation();
  const supportsBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const bodyKind: HttpRequestBodyKind = body?.kind ?? 'none';

  const builderTabs = useMemo(() => {
    const enabledParamCount = params.filter(param => param.enabled && param.key.length > 0).length;
    const enabledHeaderCount = headers.filter(
      header => header.enabled && header.name.trim().length > 0
    ).length;
    const enabledCaptureCount = captures.filter(
      capture => capture.enabled && capture.targetVariable.trim().length > 0
    ).length;
    const tabs: Array<{ id: HttpRequestBuilderTab; label: string; badge?: string }> = [
      {
        id: 'params',
        label: t('httpWorkspace.editor.tab.params'),
        ...(enabledParamCount > 0 ? { badge: String(enabledParamCount) } : {}),
      },
      {
        id: 'auth',
        label: t('httpWorkspace.editor.tab.auth'),
        ...((auth?.kind ?? 'none') !== 'none' ? { badge: '•' } : {}),
      },
      {
        id: 'headers',
        label: t('httpWorkspace.editor.tab.headers'),
        ...(enabledHeaderCount > 0 ? { badge: String(enabledHeaderCount) } : {}),
      },
    ];
    if (supportsBody) {
      tabs.push({
        id: 'body',
        label: t('httpWorkspace.editor.tab.body'),
        ...(bodyKind !== 'none' ? { badge: '•' } : {}),
      });
    }
    tabs.push({
      id: 'capture',
      label: t('httpWorkspace.editor.tab.capture'),
      ...(enabledCaptureCount > 0 ? { badge: String(enabledCaptureCount) } : {}),
    });
    const enabledAssertionCount = assertions.filter((a) => a.enabled).length;
    tabs.push({
      id: 'assert',
      label: t('httpWorkspace.editor.tab.assert'),
      ...(enabledAssertionCount > 0 ? { badge: String(enabledAssertionCount) } : {}),
    });
    return tabs;
  }, [assertions, auth?.kind, bodyKind, captures, headers, params, supportsBody, t]);

  // A method switch can remove the Body tab. Derive the fallback during
  // render so the editor never flashes an empty pane or needs a reset effect.
  const effectiveTab: HttpRequestBuilderTab =
    activeTab === 'body' && !supportsBody ? 'params' : activeTab;

  return (
    <>
      <div
        role="tablist"
        aria-label={t('httpWorkspace.editor.tabs.ariaLabel')}
        data-testid="http-request-editor-tabs"
        className="flex shrink-0 items-center gap-1 border-b border-border-subtle pb-1.5"
      >
        {builderTabs.map(tab => {
          const isActive = tab.id === effectiveTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`http-request-editor-tab-${tab.id}`}
              data-active={isActive}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption transition-colors',
                isActive
                  ? 'bg-bg-inset font-semibold text-fg-base'
                  : 'text-fg-subtle hover:text-fg-base'
              )}
            >
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className="rounded-sm bg-bg-panel-alt px-1 text-micro font-semibold tabular-nums text-fg-muted">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {effectiveTab === 'params' ? (
          <HttpParamsTab
            params={params}
            onAdd={onAddParam}
            onUpdate={onUpdateParam}
            onRemove={onRemoveParam}
          />
        ) : null}

        {effectiveTab === 'auth' ? <HttpAuthTab auth={auth} onChange={onAuthChange} /> : null}

        {effectiveTab === 'headers' ? (
          <section data-testid="http-request-editor-headers">
            <header className="flex items-center gap-2">
              <span className="text-caption font-semibold text-fg-base">
                {t('httpWorkspace.editor.headers.label')}
              </span>
              <button
                type="button"
                onClick={onAddHeader}
                data-testid="http-request-editor-headers-add"
                aria-label={t('httpWorkspace.editor.headers.add')}
                title={t('httpWorkspace.editor.headers.add')}
                className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base"
              >
                <Plus size={12} aria-hidden="true" />
              </button>
              {headers.length === 0 ? (
                <span className="text-caption text-fg-subtle">
                  {t('httpWorkspace.editor.headers.empty')}
                </span>
              ) : null}
            </header>
            <ul role="list" className="mt-1 flex flex-col gap-1">
              {headers.map((header, index) => (
                <li key={index} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={header.enabled}
                    onChange={event => onUpdateHeader(index, { enabled: event.target.checked })}
                    data-testid="http-request-editor-header-enabled"
                    aria-label={t('httpWorkspace.editor.headers.enabledAria', {
                      name: header.name,
                    })}
                  />
                  <input
                    type="text"
                    value={header.name}
                    onChange={event => onUpdateHeader(index, { name: event.target.value })}
                    placeholder={t('httpWorkspace.editor.headers.name.placeholder')}
                    aria-label={t('httpWorkspace.editor.headers.nameAria', { index: index + 1 })}
                    data-testid="http-request-editor-header-name"
                    className="h-7 w-36 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                  />
                  <input
                    type="text"
                    value={header.value}
                    onChange={event => onUpdateHeader(index, { value: event.target.value })}
                    placeholder={t('httpWorkspace.editor.headers.value.placeholder')}
                    aria-label={t('httpWorkspace.editor.headers.valueAria', { index: index + 1 })}
                    data-testid="http-request-editor-header-value"
                    className="h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveHeader(index)}
                    aria-label={t('httpWorkspace.editor.headers.removeAria', { index: index + 1 })}
                    className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {effectiveTab === 'body' && supportsBody ? (
          <section data-testid="http-request-editor-body">
            <header className="flex items-center justify-between">
              <span className="text-caption font-semibold text-fg-base">
                {t('httpWorkspace.editor.body.label')}
              </span>
              <select
                value={bodyKind}
                onChange={event => onBodyKindChange(event.target.value as HttpRequestBodyKind)}
                data-testid="http-request-editor-body-kind"
                className="h-6 rounded-md border border-border-subtle bg-bg-panel px-1.5 text-eyebrow font-semibold text-fg-base focus:border-border-strong focus:outline-none"
              >
                <option value="none">{t('httpWorkspace.editor.body.kind.none')}</option>
                <option value="json">{t('httpWorkspace.editor.body.kind.json')}</option>
                <option value="text">{t('httpWorkspace.editor.body.kind.text')}</option>
                <option value="form">{t('httpWorkspace.editor.body.kind.form')}</option>
              </select>
            </header>
            {bodyKind !== 'none' ? (
              <textarea
                value={body?.content ?? ''}
                onChange={event => onBodyContentChange(event.target.value)}
                placeholder={t('httpWorkspace.editor.body.placeholder')}
                aria-label={t('httpWorkspace.editor.body.label')}
                data-testid="http-request-editor-body-content"
                className="mt-1 h-40 w-full resize-y rounded-md border border-border-subtle bg-bg-inset p-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            ) : null}
          </section>
        ) : null}

        {effectiveTab === 'capture' ? (
          <HttpCaptureTab
            captures={captures}
            onAdd={onAddCapture}
            onUpdate={onUpdateCapture}
            onRemove={onRemoveCapture}
          />
        ) : null}
        {effectiveTab === 'assert' ? (
          <HttpAssertionsTab
            assertions={assertions}
            onAdd={onAddAssertion}
            onUpdate={onUpdateAssertion}
            onRemove={onRemoveAssertion}
          />
        ) : null}
      </div>
    </>
  );
}
