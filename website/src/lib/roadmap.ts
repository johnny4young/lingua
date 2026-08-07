/**
 * Read the public roadmap. Unlike changelog.json and its siblings, this file
 * is NOT produced by `npm run sync:content` — it is curated by hand in
 * src/data/roadmap.json (see scripts/sync-from-main.mjs, which says so) and
 * must be updated whenever a capability moves from partial to delivered.
 * Committed, deterministic, zero network at build time.
 */

import data from '../data/roadmap.json';

export type RoadmapStatus = 'Planned' | 'Partial' | 'Done' | 'Other';

export interface RoadmapItem {
  title: string;
  scope: string;
  status: string;
  theme: string;
}

export interface ThemedGroup {
  theme: string;
  items: RoadmapItem[];
}

export interface RoadmapData {
  generatedAt: string;
  totals: { planned: number; inProgress: number };
  planned: ThemedGroup[];
  inProgress: ThemedGroup[];
}

const ROADMAP = data as RoadmapData;

export async function loadRoadmap(): Promise<RoadmapData> {
  return ROADMAP;
}
