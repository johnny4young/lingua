#!/usr/bin/env node

/**
 * Produce a read-only, evidence-backed distribution status report.
 *
 * The probe intentionally uses only public endpoints. It never reads npm or
 * GitHub credentials, publishes packages, updates the tap, or submits winget
 * manifests. Promotion remains a separate explicitly authorized operation.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseChecksums, releaseAssetNames } from './generate-distribution-manifests.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DISTRIBUTION_PACKAGE = '@linguacode/cli';
export const TAP_REPOSITORY = 'johnny4young/homebrew-tap';
export const APP_REPOSITORY = 'johnny4young/lingua';

const REQUIRED_DESKTOP_ASSETS = [
  version => `Lingua-${version}-mac-arm64.dmg`,
  version => `Lingua-${version}-mac-x64.dmg`,
  version => `Lingua-${version}-win-x64.exe`,
  version => `Lingua-${version}-linux-x86_64.AppImage`,
];

const REQUIRED_CLI_ASSETS = [
  version => `linguacode-cli-${version}.tgz`,
  version => `lingua-cli-v${version}-linux-x64.tar.gz`,
  version => `lingua-cli-v${version}-windows-x64.tar.gz`,
];

function stripVersionTag(tag) {
  return typeof tag === 'string' && /^v\d+\.\d+\.\d+$/u.test(tag) ? tag.slice(1) : null;
}

function parseQuotedVersion(source, pattern) {
  return source.match(pattern)?.[1] ?? null;
}

function parseCaskDigests(cask) {
  const match = cask.match(
    /^\s*sha256\s+arm:\s+"([0-9a-f]{64})",\s*\n\s*intel:\s+"([0-9a-f]{64})"/imu
  );
  return {
    arm: match?.[1]?.toLowerCase() ?? null,
    intel: match?.[2]?.toLowerCase() ?? null,
  };
}

export function readLocalDistributionState({ cask, wingetVersion, wingetInstaller }) {
  const caskDigests = parseCaskDigests(cask);
  return {
    homebrew: parseQuotedVersion(cask, /^\s*version\s+"([^"]+)"/mu),
    homebrewArmSha256: caskDigests.arm,
    homebrewIntelSha256: caskDigests.intel,
    winget: parseQuotedVersion(wingetVersion, /^PackageVersion:\s*([^\s]+)\s*$/mu),
    wingetInstaller: parseQuotedVersion(wingetInstaller, /^PackageVersion:\s*([^\s]+)\s*$/mu),
    wingetSha256:
      wingetInstaller.match(/^\s*InstallerSha256:\s*([0-9a-f]{64})\s*$/imu)?.[1]?.toLowerCase() ??
      null,
  };
}

function missingAssets(assetNames, factories, version) {
  const names = new Set(assetNames);
  return factories.map(factory => factory(version)).filter(name => !names.has(name));
}

function missingChecksums(releaseChecksums, factories, version) {
  return factories.map(factory => factory(version)).filter(name => !releaseChecksums.has(name));
}

export function assessDistributionReadiness({
  latestRelease,
  npmPackage,
  tapRepository,
  remoteCask,
  releaseChecksums,
  localVersions,
  generatedAt = new Date().toISOString(),
}) {
  const releaseVersion = stripVersionTag(latestRelease?.tag_name);
  if (!releaseVersion || latestRelease?.draft || latestRelease?.prerelease) {
    throw new Error('The public latest release is missing or is not a stable vX.Y.Z release.');
  }

  const assetNames = (latestRelease.assets ?? []).map(asset => asset.name);
  const missingDesktopAssets = missingAssets(assetNames, REQUIRED_DESKTOP_ASSETS, releaseVersion);
  const missingCliAssets = missingAssets(assetNames, REQUIRED_CLI_ASSETS, releaseVersion);
  const missingDesktopChecksums = missingChecksums(
    releaseChecksums,
    REQUIRED_DESKTOP_ASSETS,
    releaseVersion
  );
  const missingCliChecksums = missingChecksums(
    releaseChecksums,
    REQUIRED_CLI_ASSETS,
    releaseVersion
  );
  const expectedAssets = releaseAssetNames(releaseVersion);
  const expectedDigests = {
    macArm: releaseChecksums.get(expectedAssets.macArm) ?? null,
    macIntel: releaseChecksums.get(expectedAssets.macIntel) ?? null,
    windows: releaseChecksums.get(expectedAssets.windows) ?? null,
  };
  const remoteCaskVersion = remoteCask
    ? parseQuotedVersion(remoteCask, /^\s*version\s+"([^"]+)"/mu)
    : null;
  const remoteCaskDigests = remoteCask ? parseCaskDigests(remoteCask) : { arm: null, intel: null };
  const npmVersion = npmPackage?.version ?? npmPackage?.['dist-tags']?.latest ?? null;
  const packageExists = typeof npmPackage?.name === 'string';
  const cliReleaseReady = missingCliAssets.length === 0 && missingCliChecksums.length === 0;
  const localCaskCurrent =
    localVersions.homebrew === releaseVersion &&
    localVersions.homebrewArmSha256 === expectedDigests.macArm &&
    localVersions.homebrewIntelSha256 === expectedDigests.macIntel;
  const remoteCaskCurrent =
    remoteCaskVersion === releaseVersion &&
    remoteCaskDigests.arm === expectedDigests.macArm &&
    remoteCaskDigests.intel === expectedDigests.macIntel;
  const localWingetCurrent =
    localVersions.winget === releaseVersion &&
    localVersions.wingetInstaller === releaseVersion &&
    localVersions.wingetSha256 === expectedDigests.windows;

  const actions = [];
  if (!packageExists) {
    actions.push(
      cliReleaseReady
        ? `Create or confirm the @linguacode npm organization, enable GitHub release immutability, and protect the npm-production environment. Add one short-lived granular NPM_PUBLISH_TOKEN with read/write access to the @linguacode scope and Bypass 2FA enabled for this bootstrap only, then dispatch publish-cli.yml for ${DISTRIBUTION_PACKAGE}@${releaseVersion}. After bootstrap, configure stage-only trusted publishing and revoke the token.`
        : `Create or confirm the @linguacode npm organization, enable GitHub release immutability, and protect the npm-production environment. The next release must attach CLI artifacts before publish-cli.yml can bootstrap the package. That one run needs a short-lived granular token with read/write access to the @linguacode scope and Bypass 2FA enabled.`
    );
  } else if (npmVersion !== releaseVersion) {
    actions.push(
      `Dispatch publish-cli.yml for ${DISTRIBUTION_PACKAGE}@${releaseVersion}; npm currently serves ${npmVersion}, so the workflow will stage the immutable artifact through OIDC for 2FA approval.`
    );
  }
  if (missingCliAssets.length > 0) {
    actions.push(
      `Cut the next release with release_cli enabled; ${latestRelease.tag_name} predates the CLI artifact pipeline.`
    );
  }
  if (tapRepository?.private !== false) {
    actions.push(`Create or make ${TAP_REPOSITORY} public before Homebrew promotion.`);
  } else if (!remoteCaskCurrent && localCaskCurrent) {
    actions.push(`Promote packaging/homebrew/Casks/lingua.rb to ${TAP_REPOSITORY} after review.`);
  } else if (!localCaskCurrent) {
    actions.push(`Regenerate the Homebrew cask from ${latestRelease.tag_name} checksums.`);
  }
  if (!localWingetCurrent) {
    actions.push(`Regenerate the winget manifests from ${latestRelease.tag_name} checksums.`);
  }
  actions.push('Configure public-trust Authenticode credentials before winget submission.');

  return {
    schemaVersion: 1,
    generatedAt,
    release: {
      tag: latestRelease.tag_name,
      version: releaseVersion,
      publishedAt: latestRelease.published_at ?? null,
      url: latestRelease.html_url ?? null,
      desktopAssets: {
        status:
          missingDesktopAssets.length === 0 && missingDesktopChecksums.length === 0
            ? 'ready'
            : 'blocked',
        missing: missingDesktopAssets,
        missingChecksums: missingDesktopChecksums,
      },
      cliAssets: {
        status: cliReleaseReady ? 'ready' : 'next-release',
        missing: missingCliAssets,
        missingChecksums: missingCliChecksums,
      },
    },
    npm: {
      package: DISTRIBUTION_PACKAGE,
      status: packageExists
        ? npmVersion === releaseVersion
          ? 'ready'
          : 'version-drift'
        : 'not-published',
      latestVersion: npmVersion,
      url: `https://www.npmjs.com/package/${DISTRIBUTION_PACKAGE}`,
      publication: {
        status: 'guarded',
        workflow: 'publish-cli.yml',
        mode: packageExists ? 'trusted-stage' : 'bootstrap-token',
      },
    },
    homebrew: {
      repository: TAP_REPOSITORY,
      repositoryPublic: tapRepository?.private === false,
      status:
        tapRepository?.private === false && remoteCaskCurrent
          ? 'ready'
          : tapRepository?.private === false && localCaskCurrent
            ? 'ready-to-promote'
            : 'blocked',
      localVersion: localVersions.homebrew,
      remoteVersion: remoteCaskVersion,
      localMatchesRelease: localCaskCurrent,
      remoteMatchesRelease: remoteCaskCurrent,
      url: `https://github.com/${TAP_REPOSITORY}`,
    },
    winget: {
      status: localWingetCurrent ? 'signing-required' : 'blocked',
      localVersion: localVersions.winget,
      installerVersion: localVersions.wingetInstaller,
      localMatchesRelease: localWingetCurrent,
      signing: 'not-configured',
    },
    actions,
  };
}

function cliGapCount(report) {
  return new Set([
    ...report.release.cliAssets.missing,
    ...report.release.cliAssets.missingChecksums,
  ]).size;
}

function statusLabel(status, locale) {
  const labels = {
    en: {
      ready: 'Ready',
      'ready-to-promote': 'Ready to promote',
      blocked: 'Blocked',
      'next-release': 'Next release',
      'not-published': 'Not published',
      'version-drift': 'Version drift',
      'signing-required': 'Signing required',
      guarded: 'Guarded',
    },
    es: {
      ready: 'Listo',
      'ready-to-promote': 'Listo para promover',
      blocked: 'Bloqueado',
      'next-release': 'Próxima versión',
      'not-published': 'No publicado',
      'version-drift': 'Versión desactualizada',
      'signing-required': 'Requiere firma',
      guarded: 'Protegido',
    },
  };
  return labels[locale]?.[status] ?? status;
}

function localizedAction(action, report, locale) {
  if (locale !== 'es') return action;
  if (action.startsWith('Create or confirm the @linguacode npm organization')) {
    return action.includes('Add one short-lived')
      ? `Crea o confirma la organización @linguacode en npm, activa releases inmutables en GitHub y protege el entorno npm-production. Agrega un NPM_PUBLISH_TOKEN granular y de corta duración, con lectura y escritura sobre el scope @linguacode y Bypass 2FA activado solo para este bootstrap. Luego ejecuta publish-cli.yml para ${DISTRIBUTION_PACKAGE}@${report.release.version}; al terminar, configura la publicación confiable solo para staging y revoca el token.`
      : 'Crea o confirma la organización @linguacode en npm, activa releases inmutables en GitHub y protege el entorno npm-production. La próxima versión debe adjuntar los artefactos del CLI antes del bootstrap. Esa única ejecución necesita un token granular y de corta duración, con lectura y escritura sobre el scope @linguacode y Bypass 2FA activado.';
  }
  if (action.startsWith('Dispatch publish-cli.yml for @linguacode/cli@')) {
    return `Ejecuta publish-cli.yml para ${DISTRIBUTION_PACKAGE}@${report.release.version}; npm todavía sirve ${report.npm.latestVersion}, así que el workflow preparará el artefacto inmutable mediante OIDC para aprobación con 2FA.`;
  }
  if (action.startsWith('Cut the next release')) {
    return `Publica la próxima versión con release_cli habilitado; ${report.release.tag} es anterior al pipeline de artefactos del CLI.`;
  }
  if (action.startsWith('Promote packaging/homebrew')) {
    return `Promueve packaging/homebrew/Casks/lingua.rb a ${TAP_REPOSITORY} después de revisarlo.`;
  }
  if (action.startsWith('Create or make johnny4young/homebrew-tap public')) {
    return `Crea el repositorio ${TAP_REPOSITORY} o configúralo como público antes de promover Homebrew.`;
  }
  if (action.startsWith('Regenerate the Homebrew cask')) {
    return `Regenera el cask de Homebrew desde los checksums de ${report.release.tag}.`;
  }
  if (action.startsWith('Regenerate the winget manifests')) {
    return `Regenera los manifests de winget desde los checksums de ${report.release.tag}.`;
  }
  if (action.startsWith('Configure public-trust Authenticode')) {
    return 'Configura credenciales Authenticode de confianza pública antes de enviar el paquete a winget.';
  }
  return action;
}

export function renderMarkdownReport(report, locale = 'en') {
  const es = locale === 'es';
  const title = es ? 'Estado de distribución de Lingua' : 'Lingua distribution readiness';
  const rows = [
    [
      es ? 'Release de escritorio' : 'Desktop release',
      statusLabel(report.release.desktopAssets.status, locale),
      report.release.tag,
    ],
    ['npm', statusLabel(report.npm.status, locale), report.npm.latestVersion ?? report.npm.package],
    [
      es ? 'Flujo npm' : 'npm workflow',
      statusLabel(report.npm.publication.status, locale),
      `${report.npm.publication.workflow} · ${report.npm.publication.mode}`,
    ],
    [
      'Homebrew',
      statusLabel(report.homebrew.status, locale),
      report.homebrew.remoteVersion ?? `${report.homebrew.localVersion} local`,
    ],
    ['winget', statusLabel(report.winget.status, locale), report.winget.localVersion ?? '—'],
    [
      es ? 'Artefactos CLI' : 'CLI artifacts',
      statusLabel(report.release.cliAssets.status, locale),
      cliGapCount(report) === 0
        ? report.release.version
        : `${cliGapCount(report)} ${es ? 'faltantes' : 'missing'}`,
    ],
  ];
  return [
    `# ${title}`,
    '',
    `${es ? 'Generado' : 'Generated'}: ${report.generatedAt}`,
    '',
    `| ${es ? 'Canal' : 'Channel'} | ${es ? 'Estado' : 'Status'} | ${es ? 'Evidencia' : 'Evidence'} |`,
    '| --- | --- | --- |',
    ...rows.map(row => `| ${row.join(' | ')} |`),
    '',
    `## ${es ? 'Próximas acciones' : 'Next actions'}`,
    '',
    ...report.actions.map(
      (action, index) => `${index + 1}. ${localizedAction(action, report, locale)}`
    ),
    '',
  ].join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderHtmlReport(report, locale = 'en') {
  const es = locale === 'es';
  const cards = [
    ['Desktop', report.release.desktopAssets.status, report.release.tag],
    ['npm', report.npm.status, report.npm.latestVersion ?? report.npm.package],
    [
      es ? 'Flujo npm' : 'npm workflow',
      report.npm.publication.status,
      `${report.npm.publication.workflow} · ${report.npm.publication.mode}`,
    ],
    [
      'Homebrew',
      report.homebrew.status,
      report.homebrew.remoteVersion ?? `${report.homebrew.localVersion} local`,
    ],
    ['winget', report.winget.status, report.winget.localVersion ?? '—'],
    [
      'CLI artifacts',
      report.release.cliAssets.status,
      `${cliGapCount(report)} ${es ? 'faltantes' : 'missing'}`,
    ],
  ];
  const cardHtml = cards
    .map(
      ([name, status, evidence]) => `<article class="card ${escapeHtml(status)}">
        <span class="eyebrow">${escapeHtml(name)}</span>
        <strong>${escapeHtml(statusLabel(status, locale))}</strong>
        <code>${escapeHtml(evidence)}</code>
      </article>`
    )
    .join('');
  const actions = report.actions
    .map(
      (action, index) =>
        `<li><span>${index + 1}</span>${escapeHtml(localizedAction(action, report, locale))}</li>`
    )
    .join('');
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lingua distribution</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#050908;color:#eef7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% 10%,#0b3b3e 0,transparent 34%),#050908;padding:64px}.shell{max-width:1180px;margin:auto;border:1px solid #27423f;border-radius:24px;background:#08100fdd;box-shadow:0 28px 100px #0008;overflow:hidden}.header{padding:36px 42px;border-bottom:1px solid #1b302e;display:flex;justify-content:space-between;gap:32px}.brand{font:700 12px ui-monospace;letter-spacing:.18em;color:#23d3db;text-transform:uppercase}.header h1{font-size:32px;margin:10px 0 8px}.header p{color:#8ba19d;margin:0;max-width:680px;line-height:1.6}.date{font:12px ui-monospace;color:#6f8581;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:28px 42px}.card{min-height:150px;border:1px solid #253b38;border-radius:14px;padding:18px;background:#0b1413;display:flex;flex-direction:column;gap:15px}.card strong{font-size:18px}.card code{margin-top:auto;color:#8fa6a2;font-size:12px;overflow-wrap:anywhere}.eyebrow{font:700 11px ui-monospace;letter-spacing:.12em;color:#7f9692;text-transform:uppercase}.ready strong{color:#3ee690}.ready-to-promote strong,.guarded strong{color:#29d5df}.next-release strong,.not-published strong,.signing-required strong,.version-drift strong{color:#f4be55}.blocked strong{color:#ff7575}.actions{padding:0 42px 40px}.actions h2{font-size:16px;margin:4px 0 14px}.actions ol{list-style:none;padding:0;margin:0;display:grid;gap:10px}.actions li{display:flex;align-items:flex-start;gap:12px;border-top:1px solid #192b29;padding-top:12px;color:#a9bbb8;line-height:1.45}.actions li span{display:grid;place-items:center;min-width:24px;height:24px;border:1px solid #28504d;border-radius:50%;font:11px ui-monospace;color:#29d5df}@media(max-width:900px){body{padding:20px}.grid{grid-template-columns:1fr 1fr}.header{display:block}.date{display:block;margin-top:18px}}
  </style><body><main class="shell"><header class="header"><div><div class="brand">Lingua · ${es ? 'distribución' : 'distribution'}</div><h1>${es ? 'Estado operativo' : 'Operational readiness'}</h1><p>${es ? 'Evidencia pública y local, sin publicar ni modificar registros.' : 'Public and local evidence without publishing or mutating registries.'}</p></div><span class="date">${escapeHtml(report.generatedAt)}</span></header><section class="grid">${cardHtml}</section><section class="actions"><h2>${es ? 'Próximas acciones' : 'Next actions'}</h2><ol>${actions}</ol></section></main></body></html>`;
}

export function parseReportSnapshot(source) {
  const report = JSON.parse(source);
  const publication = report?.npm?.publication ?? {
    status: 'guarded',
    workflow: 'publish-cli.yml',
    mode: report?.npm?.status === 'not-published' ? 'bootstrap-token' : 'trusted-stage',
  };
  if (
    report?.schemaVersion !== 1 ||
    typeof report?.release?.tag !== 'string' ||
    typeof report?.release?.version !== 'string' ||
    !Array.isArray(report?.release?.desktopAssets?.missing) ||
    !Array.isArray(report?.release?.desktopAssets?.missingChecksums) ||
    !Array.isArray(report?.release?.cliAssets?.missing) ||
    !Array.isArray(report?.release?.cliAssets?.missingChecksums) ||
    typeof report?.npm?.status !== 'string' ||
    publication.status !== 'guarded' ||
    publication.workflow !== 'publish-cli.yml' ||
    !['bootstrap-token', 'trusted-stage'].includes(publication.mode) ||
    typeof report?.homebrew?.status !== 'string' ||
    typeof report?.winget?.status !== 'string' ||
    !Array.isArray(report?.actions) ||
    !report.actions.every(action => typeof action === 'string')
  ) {
    throw new Error('The input file is not a Lingua distribution readiness schema v1 report.');
  }
  return {
    ...report,
    npm: {
      ...report.npm,
      publication,
    },
  };
}

/**
 * `application/vnd.github+json` is a GitHub-specific media type. The npm
 * registry answers it with 406 Not Acceptable, which stayed invisible while
 * `@linguacode/cli` was unpublished: the 404 branch below returns before the
 * `!response.ok` check ever runs. The first successful publish turned that
 * latent mismatch into a hard failure of the whole report, so pick the media
 * type from the host instead of assuming every JSON probe is GitHub's.
 */
export function acceptFor(url, text) {
  if (text) return 'text/plain';
  return new URL(url).hostname.endsWith('api.github.com')
    ? 'application/vnd.github+json'
    : 'application/json';
}

async function fetchPublic(url, { text = false } = {}) {
  const response = await fetch(url, {
    headers: {
      accept: acceptFor(url, text),
      'user-agent': 'lingua-distribution-readiness',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error(
      'The public GitHub API rate limit is exhausted. Retry later, or render a saved JSON report with --input.'
    );
  }
  if (!response.ok) throw new Error(`Public probe failed (${response.status}) for ${url}`);
  return text ? response.text() : response.json();
}

export async function collectDistributionReadiness() {
  const [cask, wingetVersion, wingetInstaller] = await Promise.all([
    readFile(path.join(repoRoot, 'packaging/homebrew/Casks/lingua.rb'), 'utf8'),
    readFile(path.join(repoRoot, 'packaging/winget/Johnny4young.Lingua.yaml'), 'utf8'),
    readFile(path.join(repoRoot, 'packaging/winget/Johnny4young.Lingua.installer.yaml'), 'utf8'),
  ]);
  const [latestRelease, npmPackage, tapRepository, remoteCask] = await Promise.all([
    fetchPublic(`https://api.github.com/repos/${APP_REPOSITORY}/releases/latest`),
    fetchPublic(`https://registry.npmjs.org/${encodeURIComponent(DISTRIBUTION_PACKAGE)}/latest`),
    fetchPublic(`https://api.github.com/repos/${TAP_REPOSITORY}`),
    fetchPublic(`https://raw.githubusercontent.com/${TAP_REPOSITORY}/main/Casks/lingua.rb`, {
      text: true,
    }),
  ]);
  const releaseVersion = stripVersionTag(latestRelease?.tag_name);
  if (!releaseVersion || latestRelease?.draft || latestRelease?.prerelease) {
    throw new Error('The public latest release is missing or is not a stable vX.Y.Z release.');
  }
  const checksumText = await fetchPublic(
    `https://github.com/${APP_REPOSITORY}/releases/download/${latestRelease.tag_name}/SHA256SUMS.txt`,
    { text: true }
  );
  return assessDistributionReadiness({
    latestRelease,
    npmPackage,
    tapRepository,
    remoteCask,
    releaseChecksums: parseChecksums(checksumText ?? ''),
    localVersions: readLocalDistributionState({ cask, wingetVersion, wingetInstaller }),
  });
}

function printHelp() {
  console.log(`Usage: node scripts/distribution-readiness.mjs [options]

Read public registry/release state without publishing or changing anything.

Options:
  --format <markdown|json|html>  Output format (default: markdown)
  --locale <en|es>              Report language (default: en)
  --input <path>                Render a saved schema-v1 JSON report without network access
  --output <path>               Write the report instead of stdout
  -h, --help                    Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      format: { type: 'string', default: 'markdown' },
      locale: { type: 'string', default: 'en' },
      input: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    printHelp();
    return 0;
  }
  if (!['markdown', 'json', 'html'].includes(values.format)) {
    throw new Error(`Unsupported format: ${values.format}`);
  }
  if (!['en', 'es'].includes(values.locale)) {
    throw new Error(`Unsupported locale: ${values.locale}`);
  }
  const report = values.input
    ? parseReportSnapshot(await readFile(path.resolve(values.input), 'utf8'))
    : await collectDistributionReadiness();
  const output =
    values.format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : values.format === 'html'
        ? renderHtmlReport(report, values.locale)
        : `${renderMarkdownReport(report, values.locale)}\n`;
  if (values.output) {
    const target = path.resolve(values.output);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, 'utf8');
    console.log(`Wrote ${path.relative(process.cwd(), target) || target}`);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
