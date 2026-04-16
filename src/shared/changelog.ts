export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
  unreleased: boolean;
}

const ENTRY_HEADER_RE = /^##\s+\[(.+?)\](?:\s+[—-]\s+(.+))?\s*$/;
const SECTION_HEADER_RE = /^###\s+(.+?)\s*$/;
const BULLET_RE = /^-\s+(.*)$/;

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = markdown.split(/\r?\n/);

  let currentEntry: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const line of lines) {
    const entryMatch = line.match(ENTRY_HEADER_RE);
    if (entryMatch) {
      const [, rawVersion = '', rawDate] = entryMatch;
      const version = rawVersion.trim();
      if (!version) {
        continue;
      }

      currentEntry = {
        version,
        date: normalizeDate(rawDate),
        sections: [],
        unreleased: version.toLowerCase() === 'unreleased',
      };
      entries.push(currentEntry);
      currentSection = null;
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    const sectionMatch = line.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      const [, rawTitle = ''] = sectionMatch;
      const title = rawTitle.trim();
      if (!title) {
        continue;
      }

      currentSection = {
        title,
        items: [],
      };
      currentEntry.sections.push(currentSection);
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      const [, rawItem = ''] = bulletMatch;
      const item = rawItem.trim();
      if (!item) {
        continue;
      }

      const targetSection =
        currentSection ??
        (() => {
          if (!currentEntry) {
            throw new Error('Expected changelog entry before bullet item.');
          }

          const fallback = { title: 'Notes', items: [] as string[] };
          currentEntry.sections.push(fallback);
          currentSection = fallback;
          return fallback;
        })();

      targetSection.items.push(item);
    }
  }

  return entries.filter((entry) => entry.sections.some((section) => section.items.length > 0));
}

export function getFeaturedChangelogEntry(
  entries: ChangelogEntry[],
  currentVersion: string | null
): ChangelogEntry | null {
  if (!entries.length) {
    return null;
  }

  if (currentVersion) {
    const exactMatch = entries.find((entry) => entry.version === currentVersion);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const firstReleased = entries.find((entry) => !entry.unreleased);
  return firstReleased ?? entries.at(0) ?? null;
}
