/**
 * Env-var scope store (RL-011 Slice B).
 *
 * Holds the three user-owned tiers (`global`, `project`, `tab`) behind a
 * `persist`-backed Zustand store and exposes a pure
 * `resolveEffectiveEnv()` helper that composes them with the main-process
 * `processEnv` snapshot via the Slice A merger.
 *
 * Wiring contract (per `ENV_VARS_ADR.md`):
 *   processEnv  (lowest — main-process snapshot)
 *   < global    (renderer-owned, persisted, project-agnostic)
 *   < project   (renderer-owned, keyed by projectId)
 *   < tab       (renderer-owned, keyed by tabId — highest)
 *
 * This slice intentionally stops at the plumbing. A follow-up slice threads
 * the resolved record into `RunnerManager.execute` so Go / Rust / Python
 * subprocesses see the merged env. No UI is introduced here — Slice C owns
 * the Settings panel.
 *
 * Sanitization on rehydrate: every tier runs through `sanitizeScope` so a
 * tampered `localStorage` can't smuggle invalid keys (reserved names,
 * leading digits, oversized values) into the merged output.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type EnvVarScope,
  mergeEnvScopes,
  sanitizeScope,
  validateEnvVarKey,
} from '../../shared/envVarScopes';

const STORAGE_KEY = 'lingua-env-vars';

function sanitizeProjectScopes(raw: unknown): Record<string, EnvVarScope> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, EnvVarScope> = {};
  for (const [projectId, scope] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof projectId !== 'string' || projectId.length === 0) continue;
    const sanitized = sanitizeScope(scope as Record<string, string> | undefined);
    if (Object.keys(sanitized).length > 0) out[projectId] = sanitized;
  }
  return out;
}

function sanitizeTabScopes(raw: unknown): Record<string, EnvVarScope> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, EnvVarScope> = {};
  for (const [tabId, scope] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tabId !== 'string' || tabId.length === 0) continue;
    const sanitized = sanitizeScope(scope as Record<string, string> | undefined);
    if (Object.keys(sanitized).length > 0) out[tabId] = sanitized;
  }
  return out;
}

export interface EnvVarsStoreState {
  /** Always-applied scope (lowest of the user-owned tiers). */
  global: EnvVarScope;
  /** Per-project overrides keyed by projectId. */
  project: Record<string, EnvVarScope>;
  /** Per-tab overrides keyed by tabId. */
  tab: Record<string, EnvVarScope>;

  setGlobalVar: (key: string, value: string) => boolean;
  removeGlobalVar: (key: string) => void;

  setProjectVar: (projectId: string, key: string, value: string) => boolean;
  removeProjectVar: (projectId: string, key: string) => void;

  setTabVar: (tabId: string, key: string, value: string) => boolean;
  removeTabVar: (tabId: string, key: string) => void;

  clearScope: (tier: 'global' | 'project' | 'tab', scopeKey?: string) => void;

  /**
   * Resolve the merged env for a given runtime context. `processEnv` comes
   * from `window.lingua.env.snapshot()` (desktop) or `{}` (web). The scope
   * tiers are read from the store.
   */
  resolveEffectiveEnv: (
    processEnv: Record<string, string>,
    projectId: string | null,
    tabId: string | null
  ) => Record<string, string>;
}

function writeScope(
  current: EnvVarScope,
  key: string,
  value: string
): { next: EnvVarScope; accepted: boolean } {
  const validation = validateEnvVarKey(key);
  if (!validation.ok) return { next: current, accepted: false };
  if (typeof value !== 'string') return { next: current, accepted: false };
  const next: EnvVarScope = { ...current, [key]: value };
  // Re-sanitize to enforce per-scope / per-value caps. If sanitization
  // drops the key (e.g. 101st key in a 100-cap scope), the write is
  // rejected as if the validator had refused it.
  const sanitized = sanitizeScope(next);
  if (!(key in sanitized)) return { next: current, accepted: false };
  return { next: sanitized, accepted: true };
}

export const useEnvVarsStore = create<EnvVarsStoreState>()(
  persist(
    (set, get) => ({
      global: {},
      project: {},
      tab: {},

      setGlobalVar: (key, value) => {
        const { next, accepted } = writeScope(get().global, key, value);
        if (!accepted) return false;
        set({ global: next });
        return true;
      },

      removeGlobalVar: (key) => {
        const current = get().global;
        if (!(key in current)) return;
        const next = { ...current };
        delete next[key];
        set({ global: next });
      },

      setProjectVar: (projectId, key, value) => {
        if (typeof projectId !== 'string' || projectId.length === 0) return false;
        const currentScope = get().project[projectId] ?? {};
        const { next, accepted } = writeScope(currentScope, key, value);
        if (!accepted) return false;
        set((state) => ({
          project: { ...state.project, [projectId]: next },
        }));
        return true;
      },

      removeProjectVar: (projectId, key) => {
        const scope = get().project[projectId];
        if (!scope || !(key in scope)) return;
        const nextScope = { ...scope };
        delete nextScope[key];
        set((state) => {
          const nextProject = { ...state.project };
          if (Object.keys(nextScope).length === 0) {
            delete nextProject[projectId];
          } else {
            nextProject[projectId] = nextScope;
          }
          return { project: nextProject };
        });
      },

      setTabVar: (tabId, key, value) => {
        if (typeof tabId !== 'string' || tabId.length === 0) return false;
        const currentScope = get().tab[tabId] ?? {};
        const { next, accepted } = writeScope(currentScope, key, value);
        if (!accepted) return false;
        set((state) => ({
          tab: { ...state.tab, [tabId]: next },
        }));
        return true;
      },

      removeTabVar: (tabId, key) => {
        const scope = get().tab[tabId];
        if (!scope || !(key in scope)) return;
        const nextScope = { ...scope };
        delete nextScope[key];
        set((state) => {
          const nextTab = { ...state.tab };
          if (Object.keys(nextScope).length === 0) {
            delete nextTab[tabId];
          } else {
            nextTab[tabId] = nextScope;
          }
          return { tab: nextTab };
        });
      },

      clearScope: (tier, scopeKey) => {
        if (tier === 'global') {
          set({ global: {} });
          return;
        }
        if (tier === 'project') {
          if (scopeKey) {
            set((state) => {
              const next = { ...state.project };
              delete next[scopeKey];
              return { project: next };
            });
          } else {
            set({ project: {} });
          }
          return;
        }
        if (tier === 'tab') {
          if (scopeKey) {
            set((state) => {
              const next = { ...state.tab };
              delete next[scopeKey];
              return { tab: next };
            });
          } else {
            set({ tab: {} });
          }
        }
      },

      resolveEffectiveEnv: (processEnv, projectId, tabId) => {
        const { global, project, tab } = get();
        return mergeEnvScopes({
          processEnv,
          global,
          project: projectId ? project[projectId] : undefined,
          tab: tabId ? tab[tabId] : undefined,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        global: state.global,
        project: state.project,
        tab: state.tab,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<EnvVarsStoreState>;
        return {
          ...currentState,
          global: sanitizeScope(persisted.global),
          project: sanitizeProjectScopes(persisted.project),
          tab: sanitizeTabScopes(persisted.tab),
        };
      },
    }
  )
);
