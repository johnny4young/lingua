import { createContext, useContext } from 'react';

/**
 * Where command bar slots under this tree go: the bar, inline (a modal
 * covers the bar), or nowhere (a hidden surface that stays mounted).
 */
export type CommandBarSlotScopeMode = 'bar' | 'inline' | 'off';

const CommandBarSlotScopeContext = createContext<CommandBarSlotScopeMode>('bar');

export const CommandBarSlotScope = CommandBarSlotScopeContext.Provider;

export function useCommandBarSlotScope(): CommandBarSlotScopeMode {
  return useContext(CommandBarSlotScopeContext);
}
