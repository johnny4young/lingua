/**
 * Read CHANGELOG entries from the preprocessed data file produced by
 * `npm run sync:content`. The file is committed to the repo, so the build
 * has zero network dependency and works identically on local + CF Pages.
 *
 * To refresh: run `npm run sync:content` (reads from ../lingua sibling).
 */

import data from '../data/changelog.json' with { type: 'json' };
import packageJson from '../../../package.json' with { type: 'json' };
import releaseSnapshot from '../data/latest-release.json' with { type: 'json' };
import { compareStableVersions, parseReleaseSnapshot } from './releaseSnapshot.ts';

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

/** Repository candidate history, including a version prepared but not published yet. */
export async function loadCandidateChangelog(): Promise<ChangelogEntry[]> {
  return ENTRIES;
}

export function filterChangelogThroughVersion(
  entries: readonly ChangelogEntry[],
  publishedVersion: string
): ChangelogEntry[] {
  return entries.filter(entry => compareStableVersions(entry.version, publishedVersion) <= 0);
}

export async function loadPublishedChangelog(): Promise<ChangelogEntry[]> {
  const publishedVersion = parseReleaseSnapshot(releaseSnapshot, packageJson.version).version;
  return filterChangelogThroughVersion(ENTRIES, publishedVersion);
}

export async function findEntryForVersion(version: string): Promise<ChangelogEntry | null> {
  const stripped = version.replace(/^v/, '');
  const publishedEntries = await loadPublishedChangelog();
  return publishedEntries.find(entry => entry.version === stripped) ?? null;
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
