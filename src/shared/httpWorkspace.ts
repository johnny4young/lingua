/**
 * Historical HTTP workspace compatibility facade.
 *
 * Production code imports the dedicated leaves directly so it activates only
 * the domains it owns. This barrel remains for external and test compatibility;
 * do not add behavior or new production consumers here.
 */

export { BASELINE_SENSITIVE_HEADERS } from './httpSensitiveHeaders';
export { parseHttpRequest, parseHttpResponse } from './httpWorkspacePersistence';
export * from './httpWorkspaceAssertions';
export * from './httpWorkspaceCaptures';
export * from './httpWorkspaceCurl';
export * from './httpWorkspaceHeaders';
export * from './httpWorkspaceQuery';
export * from './httpWorkspaceSchema';
