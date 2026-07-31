import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITY_CATALOG,
  type DeveloperUtilityId,
} from '../data/developerUtilityCatalog';
import { createMigrate } from './persistence/migrationRegistry';

export const UTILITY_WORKSPACE_STORAGE_KEY = 'lingua-utility-workspace';
const LEGACY_UTILITY_STATE_STORAGE_KEY = 'lingua-utility-state';

/** Internal one-shot input delivered from Smart Paste to a utility panel. */
export interface PendingUtilityInput {
  utilityId: DeveloperUtilityId;
  input: string;
}

export interface UtilityWorkspaceState {
  /** Currently selected tool in the full-screen Utilities workspace. */
  activeUtilityId: DeveloperUtilityId;
  /** Session-only Smart Paste payload; never included in persisted state. */
  pendingUtilityInput: PendingUtilityInput | null;
  setActiveUtilityId: (utilityId: DeveloperUtilityId) => void;
  setPendingUtilityInput: (pending: PendingUtilityInput | null) => void;
}

const KNOWN_UTILITY_IDS = new Set<DeveloperUtilityId>(
  DEVELOPER_UTILITY_CATALOG.map(utility => utility.id)
);

function isKnownUtilityId(value: unknown): value is DeveloperUtilityId {
  return typeof value === 'string' && KNOWN_UTILITY_IDS.has(value as DeveloperUtilityId);
}

/**
 * Convert the pre-split history-store envelope into the dedicated workspace
 * selection envelope. Returning users keep their last selected tool while the
 * history implementation remains activation-scoped. Invalid or corrupt legacy
 * payloads deliberately fall back to the default selection.
 */
export function migrateLegacyUtilityWorkspaceEnvelope(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as { state?: { activeUtilityId?: unknown } };
    const activeUtilityId = envelope.state?.activeUtilityId;
    if (!isKnownUtilityId(activeUtilityId)) return null;
    return JSON.stringify({ state: { activeUtilityId }, version: 1 });
  } catch {
    return null;
  }
}

const storage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    const current = localStorage.getItem(name);
    if (current || name !== UTILITY_WORKSPACE_STORAGE_KEY) return current;

    const migrated = migrateLegacyUtilityWorkspaceEnvelope(
      localStorage.getItem(LEGACY_UTILITY_STATE_STORAGE_KEY)
    );
    if (migrated) localStorage.setItem(name, migrated);
    return migrated;
  },
  setItem: (name: string, value: string): void => localStorage.setItem(name, value),
  removeItem: (name: string): void => localStorage.removeItem(name),
}));

/**
 * Startup-safe Developer Utilities activation state.
 *
 * The editor store must select a requested utility synchronously before its
 * workspace tab renders. Keeping only selection plus the transient Smart Paste
 * hand-off here avoids eagerly loading history limits, entitlement persistence,
 * favorites, and upsell behavior on every app boot.
 */
export const useUtilityWorkspaceStore = create<UtilityWorkspaceState>()(
  persist(
    set => ({
      activeUtilityId: DEFAULT_DEVELOPER_UTILITY_ID,
      pendingUtilityInput: null,
      setActiveUtilityId: activeUtilityId => {
        if (!isKnownUtilityId(activeUtilityId)) return;
        set({ activeUtilityId });
      },
      setPendingUtilityInput: pending => {
        if (pending && !isKnownUtilityId(pending.utilityId)) return;
        set({ pendingUtilityInput: pending });
      },
    }),
    {
      name: UTILITY_WORKSPACE_STORAGE_KEY,
      version: 1,
      migrate: createMigrate(UTILITY_WORKSPACE_STORAGE_KEY),
      storage,
      partialize: state => ({ activeUtilityId: state.activeUtilityId }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const candidate = persisted as Partial<UtilityWorkspaceState>;
        return {
          ...current,
          activeUtilityId: isKnownUtilityId(candidate.activeUtilityId)
            ? candidate.activeUtilityId
            : DEFAULT_DEVELOPER_UTILITY_ID,
        };
      },
    }
  )
);
