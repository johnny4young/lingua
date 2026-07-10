import { createContext, useContext } from 'react';

/**
 * Developer Utilities can keep previously visited panels mounted so their
 * in-progress user input survives navigation while the Utilities tab remains
 * open. Hidden panels must not keep owning global shortcuts such as Copy output
 * or Apply, so registration hooks read this context before publishing their
 * imperative handlers.
 */
export const UtilityPanelActiveContext = createContext(true);

export function useUtilityPanelActive(): boolean {
  return useContext(UtilityPanelActiveContext);
}
