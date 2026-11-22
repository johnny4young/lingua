import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collectSecretKeys,
  findResolvedVariables,
  findUnresolvedVariables,
  looksSecret,
  looksSecretValue,
  type HttpEnvironmentV1,
  type HttpVariableSource,
} from '../../../shared/httpEnvironment';
import { suggestAssertions } from '../../../shared/httpSnapshot';
import { runAssertions } from '../../../shared/httpWorkspaceAssertions';
import type { HttpAssertion, HttpRequestV1, HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import type { HttpTestAnswers, HttpTestVariable } from './HttpAssertionsTab';

interface HttpTestAnswersInput {
  readonly assertions: readonly HttpAssertion[];
  readonly response: HttpResponseV1 | undefined;
  /** The newest response is shown: only it can suggest checks. */
  readonly latest: boolean;
  /** The Tests tab is open; suggestions and variables are read only then. */
  readonly visible: boolean;
  readonly snapshotChanges: number | undefined;
  /** The live draft, as the resolution preview reads it. */
  readonly request: HttpRequestV1;
  readonly env: HttpEnvironmentV1 | null;
  readonly sources: ReadonlyMap<string, HttpVariableSource>;
  /** The active environment's name, which labels its variables. */
  readonly environmentName: string | undefined;
  /** Replaces the draft's checks; a suggestion is appended through it. */
  readonly applyAssertions: (next: HttpAssertion[]) => void;
}

/** What the shown response answers in the Tests tab, and how many checks hold. */
export function useHttpTestAnswers({
  assertions,
  response,
  latest,
  visible,
  snapshotChanges,
  request,
  env,
  sources,
  environmentName,
  applyAssertions,
}: HttpTestAnswersInput) {
  const { t } = useTranslation();
  const onAddSuggestion = useCallback(
    (assertion: Omit<HttpAssertion, 'id'>) => applyAssertions([...assertions, { id: crypto.randomUUID(), ...assertion }]),
    [assertions, applyAssertions]
  );
  const results = useMemo(
    () => (response ? new Map(runAssertions(response, assertions).map((result) => [result.id, result])) : undefined),
    [response, assertions]
  );
  const suggestions = useMemo(
    () => (visible && latest && response?.kind === 'success' ? suggestAssertions(response, assertions) : []),
    [visible, latest, response, assertions]
  );
  const variables = useMemo<HttpTestVariable[]>(() => {
    if (!visible) return [];
    // The last row for a key wins, as in interpolation.
    const rows = new Map((env?.variables ?? []).map((row) => [row.key, row]));
    const secrets = collectSecretKeys(env);
    const scopeLabel = (source: HttpVariableSource | undefined) =>
      source?.scope === 'environment' && environmentName ? environmentName : source ? t(`httpWorkspace.scope.${source.scope}`) : '';
    const out: HttpTestVariable[] = [];
    for (const key of findResolvedVariables(request, env)) {
      const source = sources.get(key);
      const row = rows.get(key);
      // Named or shaped like a credential masks too, as in the resolved URL and cURL.
      const secret = secrets.has(key) || Boolean(source?.secret) || looksSecret(key) || (row !== undefined && looksSecretValue(row.value));
      out.push({
        key,
        ...(source ? { scope: source.scope } : {}),
        scopeLabel: scopeLabel(source),
        state: secret ? 'secret' : 'resolved',
        ...(secret || row === undefined ? {} : { value: row.value }),
      });
    }
    for (const key of findUnresolvedVariables(request, env)) out.push({ key, scopeLabel: '', state: 'unresolved' });
    return out;
  }, [visible, request, env, sources, environmentName, t]);

  const checks = (results?.size ?? 0) + (snapshotChanges === undefined ? 0 : 1);
  const held =
    results && checks > 0
      ? { passed: [...results.values()].filter((result) => result.pass).length + (snapshotChanges === 0 ? 1 : 0), total: checks }
      : undefined;
  const tests: HttpTestAnswers = {
    ...(response ? { response } : {}),
    ...(results ? { results } : {}),
    ...(snapshotChanges === undefined ? {} : { snapshotChanges }),
    suggestions,
    onAddSuggestion,
    variables,
  };
  return { tests, held };
}
