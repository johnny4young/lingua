import { readdirSync } from 'node:fs';
import path, { matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.mts';

const root = path.resolve(__dirname, '../..');

function testFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return testFiles(relative);
    return /\.test\.tsx?$/u.test(entry.name) ? [relative] : [];
  });
}

function belongsTo(
  file: string,
  project: { test?: { include?: string[]; exclude?: string[] } }
): boolean {
  const patterns = project.test;
  return (
    (patterns?.include ?? []).some(glob => matchesGlob(file, glob)) &&
    !(patterns?.exclude ?? []).some(glob => matchesGlob(file, glob))
  );
}

function isInlineProject(value: unknown): value is {
  test?: {
    name?: string;
    environment?: string;
    setupFiles?: string[];
    include?: string[];
    exclude?: string[];
    isolate?: boolean;
  };
} {
  return typeof value === 'object' && value !== null && 'test' in value;
}

describe('Vitest environment boundaries', () => {
  it('assigns every root test exactly once while excluding the independent website', () => {
    const projects = (config.test?.projects ?? []).filter(isInlineProject);
    expect(projects).toHaveLength(2);
    for (const file of testFiles('tests')) {
      const matches = projects.filter(project => belongsTo(file, project));
      expect(matches, `${file} must run in exactly one root project`).toHaveLength(
        file.startsWith('tests/website/') ? 0 : 1
      );
    }
  });

  it('keeps Node-only tests off renderer setup and DOM suites isolated', () => {
    const projects = (config.test?.projects ?? []).filter(isInlineProject);
    const node = projects.find(project => project.test?.name === 'node-operations');
    const dom = projects.find(project => project.test?.name === 'renderer-and-runtime');
    expect(node?.test).toMatchObject({ environment: 'node', setupFiles: [] });
    expect(dom?.test).toMatchObject({ environment: 'jsdom', setupFiles: ['./tests/setup.ts'] });
    expect(config.test?.isolate).not.toBe(false);
    expect(node?.test?.isolate).not.toBe(false);
    expect(dom?.test?.isolate).not.toBe(false);
    expect(belongsTo('tests/docs/ciWorkflow.test.ts', node!)).toBe(true);
    expect(belongsTo('tests/shared/autoRunGating.test.ts', node!)).toBe(true);
    expect(belongsTo('tests/components/QrCodePanel.test.tsx', dom!)).toBe(true);
  });
});
