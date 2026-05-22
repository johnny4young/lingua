/**
 * RL-025 Slice A - dependency adapter registry. Pure dispatcher so
 * the renderer's `useDependencyDetection` hook never reaches into a
 * language-specific module.
 *
 * Slice B / C will extend the registered set with desktop-only JS/TS
 * + Python adapters that own the install path; Slice A only ships
 * the detection halves.
 */

import {
  javascriptDependencyAdapter,
  typescriptDependencyAdapter,
} from './javascriptDetector';
import { pythonDependencyAdapter } from './pythonDetector';
import type {
  DependencyAdapter,
  DependencyAdapterLanguage,
} from './types';

const ADAPTERS: Record<DependencyAdapterLanguage, DependencyAdapter> = {
  javascript: javascriptDependencyAdapter,
  typescript: typescriptDependencyAdapter,
  python: pythonDependencyAdapter,
};

export const DEPENDENCY_ADAPTER_LANGUAGES: readonly DependencyAdapterLanguage[] =
  Object.keys(ADAPTERS) as DependencyAdapterLanguage[];

export function isDependencyAdapterLanguage(
  language: string
): language is DependencyAdapterLanguage {
  return language in ADAPTERS;
}

export function getDependencyAdapter(
  language: DependencyAdapterLanguage
): DependencyAdapter {
  return ADAPTERS[language];
}

export function maybeGetDependencyAdapter(
  language: string | null | undefined
): DependencyAdapter | null {
  if (!language) return null;
  if (!isDependencyAdapterLanguage(language)) return null;
  return ADAPTERS[language];
}

export type { DependencyAdapter, DependencyAdapterLanguage };
