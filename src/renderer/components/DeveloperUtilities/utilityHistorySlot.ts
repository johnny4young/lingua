import { createContext } from 'react';

/**
 * Where the open tool's Recent runs render: under its Send output cards. `null` while the workspace's slot
 * mounts; with no workspace (`undefined`) they stay in the toolbar.
 */
export const UtilityHistorySlotContext = createContext<HTMLElement | null | undefined>(undefined);
