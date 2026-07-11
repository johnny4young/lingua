import type { EditorState } from '../types';
import type { EditorGet, EditorSet } from './editorStoreContext';
import {
  languageSupportsStdin,
  MAX_INPUT_ARGS_PER_SET,
  MAX_INPUT_SET_NAME_LENGTH,
  MAX_INPUT_SETS_PER_TAB,
} from './editorTabUtils';

function normalizeInputSetName(name: string): string {
  return name.trim().slice(0, MAX_INPUT_SET_NAME_LENGTH);
}

function normalizeInputArgs(args: readonly string[] | null): string[] | undefined {
  if (!args || args.length === 0) return undefined;
  // The UI contract is one argument per line: strip Windows \r line
  // endings and drop blank lines (a trailing newline or pasted CRLF text
  // must not become empty argv entries). Blank lines are removed BEFORE
  // the cap so they never consume argument slots.
  const cleaned = args
    .map((arg) => (arg.endsWith('\r') ? arg.slice(0, -1) : arg))
    .filter((arg) => arg.trim().length > 0);
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_INPUT_ARGS_PER_SET);
}

/** IT2-F5 — per-tab stdin, argv, and named input-set actions. */
export function createInputActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  | 'setTabStdinBuffer'
  | 'setTabInputArgs'
  | 'saveTabInputSet'
  | 'selectTabInputSet'
  | 'renameTabInputSet'
  | 'deleteTabInputSet'
> {
  return {
    setTabStdinBuffer: (id, text) => {
      const target = get().tabs.find((tab) => tab.id === id);
      if (!target || !languageSupportsStdin(target.language)) return;
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== id) return tab;
          const nextStdin = text === null || text === '' ? undefined : text;
          const inputSets = tab.activeInputSetId
            ? tab.inputSets?.map((inputSet) =>
                inputSet.id === tab.activeInputSetId
                  ? { ...inputSet, stdin: nextStdin ?? '' }
                  : inputSet
              )
            : tab.inputSets;
          const { stdinBuffer: _drop, ...rest } = tab;
          void _drop;
          return {
            ...rest,
            ...(nextStdin !== undefined ? { stdinBuffer: nextStdin } : {}),
            ...(inputSets !== undefined ? { inputSets } : {}),
          };
        }),
      }));
    },

    setTabInputArgs: (id, args) => {
      const normalized = normalizeInputArgs(args);
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== id || !languageSupportsStdin(tab.language)) return tab;
          const inputSets = tab.activeInputSetId
            ? tab.inputSets?.map((inputSet) =>
                inputSet.id === tab.activeInputSetId
                  ? { ...inputSet, args: normalized }
                  : inputSet
              )
            : tab.inputSets;
          const { inputArgs: _drop, ...rest } = tab;
          void _drop;
          return {
            ...rest,
            ...(normalized !== undefined ? { inputArgs: normalized } : {}),
            ...(inputSets !== undefined ? { inputSets } : {}),
          };
        }),
      }));
    },

    saveTabInputSet: (id, name) => {
      const normalizedName = normalizeInputSetName(name);
      if (!normalizedName) return null;
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (!tab || !languageSupportsStdin(tab.language)) return null;
      const existing = tab.inputSets ?? [];
      const active = tab.activeInputSetId
        ? existing.find((inputSet) => inputSet.id === tab.activeInputSetId)
        : undefined;
      const duplicate = existing.some(
        (inputSet) =>
          inputSet.id !== active?.id &&
          inputSet.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
      );
      if (duplicate || (!active && existing.length >= MAX_INPUT_SETS_PER_TAB)) return null;

      const inputSetId = active?.id ?? crypto.randomUUID();
      const nextInputSet = {
        id: inputSetId,
        name: normalizedName,
        stdin: tab.stdinBuffer ?? '',
        ...(tab.inputArgs && tab.inputArgs.length > 0 ? { args: [...tab.inputArgs] } : {}),
      };
      set((state) => ({
        tabs: state.tabs.map((candidate) => {
          if (candidate.id !== id) return candidate;
          const inputSets = active
            ? (candidate.inputSets ?? []).map((inputSet) =>
                inputSet.id === inputSetId ? nextInputSet : inputSet
              )
            : [...(candidate.inputSets ?? []), nextInputSet];
          return { ...candidate, inputSets, activeInputSetId: inputSetId };
        }),
      }));
      return inputSetId;
    },

    selectTabInputSet: (id, inputSetId) => {
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== id || !languageSupportsStdin(tab.language)) return tab;
          if (inputSetId === null) {
            const { activeInputSetId: _drop, ...rest } = tab;
            void _drop;
            return rest;
          }
          const inputSet = tab.inputSets?.find((candidate) => candidate.id === inputSetId);
          if (!inputSet) return tab;
          const { stdinBuffer: _dropStdin, inputArgs: _dropArgs, ...rest } = tab;
          void _dropStdin;
          void _dropArgs;
          return {
            ...rest,
            activeInputSetId: inputSet.id,
            ...(inputSet.stdin ? { stdinBuffer: inputSet.stdin } : {}),
            ...(inputSet.args?.length ? { inputArgs: [...inputSet.args] } : {}),
          };
        }),
      }));
    },

    renameTabInputSet: (id, inputSetId, name) => {
      const normalizedName = normalizeInputSetName(name);
      if (!normalizedName) return false;
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (!tab?.inputSets?.some((inputSet) => inputSet.id === inputSetId)) return false;
      const duplicate = tab.inputSets.some(
        (inputSet) =>
          inputSet.id !== inputSetId &&
          inputSet.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
      );
      if (duplicate) return false;
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                inputSets: candidate.inputSets?.map((inputSet) =>
                  inputSet.id === inputSetId
                    ? { ...inputSet, name: normalizedName }
                    : inputSet
                ),
              }
            : candidate
        ),
      }));
      return true;
    },

    deleteTabInputSet: (id, inputSetId) => {
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== id || !tab.inputSets?.some((inputSet) => inputSet.id === inputSetId)) {
            return tab;
          }
          const nextSets = tab.inputSets.filter((inputSet) => inputSet.id !== inputSetId);
          const { inputSets: _dropSets, activeInputSetId: _dropActive, ...rest } = tab;
          void _dropSets;
          void _dropActive;
          return {
            ...rest,
            ...(nextSets.length > 0 ? { inputSets: nextSets } : {}),
            ...(tab.activeInputSetId !== undefined && tab.activeInputSetId !== inputSetId
              ? { activeInputSetId: tab.activeInputSetId }
              : {}),
          };
        }),
      }));
    },
  };
}
