import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';

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
  addSnippet: (snippet: Omit<Snippet, 'id' | 'createdAt'>) => void;
  removeSnippet: (id: string) => void;
  updateSnippet: (id: string, updates: Partial<Pick<Snippet, 'label' | 'description' | 'code'>>) => void;
}

let counter = 0;

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: [],

      addSnippet: (snippet) => {
        counter++;
        const newSnippet: Snippet = {
          ...snippet,
          id: `snippet-${Date.now()}-${counter}`,
          createdAt: Date.now(),
        };
        set((state) => ({ snippets: [...state.snippets, newSnippet] }));
      },

      removeSnippet: (id) =>
        set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) })),

      updateSnippet: (id, updates) =>
        set((state) => ({
          snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        })),
    }),
    {
      name: 'runlang-snippets',
      partialize: (state) => ({ snippets: state.snippets }),
    }
  )
);
