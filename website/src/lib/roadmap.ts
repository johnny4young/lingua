/**
 * Read roadmap data from the preprocessed file produced by
 * `npm run sync:content`. Same contract as lib/changelog.ts — committed,
 * deterministic, zero network at build time.
 */

import data from '../data/roadmap.json';

export type RoadmapStatus = 'Planned' | 'Partial' | 'Done' | 'Other';

export interface RoadmapTicket {
  id: string;
  title: string;
  scope: string;
  status: string;
  theme: string;
}

export interface ThemedGroup {
  theme: string;
  items: RoadmapTicket[];
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
