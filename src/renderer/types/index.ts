/**
 * Historical renderer type compatibility facade.
 *
 * Production code imports domain leaves directly. Keep this module export-only
 * for external and test compatibility; do not add behavior or new production
 * consumers here.
 */

export type { RichOutputPayload } from '../../shared/richOutput';
export type { ScopeSnapshot } from '../../shared/scopeSnapshot';
export type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
export type * from './console';
export type * from './editor';
export type * from './execution';
export type * from './language';
export type * from './settings';
