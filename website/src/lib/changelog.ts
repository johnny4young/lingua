/**
 * Read CHANGELOG entries from the preprocessed data file produced by
 * `npm run sync:content`. The file is committed to the repo, so the build
 * has zero network dependency and works identically on local + CF Pages.
 *
 * To refresh: run `npm run sync:content` (reads from ../lingua sibling).
 */

import data from '../data/changelog.json';

export type ChangelogSection = {
  heading: string;
  items: string[];
};

export type ChangelogEntry = {
  version: string;
  date: string;
  sections: ChangelogSection[];
  raw: string;
};

const ENTRIES: ChangelogEntry[] = (data as { entries: ChangelogEntry[] }).entries;

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  return ENTRIES;
}

export async function findEntryForVersion(version: string): Promise<ChangelogEntry | null> {
  const stripped = version.replace(/^v/, '');
  return ENTRIES.find((e) => e.version === stripped) ?? null;
}

export function excerpt(entry: ChangelogEntry, maxItems = 4): string[] {
  const out: string[] = [];
  for (const section of entry.sections) {
    for (const item of section.items) {
      out.push(item);
      if (out.length >= maxItems) return out;
    }
  }
  return out;
}
