import type { CollectionEntry } from 'astro:content';
import type { Locale } from '~/lib/i18n';

export const CLI_GROUPS = ['start', 'guides', 'automation', 'reference'] as const;
export type CliGroup = (typeof CLI_GROUPS)[number];

export interface CliSearchItem {
  href: string;
  title: string;
  description: string;
  group: CliGroup;
  searchText: string;
}

export function cliSlugFor(id: string): string {
  return id.replace(/^(en|es)\//, '');
}

export function cliHref(locale: Locale, slug: string): string {
  const localizedPrefix = locale === 'es' ? '/es' : '';
  return slug === 'getting-started' ? `${localizedPrefix}/cli` : `${localizedPrefix}/cli/${slug}`;
}

export function sortCliDocs(entries: ReadonlyArray<CollectionEntry<'cli'>>) {
  return [...entries].sort((a, b) => a.data.order - b.data.order);
}

export function buildCliSearchItems(
  entries: ReadonlyArray<CollectionEntry<'cli'>>,
  locale: Locale,
  referenceTerms: string
): CliSearchItem[] {
  return sortCliDocs(entries).map(entry => {
    const slug = cliSlugFor(entry.id);
    const extra = slug === 'reference' ? referenceTerms : '';
    return {
      href: cliHref(locale, slug),
      title: entry.data.title,
      description: entry.data.description,
      group: entry.data.group,
      searchText: [entry.data.title, entry.data.description, ...entry.data.keywords, entry.body, extra]
        .join(' ')
        .replace(/[`*_#[\](){}<>]/g, ' '),
    };
  });
}
