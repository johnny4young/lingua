/**
 * RL-097 Slice 1 — HTTP workspace barrel.
 *
 * Re-exports the root panel (the only surface other modules need
 * to import) plus the curl-import helper (consumed by the future
 * RL-100 importer registry).
 */

export { HttpWorkspacePanel } from './HttpWorkspacePanel';
export { HttpStatusPill } from './HttpStatusPill';
export { tryParseCurl, type ParsedCurl } from './curlImport';
