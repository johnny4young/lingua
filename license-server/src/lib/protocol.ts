/**
 * Current machine-readable license-server response protocol.
 *
 * Keep this value in parity with
 * `src/shared/licenseServerProtocol.ts:LICENSE_SERVER_PROTOCOL_VERSION`. The
 * worker has its own TypeScript project boundary, so importing renderer/shared
 * source here would couple the deployable worker to the desktop build graph.
 */

export const LICENSE_SERVER_PROTOCOL_VERSION = 1 as const;

export function isVersionedLicenseServerPath(path: string): boolean {
  return (
    path === '/licenses' ||
    path.startsWith('/licenses/') ||
    path === '/trials' ||
    path.startsWith('/trials/')
  );
}

export function stampLicenseServerProtocol(path: string, body: unknown): unknown {
  if (!isVersionedLicenseServerPath(path)) return body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  return {
    ...(body as Record<string, unknown>),
    protocolVersion: LICENSE_SERVER_PROTOCOL_VERSION,
  };
}
