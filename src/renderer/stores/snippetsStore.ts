import i18next from 'i18next';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { currentEffectiveTier } from '../hooks/useEntitlement';
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

      updateSnippet: (id, updates) =>
        set((state) => ({
          snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        })),

      setPendingLinkedSnippetId: (id) => set({ pendingLinkedSnippetId: id }),
    }),
    {
      name: 'lingua-snippets',
      partialize: (state) => ({ snippets: state.snippets }),
    }
  )
);
