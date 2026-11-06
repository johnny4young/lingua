/**
 * Masks what the HTTP store writes to disk. A capture can surface a token the
 * send-time mask did not know yet; the session keeps it for chain tags, but the
 * stored copy must not, or it would sit in plain text beside the vault entry.
 */
import {
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
  looksSecret,
  looksSecretValue,
  maskSecretValuesInResponse,
  maskSecretValuesInText,
} from './httpEnvironment';
import { applyCaptureRules } from './httpWorkspaceCaptures';
import type { HttpCaptureRule, HttpRequestV1, HttpResponseV1 } from './httpWorkspaceSchema';

/** Shorter captures are flags and counts; masking them would garble every body. */
const MIN_CAPTURED_SECRET_CHARS = 8;

/** The values these rules pull from a response into a secret variable. */
export function secretCaptureValues(
  response: Pick<HttpResponseV1, 'status' | 'headers' | 'body'>,
  rules: ReadonlyArray<HttpCaptureRule>,
  secretKeys: ReadonlySet<string>
): string[] {
  return applyCaptureRules(response, rules)
    .filter(({ targetVariable, value }) =>
      value.length >= MIN_CAPTURED_SECRET_CHARS &&
      (secretKeys.has(targetVariable) || looksSecret(targetVariable) || looksSecretValue(value))
    )
    .map(({ value }) => value);
}

interface PersistedHttpData {
  requests: ReadonlyArray<HttpRequestV1>;
  responsesByRequestId: Record<string, ReadonlyArray<HttpResponseV1>>;
  environments: ReadonlyArray<HttpEnvironmentV1>;
  collectionVariables: ReadonlyArray<HttpEnvVariableV1>;
}

export function maskPersistedHttpData(
  data: PersistedHttpData
): Pick<PersistedHttpData, 'requests' | 'responsesByRequestId'> {
  const secretRows = [
    ...data.collectionVariables,
    ...data.environments.flatMap(environment => environment.variables),
    ...data.requests.flatMap(request => request.variables ?? []),
  ].filter(row => row.secret);
  const secretKeys = new Set(secretRows.map(row => row.key));
  const values = new Set(secretRows.map(row => row.value).filter(value => value.length > 0));
  for (const request of data.requests) {
    const rules = request.captures ?? [];
    if (rules.length === 0) continue;
    for (const response of data.responsesByRequestId[request.id] ?? []) {
      for (const value of secretCaptureValues(response, rules, secretKeys)) values.add(value);
    }
    if (request.snapshot) {
      const { status, body } = request.snapshot;
      for (const value of secretCaptureValues({ status, body, headers: [] }, rules, secretKeys)) values.add(value);
    }
  }
  // Longest first, so a secret that contains another is not left half masked.
  const secrets = [...values].sort((a, b) => b.length - a.length);
  const responsesByRequestId: Record<string, ReadonlyArray<HttpResponseV1>> = {};
  for (const [id, list] of Object.entries(data.responsesByRequestId)) {
    responsesByRequestId[id] = list.map(response => maskSecretValuesInResponse(response, secrets));
  }
  const requests = data.requests.map(request =>
    request.snapshot
      ? { ...request, snapshot: { ...request.snapshot, body: maskSecretValuesInText(request.snapshot.body, secrets) } }
      : request
  );
  return { requests, responsesByRequestId };
}
