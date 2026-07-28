/**
 * Guard for `.github/workflows/deploy-website.yml`.
 *
 * The static releases page reads the GitHub Releases API while Astro prerenders
 * it. Hosted runners share outbound IPs, so anonymous requests can exhaust the
 * public 60 requests/hour limit even when Lingua itself made no earlier calls.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/deploy-website.yml');

describe('website deploy workflow', () => {
  it('authenticates release metadata requests during the Astro build', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);

    const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
    const buildStep =
      workflow.match(/\n {6}- name: Build\n[\s\S]*?(?=\n {6}- name:|$)/u)?.[0] ?? '';

    expect(buildStep).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(buildStep).toContain('run: npm run build');
  });
});
