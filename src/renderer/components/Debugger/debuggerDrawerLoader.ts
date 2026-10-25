import type { ComponentType } from 'react';
import type { DebuggerDrawerProps } from './DebuggerDrawer';

interface DebuggerDrawerModule {
  DebuggerDrawer: ComponentType<DebuggerDrawerProps>;
}

let drawerPromise: Promise<DebuggerDrawerModule> | null = null;

/** One debugger panel implementation per document; a failed fetch stays cached until reload. */
export function loadDebuggerDrawer(): Promise<DebuggerDrawerModule> {
  drawerPromise ??= import('./DebuggerDrawer');
  return drawerPromise;
}
