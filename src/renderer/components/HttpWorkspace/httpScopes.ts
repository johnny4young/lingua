import { useMemo } from 'react';
import {
  createEnvVariable,
  layeredEnvironment,
  variableSources,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
  type HttpVariableLayers,
  type HttpVariableSource,
} from '../../../shared/httpEnvironment';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';

type ScopedRequest = Pick<HttpRequestV1, 'variables'> | null | undefined;

export const httpScopesEnabled = (): boolean => useSettingsStore.getState().featureFlags.httpScopes === true;

function layers(request: ScopedRequest, env: HttpEnvironmentV1 | null, collection: HttpVariableLayers['collection']): HttpVariableLayers {
  return { collection, environment: env, request: request?.variables ?? [] };
}

/**
 * The variables a request resolves against: collection, environment and
 * request with the scopes flag on, the active environment alone without it.
 */
export function scopedEnvironmentFor(request: ScopedRequest, env: HttpEnvironmentV1 | null): HttpEnvironmentV1 | null {
  if (!httpScopesEnabled()) return env;
  return layeredEnvironment(layers(request, env, useWorkspaceToolStore.getState().collectionVariables));
}

/**
 * Rows the other environments define for keys the active one lacks, first
 * environment in list order winning, as fresh rows ready to append.
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
      const found = [...env.variables].reverse().find((variable) => variable.key === key);
      if (found) {
        rows.push(createEnvVariable({ key, value: found.value, secret: found.secret }));
        break;
      }
    }
  }
  return rows;
}

/** `scopedEnvironmentFor` for render, plus which scope supplies each key (null with the flag off). */
export function useScopedEnvironment(
  request: ScopedRequest,
  env: HttpEnvironmentV1 | null
): { env: HttpEnvironmentV1 | null; sources: ReadonlyMap<string, HttpVariableSource> | null } {
  const enabled = useSettingsStore((state) => state.featureFlags.httpScopes === true);
  const collection = useWorkspaceToolStore((state) => state.collectionVariables);
  const variables = request?.variables;
  return useMemo(() => {
    if (!enabled) return { env, sources: null };
    const scoped = layers({ variables }, env, collection);
    return { env: layeredEnvironment(scoped), sources: variableSources(scoped) };
  }, [enabled, env, collection, variables]);
}
