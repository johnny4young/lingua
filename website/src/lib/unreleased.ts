/**
 * Commits since the latest stable tag — pulled from the lingua repo's git
 * history at sync time and committed as JSON. Surfaces user-visible work
 * (feat/fix/perf) that hasn't been released yet, so the marketing
 * /changelog page can prove momentum even between version bumps.
 */

import data from '../data/unreleased.json';

export interface UnreleasedCommit {
  hash: string;
  date: string;
  type: string;
  typeLabel: string;
  scope: string | null;
  message: string;
  breaking: boolean;
}

export interface UnreleasedData {
  generatedAt: string;
  baseRef: string | null;
  commitCount: number;
  totalSinceBase: number;
  commits: UnreleasedCommit[];
}

const UNRELEASED = data as UnreleasedData;

export async function loadUnreleased(): Promise<UnreleasedData> {
  return UNRELEASED;
}
