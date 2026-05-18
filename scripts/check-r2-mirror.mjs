#!/usr/bin/env node
/**
 * R2 release-mirror parity check.
 *
 * Compares the assets attached to a GitHub Release (private repo,
 * authenticated metadata) against the assets mirrored to the public
 * Cloudflare R2 bucket. Used both:
 *
 *   - In CI as the post-`mirror-r2` validation step.
 *   - On the operator's machine before promoting a draft release
 *     (`npm run check:r2-mirror -- --release-tag v0.4.0`).
 *
 * Exit codes:
 *
 *   0 — every GH Release asset is mirrored to R2 with matching SHA-256,
 *       and the `latest/` rewrite points at the same tag.
 *   1 — at least one asset is missing, mismatched, or stale.
 *   2 — input error (missing flag, missing env var, GH API failure).
 *
 * Required env (or .env locally):
 *
 *   - `GITHUB_TOKEN` — fine-grained PAT with `Contents: read` on the
 *     source repo, or a classic PAT with `repo:read`. The CI workflow
 *     passes `secrets.GITHUB_TOKEN` automatically.
 *   - `R2_PUBLIC_BASE` — public URL prefix (e.g.
 *     `https://downloads.linguacode.dev`). The CI workflow stamps this
 *     into the job env from the `R2_PUBLIC_BASE` secret.
 *
 * Optional env:
 *
 *   - `GITHUB_REPOSITORY` — `owner/repo` slug. Defaults to the
 *     `package.json` `repository.url` parse, falls back to
 *     `johnny4young/lingua`.
 *
 * Output artifact:
 *
 *   `output/r2-mirror-validation/<tag>.json` — full diff machine-
 *   readable record, attached to the release evidence.
 *
 * RL-061 sibling — same evidence-artifact pattern as
 * `update-feed-validation.json`.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'output', 'r2-mirror-validation');

const DEFAULT_REPO = 'johnny4young/lingua';

function parseArgs(argv) {
  const args = { releaseTag: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--release-tag' && next) {
      args.releaseTag = next;
      i += 1;
    } else if (flag === '--repo' && next) {
      args.repo = next;
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printUsageAndExit(code = 0) {
  console.log(`Usage: node scripts/check-r2-mirror.mjs --release-tag vX.Y.Z [--repo owner/name]

Required env:
  GITHUB_TOKEN      Fine-grained PAT with Contents: read on the repo
  R2_PUBLIC_BASE    Public URL prefix (https://downloads.linguacode.dev)

Optional env:
  GITHUB_REPOSITORY owner/name (overrides --repo and the package.json default)`);
  process.exit(code);
}

function bail(code, message) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function resolveRepo(cli) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (cli.repo) return cli.repo;
  try {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));
    const url = pkg?.repository?.url ?? pkg?.repository;
    if (typeof url === 'string') {
      const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (match) return `${match[1]}/${match[2]}`;
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_REPO;
}

async function listGitHubReleaseAssets(repo, releaseTag, token) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${releaseTag}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lingua-release-mirror-check',
    },
  });
  if (response.status === 404) {
    bail(2, `GitHub Release ${releaseTag} not found on ${repo} (404). Was the publish job successful?`);
  }
  if (!response.ok) {
    bail(2, `GitHub API ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.assets)) {
    bail(2, `Release ${releaseTag} response missing assets array`);
  }
  return body.assets.map((asset) => ({
    name: asset.name,
    size: asset.size,
    downloadUrl: asset.url, // API URL — authenticated download endpoint
  }));
}

async function fetchSha256Manifest(publicBase, releaseTag) {
  const url = `${publicBase.replace(/\/$/, '')}/${releaseTag}/SHA256SUMS.txt`;
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    bail(1, `R2 SHA256SUMS.txt fetch failed: ${response.status} ${url}`);
  }
  const text = await response.text();
  const map = new Map();
  for (const line of text.split('\n')) {
    // Format: `<sha>  ./<filename>` or `<sha>  <filename>`
    const match = line.match(/^([a-fA-F0-9]{64})\s+(?:\.\/)?(.+?)\s*$/);
    if (match) {
      map.set(match[2], match[1].toLowerCase());
    }
  }
  return map;
}

async function headR2Asset(publicBase, releaseTag, assetName) {
  const url = `${publicBase.replace(/\/$/, '')}/${releaseTag}/${assetName}`;
  const response = await fetch(url, { method: 'HEAD' });
  return {
    ok: response.ok,
    status: response.status,
    contentLength: response.headers.get('content-length'),
    etag: response.headers.get('etag'),
    url,
  };
}

async function headR2LatestAsset(publicBase, assetName) {
  const url = `${publicBase.replace(/\/$/, '')}/latest/${assetName}`;
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  return {
    ok: response.ok || (response.status >= 300 && response.status < 400),
    status: response.status,
    location: response.headers.get('location'),
    url,
  };
}

async function fetchAndHashR2Asset(publicBase, releaseTag, assetName) {
  const url = `${publicBase.replace(/\/$/, '')}/${releaseTag}/${assetName}`;
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false, status: response.status, url };
  }
  const buf = Buffer.from(await response.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  return { ok: true, status: response.status, sha, size: buf.byteLength, url };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) printUsageAndExit(0);
  if (!cli.releaseTag) {
    console.error('error: --release-tag vX.Y.Z is required\n');
    printUsageAndExit(2);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) bail(2, 'GITHUB_TOKEN env var is required');

  const publicBase = process.env.R2_PUBLIC_BASE;
  if (!publicBase) bail(2, 'R2_PUBLIC_BASE env var is required (e.g. https://downloads.linguacode.dev)');

  const repo = resolveRepo(cli);

  console.log(`Comparing GitHub Release vs R2 mirror`);
  console.log(`  Repo:       ${repo}`);
  console.log(`  Tag:        ${cli.releaseTag}`);
  console.log(`  R2 prefix:  ${publicBase}/${cli.releaseTag}/`);
  console.log('');

  const ghAssets = await listGitHubReleaseAssets(repo, cli.releaseTag, token);
  if (ghAssets.length === 0) {
    bail(1, `GitHub Release ${cli.releaseTag} has no assets attached`);
  }
  console.log(`GitHub Release assets: ${ghAssets.length}`);

  const sha256Manifest = await fetchSha256Manifest(publicBase, cli.releaseTag);
  if (!sha256Manifest) {
    bail(
      1,
      `R2 mirror missing SHA256SUMS.txt for ${cli.releaseTag} — did the mirror-r2 job run?`
    );
  }
  console.log(`R2 SHA256SUMS.txt entries: ${sha256Manifest.size}`);
  console.log('');

  const findings = [];
  for (const asset of ghAssets) {
    const head = await headR2Asset(publicBase, cli.releaseTag, asset.name);
    if (!head.ok) {
      findings.push({
        kind: 'missing-from-r2',
        asset: asset.name,
        ghSize: asset.size,
        r2Status: head.status,
        r2Url: head.url,
      });
      console.log(`  ✗ ${asset.name} — missing on R2 (HTTP ${head.status})`);
      continue;
    }
    const r2Size = head.contentLength ? parseInt(head.contentLength, 10) : null;
    if (r2Size !== null && r2Size !== asset.size) {
      findings.push({
        kind: 'size-mismatch',
        asset: asset.name,
        ghSize: asset.size,
        r2Size,
      });
      console.log(`  ✗ ${asset.name} — size mismatch (gh=${asset.size}, r2=${r2Size})`);
      continue;
    }

    // SHA check against the R2 manifest (cheap — manifest already fetched).
    if (asset.name !== 'SHA256SUMS.txt') {
      const expectedSha = sha256Manifest.get(asset.name);
      if (!expectedSha) {
        findings.push({
          kind: 'sha-not-in-manifest',
          asset: asset.name,
        });
        console.log(`  ✗ ${asset.name} — not listed in R2 SHA256SUMS.txt`);
        continue;
      }
      // For small artifacts (<25 MB) we re-hash; large artifacts trust the
      // manifest. The publish job already shasum -c verified it server-
      // side, so this is belt-and-suspenders.
      if (asset.size < 25 * 1024 * 1024) {
        const downloaded = await fetchAndHashR2Asset(publicBase, cli.releaseTag, asset.name);
        if (!downloaded.ok) {
          findings.push({ kind: 'r2-download-failed', asset: asset.name, status: downloaded.status });
          console.log(`  ✗ ${asset.name} — R2 download failed (HTTP ${downloaded.status})`);
          continue;
        }
        if (downloaded.sha !== expectedSha) {
          findings.push({
            kind: 'sha-mismatch',
            asset: asset.name,
            expected: expectedSha,
            actual: downloaded.sha,
          });
          console.log(`  ✗ ${asset.name} — SHA mismatch (manifest=${expectedSha.slice(0, 12)}…, actual=${downloaded.sha.slice(0, 12)}…)`);
          continue;
        }
      }
    }
    console.log(`  ✓ ${asset.name}`);
  }

  // Validate `latest/` rewrite points at the same tag (manifest.json check).
  const manifestProbe = await fetch(`${publicBase.replace(/\/$/, '')}/manifest.json`);
  let manifest = null;
  if (manifestProbe.ok) {
    try {
      manifest = await manifestProbe.json();
    } catch {
      // Non-JSON — flag below.
    }
  }
  if (!manifest || typeof manifest.latest !== 'string') {
    findings.push({
      kind: 'manifest-missing',
      url: `${publicBase}/manifest.json`,
      status: manifestProbe.status,
    });
    console.log(`  ✗ manifest.json — missing or malformed at root`);
  } else if (manifest.latest !== cli.releaseTag) {
    findings.push({
      kind: 'latest-pointer-stale',
      expected: cli.releaseTag,
      actual: manifest.latest,
    });
    console.log(`  ✗ manifest.json — latest is ${manifest.latest}, expected ${cli.releaseTag}`);
  } else {
    console.log(`  ✓ manifest.json — latest=${manifest.latest}`);
  }

  // Sanity-check ONE asset through the `latest/` prefix.
  const probeAsset = ghAssets.find((a) => a.name === 'SHA256SUMS.txt') ?? ghAssets[0];
  if (probeAsset) {
    const latestHead = await headR2LatestAsset(publicBase, probeAsset.name);
    if (!latestHead.ok) {
      findings.push({
        kind: 'latest-asset-missing',
        asset: probeAsset.name,
        status: latestHead.status,
      });
      console.log(`  ✗ latest/${probeAsset.name} — HTTP ${latestHead.status}`);
    } else {
      console.log(`  ✓ latest/${probeAsset.name}`);
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const evidencePath = resolve(OUTPUT_DIR, `${cli.releaseTag}.json`);
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        repo,
        releaseTag: cli.releaseTag,
        publicBase,
        checkedAt: new Date().toISOString(),
        ghAssetCount: ghAssets.length,
        r2ManifestEntries: sha256Manifest.size,
        manifestLatest: manifest?.latest ?? null,
        findings,
      },
      null,
      2
    ) + '\n'
  );

  console.log('');
  console.log(`Evidence: ${evidencePath}`);

  if (findings.length > 0) {
    console.error(`\n✗ R2 mirror is NOT in sync — ${findings.length} finding(s). Re-run the mirror-r2 job.`);
    process.exit(1);
  }
  console.log('\n✓ R2 mirror is in sync with the GitHub Release.');
  process.exit(0);
}

main().catch((err) => {
  bail(2, err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
});

// Existence check is also re-used by the dirty-check guard.
export { OUTPUT_DIR };
if (!existsSync) {
  // Defensive: ensure the import binding is consumed by the bundler.
  void existsSync;
}
