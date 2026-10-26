/**
 * implementationa + 3b — resolution preview.
 *
 * Renders beneath the URL row whenever the request references
 * `{{tokens}}` OR an environment is active. Three parts:
 *
 *   - The effective URL with NON-secret vars resolved and
 *     SECRET vars shown as their `{{key}}` placeholder. Built via
 *     `maskSecretsForCapsule` so a resolved secret value can NEVER reach
 *     this surface.
 *   - The injected Auth header (name + masked value),
 *     derived from `buildAuthHeader(maskSecretsForCapsule(request).auth)`.
 *     Because the masked request keeps a secret auth `{{token}}` as its
 *     placeholder, this line shows e.g. `Authorization: Bearer {{token}}`,
 *     never the resolved secret. Only rendered when the active auth config
 *     actually injects a header.
 *   - A chip row of the distinct variables referenced, each
 *     tagged: plain (resolved, non-secret), `secret` (resolved but
 *     masked), or `unresolved` (red — no binding in the active env).
 *     This replaces the brittle in-input overlay: the user sees their
 *     vars + state without the value of any secret being printed.
 *
 * Privacy invariant: this component prints NO resolved secret value
 * anywhere — not in the URL line, not in the auth line, not in a chip.
 * Secret chips show only the key + a "secret" badge; the auth line uses
 * the masked request, so a secret auth field stays `{{key}}`.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findResolvedVariables,
  findUnresolvedVariables,
  HTTP_COLLECTION_SCOPE_ID,
  maskSecretsForCapsule,
  type HttpEnvironmentV1,
  type HttpVariableSource,
} from '../../../shared/httpEnvironment';
import '../../i18n/httpBuilderCatalog';
import { SCOPE_TINTS, tintPill } from './httpScopeColors';
import { buildAuthHeader } from '../../../shared/httpWorkspaceHeaders';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';

export interface HttpEnvironmentPreviewProps {
  request: HttpRequestV1;
  env: HttpEnvironmentV1 | null;
  /** With variable scopes on: chips take their scope's colour and say where the value comes from. */
  sources?: ReadonlyMap<string, HttpVariableSource>;
  /** Chain tag keys: their chips open the tag. */
  chainKeys?: ReadonlySet<string>;
  openTag?: string | null;
  onOpenTag?: (key: string) => void;
}

type ChipState = 'resolved' | 'secret' | 'unresolved';

export function HttpEnvironmentPreview({
  request,
  env,
  sources,
  chainKeys,
  openTag,
  onOpenTag,
}: HttpEnvironmentPreviewProps) {
  const { t } = useTranslation();

  // The masked request: non-secret vars resolved, secret vars left as
  // `{{key}}`. Its URL is the safe "Resolves to" display; its auth block
  // feeds the masked Auth-header line below.
  const masked = useMemo(
    () => maskSecretsForCapsule(request, env),
    [request, env]
  );
  const maskedUrl = masked.url;

  // The injected Auth header (name + masked value). Built
  // from the MASKED request's auth, so a secret auth `{{token}}` stays
  // `{{token}}` here (never the resolved secret). `null` when the active
  // auth config injects nothing (kind none / empty fields).
  const authHeader = useMemo(() => buildAuthHeader(masked.auth), [masked.auth]);

  const chips = useMemo(() => {
    const secretKeys = new Set<string>();
    for (const variable of env?.variables ?? []) {
      if (variable.secret) {
        secretKeys.add(variable.key);
      } else {
        // Duplicate rows use the same last-edit-wins semantics as the
        // interpolation engine. If a later non-secret binding shadows an
        // older secret row, the chip should reflect the effective binding.
        secretKeys.delete(variable.key);
      }
    }
    const resolved = findResolvedVariables(request, env);
    const unresolved = findUnresolvedVariables(request, env);
    const out: Array<{ key: string; state: ChipState }> = [];
    for (const key of resolved) {
      out.push({ key, state: secretKeys.has(key) ? 'secret' : 'resolved' });
    }
    for (const key of unresolved) {
      out.push({ key, state: 'unresolved' });
    }
    return out;
  }, [request, env]);

  // Only render when there is something to show: an active env, the
  // request references at least one token, or an auth header is injected.
  // The collection's own view is not an active environment, so alone it shows nothing.
  const hasContent = (env !== null && env.id !== HTTP_COLLECTION_SCOPE_ID) || chips.length > 0 || authHeader !== null;
  if (!hasContent) return null;

  return (
    <div
      data-testid="http-environment-preview"
      className="flex shrink-0 flex-col gap-1 rounded-md border border-border-subtle bg-bg-inset px-2.5 py-1.5"
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-wide text-fg-subtle">
          {t('httpWorkspace.environment.preview.label')}
        </span>
        <span
          data-testid="http-environment-preview-url"
          className="min-w-0 flex-1 truncate font-mono text-caption text-fg-base"
          title={maskedUrl}
        >
          {maskedUrl}
        </span>
      </div>
      {authHeader !== null ? (
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-wide text-fg-subtle">
            {t('httpWorkspace.environment.preview.authLabel')}
          </span>
          <span
            data-testid="http-environment-preview-auth"
            className="min-w-0 flex-1 truncate font-mono text-caption text-fg-base"
            title={`${authHeader.name}: ${authHeader.value}`}
          >
            {`${authHeader.name}: ${authHeader.value}`}
          </span>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {chips.map((chip) => {
            const isUnresolved = chip.state === 'unresolved';
            const isSecret = chip.state === 'secret';
            const source = isUnresolved ? undefined : sources?.get(chip.key);
            const origin = source
              ? t(source.overrides.length > 0 ? 'httpWorkspace.scope.fromOverrides' : 'httpWorkspace.scope.from', {
                  scope: t(`httpWorkspace.scope.${source.scope}`),
                  overridden: source.overrides.map((scope) => t(`httpWorkspace.scope.${scope}`)).join(', '),
                })
              : undefined;
            const chipNode = (
              <span
                key={`${chip.state}:${chip.key}`}
                {...(source ? { 'data-scope': source.scope, title: origin, style: tintPill(SCOPE_TINTS[source.scope]) } : {})}
                data-testid={
                  isUnresolved
                    ? 'http-environment-preview-chip-unresolved'
                    : isSecret
                      ? 'http-environment-preview-chip-secret'
                      : 'http-environment-preview-chip'
                }
                className={
                  isUnresolved
                    ? 'inline-flex items-center gap-1 rounded-sm border border-error-fg/40 bg-error/10 px-1.5 py-0.5 font-mono text-eyebrow text-error-fg'
                    : 'inline-flex items-center gap-1 rounded-sm bg-bg-panel-alt px-1.5 py-0.5 font-mono text-eyebrow text-fg-muted'
                }
              >
                <span>{chip.key}</span>
                {origin ? <span className="sr-only">{origin}</span> : null}
                {isSecret ? (
                  <span className="rounded-sm bg-bg-panel px-1 text-nano font-semibold uppercase tracking-wide text-fg-subtle">
                    {t('httpWorkspace.environment.preview.secretBadge')}
                  </span>
                ) : null}
                {isUnresolved ? (
                  <span className="rounded-sm px-1 text-nano font-semibold uppercase tracking-wide">
                    {t('httpWorkspace.environment.preview.unresolvedBadge')}
                  </span>
                ) : null}
              </span>
            );
            return chainKeys?.has(chip.key) && onOpenTag ? (
              <button
                key={`tag:${chip.key}`}
                type="button"
                data-testid="http-chain-chip"
                data-tag={chip.key}
                aria-pressed={openTag === chip.key}
                aria-label={t('httpWorkspace.chain.tag.open', { name: chip.key })}
                onClick={() => onOpenTag(openTag === chip.key ? '' : chip.key)}
                className="focus-ring rounded-sm"
              >
                {chipNode}
              </button>
            ) : (
              chipNode
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
