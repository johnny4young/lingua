import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/publish-cli.yml');

describe('CLI npm publication workflow', () => {
  const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';
  const parsed = load(workflow) as {
    jobs: Record<
      string,
      {
        needs?: string;
        environment?: { name?: string };
        permissions?: Record<string, string>;
      }
    >;
  };

  it('is manual, serialized, and gates promotion behind npm-production', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*(?:push|pull_request|release):/mu);
    expect(workflow).toContain('group: npm-cli-publication');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(Object.keys(parsed.jobs)).toEqual(['verify-cli', 'publish-cli']);
    expect(parsed.jobs['verify-cli']?.environment).toBeUndefined();
    expect(parsed.jobs['publish-cli']).toMatchObject({
      needs: 'verify-cli',
      environment: { name: 'npm-production' },
      permissions: { contents: 'read', 'id-token': 'write' },
    });
    expect(workflow).toContain('Type @linguacode/cli@X.Y.Z exactly');
    expect(workflow).toContain('Confirmation mismatch');
  });

  it('builds approval evidence from an already-public immutable release', () => {
    expect(workflow).toContain('Validate stable release input');
    expect(workflow).toContain('ref: refs/tags/${{ inputs.release_tag }}');
    expect(workflow.match(/Require exact release tag checkout/gu)).toHaveLength(2);
    expect(workflow).toContain('refs/tags/$RELEASE_TAG^{commit}');
    expect(workflow).toContain('Require a published immutable stable GitHub Release');
    expect(workflow).toContain('isDraft');
    expect(workflow).toContain('isPrerelease');
    expect(workflow).toContain('gh release verify "$RELEASE_TAG"');
    expect(workflow).toContain('gh release download');
    expect(workflow).toContain('gh release verify-asset');
    expect(workflow).toContain('--pattern SHA256SUMS.txt');
    expect(workflow).toContain('scripts/verify-cli-publication.mjs');
    expect(workflow).toContain('--github-output "$GITHUB_OUTPUT"');
    expect(workflow).toContain('Write protected-promotion preflight');
    expect(workflow).toContain('cli-npm-preflight-${{ steps.artifact.outputs.version }}');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow.match(/retention-days: 30/gu)).toHaveLength(2);
  });

  it('reverifies the candidate after the protected artifact handoff', () => {
    expect(workflow).toContain('Download verified promotion candidate');
    expect(workflow).toContain('Reverify candidate after protected handoff');
    expect(workflow).toContain('promotion-verification.json');
    expect(workflow).toContain('Protected handoff drift at ${field}');
    expect(workflow).toContain('EXPECTED_SHA256: ${{ needs.verify-cli.outputs.sha256 }}');
  });

  it('limits the bootstrap token to the first publish and stages later versions through OIDC', () => {
    expect(workflow).toContain("steps.registry.outputs.state == 'bootstrap'");
    expect(workflow).toContain('secrets.NPM_PUBLISH_TOKEN');
    expect(workflow).toContain('read/write access to the @linguacode scope');
    expect(workflow).toContain('Bypass 2FA enabled for this bootstrap only');
    expect(workflow).toContain(
      'npm publish "$PUBLICATION_DIR/${{ needs.verify-cli.outputs.artifact }}" --access public --provenance'
    );
    expect(workflow).toContain("steps.registry.outputs.state == 'stage'");
    expect(workflow).toContain('npm stage publish');
    expect(workflow).toContain('trusted publishing');
    expect(workflow).toContain('disallow package tokens');
    expect(workflow).toContain('npm@11.16.0');
  });

  it('smokes public reruns and fails closed around an unapproved staged version', () => {
    expect(workflow).toContain("steps.registry.outputs.state == 'published'");
    expect(workflow).toContain('skipping mutation');
    expect(workflow).toContain('npm install --global --prefix');
    expect(workflow).toContain('utility base64-encode');
    expect(workflow).toContain('A rerun before approval safely fails');
    expect(workflow).toContain('cli-npm-publication-${{ needs.verify-cli.outputs.version }}');
  });

  it('gives the public smoke a budget that outlasts packument replication', () => {
    // npm serves the version document before the packument `npm install`
    // resolves against. For the 1.0.1 bootstrap the packument was still 404
    // more than two minutes after npm reported success, so a short retry loop
    // failed a publish that was fine — and skipped the operator handoff with
    // it. A first publish creates the packument and needs the longer budget.
    expect(workflow).toMatch(/budget_seconds=600/u);
    expect(workflow).toMatch(/budget_seconds=180/u);
    // npm caches negative lookups, so retries must force revalidation or they
    // replay the same cached 404 and the budget buys nothing.
    expect(workflow).toContain('--prefer-online');
    // Spending the budget must fail closed, not fall through as success.
    expect(workflow).toContain('did not become installable within');
  });

  it('asserts the smoked version explicitly instead of relying on errexit', () => {
    // Whether `set -e` aborts on a bare failing `[[ ]]` depends on the bash
    // build; a version assertion that silently never fires is worse than none.
    expect(workflow).toContain('Public install reports $installed_version');
    expect(workflow).not.toMatch(
      /^\s*\[\[ "\$\("\$prefix\/bin\/lingua" --version\)" == /mu
    );
  });
});
