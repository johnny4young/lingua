/**
 * implementation — HTTP workspace barrel.
 *
 * Re-exports the root panel (the only surface other modules need
 * to import) plus the curl-import helper (consumed by the future
 * internal importer registry).
 */

export { HttpWorkspacePanel } from './HttpWorkspacePanel';
export { HttpWorkspaceView } from './HttpWorkspaceView';
export { HttpStatusPill } from './HttpStatusPill';
export { tryParseCurl, type ParsedCurl } from './curlImport';
