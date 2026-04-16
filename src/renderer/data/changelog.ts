import type { ChangelogEntry } from '../../shared/changelog';

export const CHANGELOG_ENTRIES = JSON.parse(__LINGUA_CHANGELOG_JSON__) as ChangelogEntry[];
