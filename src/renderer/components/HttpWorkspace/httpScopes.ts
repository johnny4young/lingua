import { useMemo } from 'react';
import { chainRows, chainTags, latestFor, type HttpChainTag } from '../../../shared/httpChain';
import {
  createEnvVariable,
  layeredEnvironment,
  variableSources,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
  type HttpVariableLayers,
  type HttpVariableSource,
} from '../../../shared/httpEnvironment';
import type { HttpRequestV1, HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';

type ScopedRequest = HttpRequestV1 | null | undefined;

/** Chain options of one send: run every source first, or none (a source sent by its chain). */
export interface HttpSendOptions {
  readonly forceChain?: boolean;
  readonly skipChain?: boolean;
}
type ResponsesById = Readonly<Record<string, ReadonlyArray<HttpResponseV1>>>;

export const httpScopesEnabled = (): boolean => useSettingsStore.getState().featureFlags.httpScopes === true;
export const httpChainEnabled = (): boolean => useSettingsStore.getState().featureFlags.httpChainTags === true;

interface LayerInputs {
  readonly scopes: boolean;
  readonly chain: boolean;
  readonly collection: HttpVariableLayers['collection'];
  readonly requests: ReadonlyArray<HttpRequestV1>;
  readonly responses: ResponsesById;
}

function layersFor(request: ScopedRequest, env: HttpEnvironmentV1 | null, inputs: LayerInputs): { layers: HttpVariableLayers; tags: HttpChainTag[] } {
  const collection = inputs.scopes ? inputs.collection : [];
  const own = inputs.scopes ? (request?.variables ?? []) : [];
  const tags = inputs.chain && request ? chainTags(request, inputs.requests) : [];
  // A tag stays masked wherever a lower scope already marks its key secret.
  const secretKeys = new Set([...collection, ...(env?.variables ?? [])].filter((row) => row.secret).map((row) => row.key));
  const chain = chainRows(tags, (id) => latestFor(inputs.responses, id, env?.id ?? null), secretKeys);
  return { layers: { collection, environment: env, chain, request: own }, tags };
}

/**
 * The variables a request resolves against: collection, environment, chain
 * tags and request, each with its Labs flag on; the active environment alone
 * with both off.
 */
export function scopedEnvironmentFor(request: ScopedRequest, env: HttpEnvironmentV1 | null): HttpEnvironmentV1 | null {
  const scopes = httpScopesEnabled();
  const chain = httpChainEnabled();
  if (!scopes && !chain) return env;
  const state = useWorkspaceToolStore.getState();
  const inputs = { scopes, chain, collection: state.collectionVariables, requests: state.requests, responses: state.responsesByRequestId };
  return layeredEnvironment(layersFor(request, env, inputs).layers);
}

/** A variable row of an environment, for opening the manager on it. */
export interface HttpEnvironmentFocus {
  readonly environmentId: string;
  readonly variableId: string;
}

/**
 * Rows the other environments define for keys the active one lacks, first
 * environment in list order winning, as fresh rows ready to append. A secret
 * comes over as its key only: a credential belongs to one environment, so the
 * user types the one for this environment.
 */
export function rowsFromOtherEnvironments(
  keys: readonly string[],
  environments: ReadonlyArray<HttpEnvironmentV1>,
  activeId: string
): HttpEnvVariableV1[] {
  const rows: HttpEnvVariableV1[] = [];
  for (const key of keys) {
    for (const env of environments) {
      if (env.id === activeId) continue;
      // An empty plain value is no definition.
      const found = [...env.variables].reverse().find((variable) => variable.key === key && (variable.secret || variable.value !== ''));
      if (found) {
        rows.push(createEnvVariable({ key, value: found.secret ? '' : found.value, secret: found.secret }));
        break;
      }
    }
  }
  return rows;
}

interface ScopedView {
  /** The variable scopes flag, which also brings the environment colours. */
  scopes: boolean;
  env: HttpEnvironmentV1 | null;
  sources: ReadonlyMap<string, HttpVariableSource> | null;
  tags: HttpChainTag[];
  /** For the URL colours: tags whose source sends first count as chain values. */
  check: { env: HttpEnvironmentV1 | null; sources: ReadonlyMap<string, HttpVariableSource> | null };
  /** Tag keys with no value yet: those Send fills by sending the source first, and all of them for Run chain. */
  deferred: { send: ReadonlySet<string>; chain: ReadonlySet<string> };
}

/**
 * `scopedEnvironmentFor` for render, plus which scope supplies each key and
 * the request's chain tags (sources null and no tags with both flags off).
 */
export function useScopedEnvironment(request: ScopedRequest, env: HttpEnvironmentV1 | null): ScopedView {
  const scopes = useSettingsStore((state) => state.featureFlags.httpScopes === true);
  const chain = useSettingsStore((state) => state.featureFlags.httpChainTags === true);
  const collection = useWorkspaceToolStore((state) => state.collectionVariables);
  const requests = useWorkspaceToolStore((state) => state.requests);
  const responses = useWorkspaceToolStore((state) => state.responsesByRequestId);
  return useMemo(() => {
    if (!scopes && !chain) return { scopes, env, sources: null, tags: [], check: { env, sources: null }, deferred: { send: new Set(), chain: new Set() } };
    const { layers, tags } = layersFor(request, env, { scopes, chain, collection, requests, responses });
    const resolved = new Set((layers.chain ?? []).map((row) => row.key));
    // A tag with no value yet still resolves at Send when its rule sends the source first.
    const unresolved = tags.filter((tag) => !resolved.has(tag.key));
    const pending = unresolved.filter((tag) => tag.rule !== 'last');
    const standIns = pending.map((tag) => ({ id: `pending-${tag.key}`, key: tag.key, value: 'pending', secret: false }));
    const checkLayers = pending.length > 0 ? { ...layers, chain: [...(layers.chain ?? []), ...standIns] } : layers;
    const sources = variableSources(layers);
    return {
      scopes,
      env: layeredEnvironment(layers),
      sources,
      tags,
      check: checkLayers === layers ? { env: layeredEnvironment(layers), sources } : { env: layeredEnvironment(checkLayers), sources: variableSources(checkLayers) },
      deferred: { send: new Set(pending.map((tag) => tag.key)), chain: new Set(unresolved.map((tag) => tag.key)) },
    };
  }, [scopes, chain, env, collection, request, requests, responses]);
}
