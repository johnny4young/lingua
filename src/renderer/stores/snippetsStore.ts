import i18next from 'i18next';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { createMigrate } from './persistence/migrationRegistry';
import { currentEffectiveTier } from './licenseSelectors';
import { withinSnippetBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';

export interface Snippet {
  id: string;
  language: Language;
  label: string;
  description: string;
  code: string;
  createdAt: number;
}

interface SnippetsState {
  snippets: Snippet[];
  pendingLinkedSnippetId: string | null;
  /**
   * Returns the new snippet's id on success, or `null` when the Free tier
   * ceiling blocks the create. Callers should branch on null and skip any
   * selection state updates in that case.
   */
  addSnippet: (snippet: Omit<Snippet, 'id' | 'createdAt'>) => string | null;
  removeSnippet: (id: string) => void;
  /**
   * UX Sweep T2 fold B — re-insert a previously-removed snippet at its
   * original list index so the undo toast can restore it verbatim
   * (same id, same `createdAt`). `maxCountAfterRestore` is the list
   * length before deletion; undo may restore grandfathered snippets up to
   * that count, but it must not exceed it if the user created a
   * replacement before pressing Undo. A no-op when a snippet with that id
   * already exists (double-undo guard); the index is clamped into range.
   */
  restoreSnippet: (
    snippet: Snippet,
    index: number,
    maxCountAfterRestore: number
  ) => void;
  updateSnippet: (
    id: string,
    updates: Partial<Pick<Snippet, 'label' | 'description' | 'code' | 'language'>>
  ) => void;
  setPendingLinkedSnippetId: (id: string | null) => void;
}

let counter = 0;

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: [],
      pendingLinkedSnippetId: null,

      addSnippet: (snippet) => {
        // RL-060: enforce the Free tier snippet ceiling. Grandfather any
        // snippets already saved above the ceiling (users don't lose
        // data); only future additions are refused.
        const current = useSnippetsStore.getState().snippets.length;
        if (!withinSnippetBudget(currentEffectiveTier(), current + 1)) {
          pushUpsellNotice({
            messageKey: 'upsell.freeCeilingReached',
            featureLabel: i18next.t('upsell.feature.extraSnippets'),
          });
          // RL-065 — emit feature.blocked so the consenting user's
          // telemetry reflects the snippet-ceiling friction.
          void trackEvent('feature.blocked', {
            entitlement: 'snippets',
            tier: currentEffectiveTier(),
          });
          return null;
        }
        counter++;
        const newSnippet: Snippet = {
          ...snippet,
          id: `snippet-${Date.now()}-${counter}`,
          createdAt: Date.now(),
        };
        set((state) => ({ snippets: [...state.snippets, newSnippet] }));
        return newSnippet.id;
      },

      removeSnippet: (id) =>
        set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) })),

      restoreSnippet: (snippet, index, maxCountAfterRestore) =>
        set((state) => {
          if (state.snippets.some((s) => s.id === snippet.id)) return state;
          if (state.snippets.length + 1 > maxCountAfterRestore) return state;
          const clamped = Math.max(0, Math.min(index, state.snippets.length));
          const next = state.snippets.slice();
          next.splice(clamped, 0, snippet);
          return { snippets: next };
        }),

      updateSnippet: (id, updates) =>
        set((state) => ({
          snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        })),

      setPendingLinkedSnippetId: (id) => set({ pendingLinkedSnippetId: id }),
    }),
    {
      name: 'lingua-snippets',
      version: 1,
      migrate: createMigrate('lingua-snippets'),
      partialize: (state) => ({ snippets: state.snippets }),
    }
  )
);
