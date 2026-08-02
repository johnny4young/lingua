#!/usr/bin/env node

/**
 * Authenticated, read-only preflight for the external state required by the
 * protected CLI npm workflow. It inspects configuration names and protection
 * metadata only; secret values are never requested or returned.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CLI_PACKAGE_NAME } from './cli-package-contract.mjs';

const __filename = fileURLToPath(import.meta.url);

export const CLI_PUBLISH_REPOSITORY = 'johnny4young/lingua';
export const CLI_PUBLISH_ENVIRONMENT = 'npm-production';
export const CLI_BOOTSTRAP_SECRET = 'NPM_PUBLISH_TOKEN';
const GH_COMMAND_TIMEOUT_MS = 15_000;
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function reviewerCount(environment) {
  const rule = environment?.protection_rules?.find(
    candidate => candidate?.type === 'required_reviewers'
  );
  return Array.isArray(rule?.reviewers) ? rule.reviewers.length : 0;
}

export function assessCliPublishPrerequisites({
  immutableReleases,
  environment,
  environmentSecrets,
  npmPackage,
  generatedAt = new Date().toISOString(),
}) {
  const packageExists = npmPackage?.name === CLI_PACKAGE_NAME;
  const mode = packageExists ? 'trusted-stage' : 'bootstrap';
  const reviewers = reviewerCount(environment);
  const secretNames = new Set(environmentSecrets.map(secret => secret.name));
  const bootstrapSecretPresent = secretNames.has(CLI_BOOTSTRAP_SECRET);

  const checks = {
    immutableReleases: {
      status: immutableReleases?.enabled === true ? 'ready' : 'blocked',
      enabled: immutableReleases?.enabled === true,
      enforcedByOwner: immutableReleases?.enforced_by_owner === true,
    },
    environment: {
      status: environment && reviewers > 0 ? 'ready' : 'blocked',
      exists: Boolean(environment),
      reviewers,
    },
    bootstrapCredential: {
      status: packageExists
        ? bootstrapSecretPresent
          ? 'blocked'
          : 'ready'
        : bootstrapSecretPresent
          ? 'ready'
          : 'blocked',
      required: !packageExists,
      present: bootstrapSecretPresent,
      name: CLI_BOOTSTRAP_SECRET,
    },
    npmPackage: {
      status: packageExists ? 'published' : 'bootstrap-required',
      exists: packageExists,
      version: packageExists
        ? (npmPackage.version ?? npmPackage['dist-tags']?.latest ?? null)
        : null,
    },
  };

  const actions = actionsForChecks(checks);

  const automatedChecksReady = [
    checks.immutableReleases.status,
    checks.environment.status,
    checks.bootstrapCredential.status,
  ].every(status => status === 'ready');

  return {
    schemaVersion: 1,
    generatedAt,
    repository: CLI_PUBLISH_REPOSITORY,
    environment: CLI_PUBLISH_ENVIRONMENT,
    package: CLI_PACKAGE_NAME,
    mode,
    automatedStatus: automatedChecksReady ? 'ready' : 'blocked',
    status: automatedChecksReady ? 'review-required' : 'blocked',
    checks,
    actions,
  };
}

function actionsForChecks(checks) {
  const actions = [];
  if (!checks.immutableReleases.enabled) {
    actions.push(
      `Enable release immutability for ${CLI_PUBLISH_REPOSITORY} before cutting the next CLI-bearing release.`
    );
  }
  if (!checks.environment.exists) {
    actions.push(
      `Create the ${CLI_PUBLISH_ENVIRONMENT} GitHub environment and add at least one required reviewer.`
    );
  } else if (checks.environment.reviewers === 0) {
    actions.push(
      `Add at least one required reviewer to the ${CLI_PUBLISH_ENVIRONMENT} GitHub environment.`
    );
  }
  if (checks.bootstrapCredential.required && !checks.bootstrapCredential.present) {
    actions.push(
      `After the environment is protected, add ${CLI_BOOTSTRAP_SECRET}: a short-lived granular token with read/write access to the @linguacode scope and Bypass 2FA enabled for the first publish only.`
    );
  }
  if (!checks.npmPackage.exists) {
    actions.push(
      'Confirm the @linguacode npm scope, publisher access, and account 2FA before approving the bootstrap job.'
    );
  } else {
    if (checks.bootstrapCredential.present) {
      actions.push(
        `Remove ${CLI_BOOTSTRAP_SECRET} from ${CLI_PUBLISH_ENVIRONMENT} and revoke the bootstrap token.`
      );
    }
    actions.push(
      'Confirm npm trusted publishing allows only publish-cli.yml, npm-production, and npm stage publish before the next version.'
    );
  }

  return actions;
}

function statusLabel(status, locale) {
  const labels = {
    en: {
      ready: 'Ready',
      blocked: 'Blocked',
      published: 'Published',
      'bootstrap-required': 'Bootstrap required',
      'review-required': 'Review required',
    },
    es: {
      ready: 'Listo',
      blocked: 'Bloqueado',
      published: 'Publicado',
      'bootstrap-required': 'Requiere bootstrap',
      'review-required': 'Requiere revisión',
    },
  };
  return labels[locale]?.[status] ?? status;
}

function localizeAction(action, locale) {
  if (locale !== 'es') return action;
  if (action.startsWith('Enable release immutability')) {
    return `Activa releases inmutables para ${CLI_PUBLISH_REPOSITORY} antes de crear la próxima versión que incluya el CLI.`;
  }
  if (action.startsWith('Create the npm-production')) {
    return `Crea el entorno ${CLI_PUBLISH_ENVIRONMENT} en GitHub y agrega al menos un revisor obligatorio.`;
  }
  if (action.startsWith('Add at least one required reviewer')) {
    return `Agrega al menos un revisor obligatorio al entorno ${CLI_PUBLISH_ENVIRONMENT} de GitHub.`;
  }
  if (action.startsWith('After the environment is protected')) {
    return `Cuando el entorno esté protegido, agrega ${CLI_BOOTSTRAP_SECRET}: un token granular y de corta duración, con lectura y escritura sobre el scope @linguacode y Bypass 2FA activado solo para la primera publicación.`;
  }
  if (action.startsWith('Confirm the @linguacode npm scope')) {
    return 'Confirma el scope @linguacode en npm, el permiso para publicar y el 2FA de la cuenta antes de aprobar el job de bootstrap.';
  }
  if (action.startsWith(`Remove ${CLI_BOOTSTRAP_SECRET}`)) {
    return `Elimina ${CLI_BOOTSTRAP_SECRET} de ${CLI_PUBLISH_ENVIRONMENT} y revoca el token de bootstrap.`;
  }
  if (action.startsWith('Confirm npm trusted publishing')) {
    return 'Confirma que la publicación confiable de npm solo permita publish-cli.yml, npm-production y npm stage publish antes de la próxima versión.';
  }
  return action;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function evidenceLabel(value, locale) {
  const labels = {
    en: {
      enabled: 'enabled',
      disabled: 'disabled',
      missing: 'missing',
      present: 'present',
    },
    es: {
      enabled: 'activadas',
      disabled: 'desactivadas',
      missing: 'ausente',
      present: 'presente',
    },
  };
  return labels[locale]?.[value] ?? value;
}

function reviewerEvidence(count, locale) {
  if (locale === 'es') return `${count} ${count === 1 ? 'revisor' : 'revisores'}`;
  return `${count} ${count === 1 ? 'reviewer' : 'reviewers'}`;
}

export function renderMarkdownReport(report, locale = 'en') {
  const es = locale === 'es';
  const rows = [
    [
      es ? 'Releases inmutables' : 'Immutable releases',
      report.checks.immutableReleases.status,
      evidenceLabel(report.checks.immutableReleases.enabled ? 'enabled' : 'disabled', locale),
    ],
    [
      es ? 'Entorno protegido' : 'Protected environment',
      report.checks.environment.status,
      report.checks.environment.exists
        ? reviewerEvidence(report.checks.environment.reviewers, locale)
        : evidenceLabel('missing', locale),
    ],
    [
      es ? 'Credencial bootstrap' : 'Bootstrap credential',
      report.checks.bootstrapCredential.status,
      evidenceLabel(report.checks.bootstrapCredential.present ? 'present' : 'missing', locale),
    ],
    [
      es ? 'Paquete npm' : 'npm package',
      report.checks.npmPackage.status,
      report.checks.npmPackage.version ?? report.package,
    ],
  ];
  return [
    `# ${es ? 'Prerrequisitos de publicación del CLI' : 'CLI publication prerequisites'}`,
    '',
    `${es ? 'Estado' : 'Status'}: ${statusLabel(report.status, locale)}`,
    `${es ? 'Controles automatizados' : 'Automated checks'}: ${statusLabel(report.automatedStatus, locale)}`,
    `${es ? 'Generado' : 'Generated'}: ${report.generatedAt}`,
    '',
    `| ${es ? 'Control' : 'Check'} | ${es ? 'Estado' : 'Status'} | ${es ? 'Evidencia' : 'Evidence'} |`,
    '| --- | --- | --- |',
    ...rows.map(
      ([name, status, evidence]) => `| ${name} | ${statusLabel(status, locale)} | ${evidence} |`
    ),
    '',
    `## ${es ? 'Próximas acciones' : 'Next actions'}`,
    '',
    ...report.actions.map((action, index) => `${index + 1}. ${localizeAction(action, locale)}`),
    '',
  ].join('\n');
}

export function renderHtmlReport(report, locale = 'en') {
  const es = locale === 'es';
  const cards = [
    [
      es ? 'Releases inmutables' : 'Immutable releases',
      report.checks.immutableReleases.status,
      evidenceLabel(report.checks.immutableReleases.enabled ? 'enabled' : 'disabled', locale),
    ],
    [
      es ? 'Entorno protegido' : 'Protected environment',
      report.checks.environment.status,
      report.checks.environment.exists
        ? reviewerEvidence(report.checks.environment.reviewers, locale)
        : evidenceLabel('missing', locale),
    ],
    [
      es ? 'Credencial bootstrap' : 'Bootstrap credential',
      report.checks.bootstrapCredential.status,
      evidenceLabel(report.checks.bootstrapCredential.present ? 'present' : 'missing', locale),
    ],
    [
      es ? 'Paquete npm' : 'npm package',
      report.checks.npmPackage.status,
      report.checks.npmPackage.version ?? report.package,
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
  const actionHtml = report.actions
    .map(
      (action, index) =>
        `<li><span>${index + 1}</span>${escapeHtml(localizeAction(action, locale))}</li>`
    )
    .join('');
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${es ? 'Prerrequisitos de publicación del CLI de Lingua' : 'Lingua CLI publication prerequisites'}</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#050908;color:#eef7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% 8%,#0b3b3e 0,transparent 34%),#050908;padding:64px}.shell{width:min(1180px,100%);margin:auto;border:1px solid #27423f;border-radius:24px;background:#08100fdd;box-shadow:0 28px 100px #0008;overflow:hidden}.header{padding:34px 42px;border-bottom:1px solid #1b302e;display:flex;justify-content:space-between;gap:32px}.brand{font:700 12px ui-monospace;letter-spacing:.18em;color:#23d3db;text-transform:uppercase}.header h1{font-size:32px;margin:10px 0 8px}.header p{color:#8ba19d;margin:0;line-height:1.6}.overall{align-self:flex-start;border:1px solid #4c3327;border-radius:999px;padding:8px 12px;color:#f4be55;font:700 12px ui-monospace;text-transform:uppercase;white-space:nowrap}.grid{display:flex;gap:12px;padding:28px 42px}.card{flex:1 1 0;min-width:0;min-height:150px;border:1px solid #253b38;border-radius:14px;padding:18px;background:#0b1413;display:flex;flex-direction:column;gap:15px}.card strong{font-size:18px}.card code{margin-top:auto;color:#8fa6a2;font-size:12px;overflow-wrap:anywhere}.eyebrow{font:700 11px ui-monospace;letter-spacing:.12em;color:#7f9692;text-transform:uppercase;overflow-wrap:anywhere}.ready strong,.published strong{color:#3ee690}.blocked strong,.bootstrap-required strong,.review-required strong{color:#f4be55}.actions{padding:0 42px 40px}.actions h2{font-size:16px;margin:4px 0 14px}.actions ol{list-style:none;padding:0;margin:0;display:grid;gap:10px}.actions li{min-width:0;display:flex;align-items:flex-start;gap:12px;border-top:1px solid #192b29;padding-top:12px;color:#a9bbb8;line-height:1.45;overflow-wrap:anywhere}.actions li span{display:grid;place-items:center;min-width:24px;height:24px;border:1px solid #28504d;border-radius:50%;font:11px ui-monospace;color:#29d5df}@media(max-width:900px){body{padding:20px}.grid{flex-wrap:wrap}.card{flex-basis:calc(50% - 6px)}.header{display:block}.overall{display:inline-block;margin-top:18px}}@media(max-width:560px){body{padding:12px}.header,.grid,.actions{padding-left:20px;padding-right:20px}.card{flex-basis:100%}}
  </style><body><main class="shell"><header class="header"><div><div class="brand">Lingua · ${es ? 'publicación CLI' : 'CLI publication'}</div><h1>${es ? 'Prerrequisitos externos' : 'External prerequisites'}</h1><p>${es ? 'Inspección autenticada y de solo lectura; nunca solicita valores de secretos.' : 'Authenticated read-only inspection; secret values are never requested.'}</p></div><span class="overall">${escapeHtml(statusLabel(report.status, locale))}</span></header><section class="grid">${cardHtml}</section><section class="actions"><h2>${es ? 'Próximas acciones' : 'Next actions'}</h2><ol>${actionHtml}</ol></section></main></body></html>`;
}

export function parseReportSnapshot(source) {
  const report = JSON.parse(source);
  const exactKeys = (value, keys) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
  const validGeneratedAt =
    typeof report?.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(report.generatedAt)) &&
    new Date(report.generatedAt).toISOString() === report.generatedAt;
  const checks = report?.checks;
  const exactShape =
    exactKeys(report, [
      'schemaVersion',
      'generatedAt',
      'repository',
      'environment',
      'package',
      'mode',
      'automatedStatus',
      'status',
      'checks',
      'actions',
    ]) &&
    exactKeys(checks, ['immutableReleases', 'environment', 'bootstrapCredential', 'npmPackage']) &&
    exactKeys(checks?.immutableReleases, ['status', 'enabled', 'enforcedByOwner']) &&
    exactKeys(checks?.environment, ['status', 'exists', 'reviewers']) &&
    exactKeys(checks?.bootstrapCredential, ['status', 'required', 'present', 'name']) &&
    exactKeys(checks?.npmPackage, ['status', 'exists', 'version']);
  if (
    !exactShape ||
    report?.schemaVersion !== 1 ||
    report?.repository !== CLI_PUBLISH_REPOSITORY ||
    report?.environment !== CLI_PUBLISH_ENVIRONMENT ||
    report?.package !== CLI_PACKAGE_NAME ||
    !validGeneratedAt ||
    typeof checks?.immutableReleases?.enabled !== 'boolean' ||
    typeof checks?.immutableReleases?.enforcedByOwner !== 'boolean' ||
    typeof checks?.environment?.exists !== 'boolean' ||
    !Number.isInteger(checks?.environment?.reviewers) ||
    checks.environment.reviewers < 0 ||
    typeof checks?.bootstrapCredential?.required !== 'boolean' ||
    typeof checks?.bootstrapCredential?.present !== 'boolean' ||
    checks?.bootstrapCredential?.name !== CLI_BOOTSTRAP_SECRET ||
    typeof checks?.npmPackage?.exists !== 'boolean' ||
    !(
      checks.npmPackage.version === null ||
      (typeof checks.npmPackage.version === 'string' &&
        STABLE_VERSION_PATTERN.test(checks.npmPackage.version))
    ) ||
    !Array.isArray(report?.actions) ||
    !report.actions.every(action => typeof action === 'string')
  ) {
    throw new Error(
      'The input file is not a Lingua CLI publication prerequisite schema v1 report.'
    );
  }

  const expectedImmutableStatus = checks.immutableReleases.enabled ? 'ready' : 'blocked';
  const expectedEnvironmentStatus =
    checks.environment.exists && checks.environment.reviewers > 0 ? 'ready' : 'blocked';
  const expectedBootstrapRequired = !checks.npmPackage.exists;
  const expectedBootstrapStatus = expectedBootstrapRequired
    ? checks.bootstrapCredential.present
      ? 'ready'
      : 'blocked'
    : checks.bootstrapCredential.present
      ? 'blocked'
      : 'ready';
  const automatedReady = [
    expectedImmutableStatus,
    expectedEnvironmentStatus,
    expectedBootstrapStatus,
  ].every(status => status === 'ready');
  const expectedActions = actionsForChecks(checks);
  if (
    checks.immutableReleases.status !== expectedImmutableStatus ||
    (checks.immutableReleases.enforcedByOwner && !checks.immutableReleases.enabled) ||
    checks.environment.status !== expectedEnvironmentStatus ||
    (!checks.environment.exists && checks.environment.reviewers !== 0) ||
    checks.bootstrapCredential.required !== expectedBootstrapRequired ||
    checks.bootstrapCredential.status !== expectedBootstrapStatus ||
    checks.npmPackage.status !== (checks.npmPackage.exists ? 'published' : 'bootstrap-required') ||
    checks.npmPackage.exists !== (checks.npmPackage.version !== null) ||
    report.mode !== (checks.npmPackage.exists ? 'trusted-stage' : 'bootstrap') ||
    report.automatedStatus !== (automatedReady ? 'ready' : 'blocked') ||
    report.status !== (automatedReady ? 'review-required' : 'blocked') ||
    JSON.stringify(report.actions) !== JSON.stringify(expectedActions)
  ) {
    throw new Error(
      'The input file has inconsistent Lingua CLI publication prerequisite evidence.'
    );
  }
  return report;
}

function runGh(args, { allowNotFound = false } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: GH_COMMAND_TIMEOUT_MS });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowNotFound && /HTTP 404|Not Found/u.test(`${result.stdout}\n${result.stderr}`)) {
      return null;
    }
    throw new Error(`GitHub CLI command failed: gh ${args.slice(0, 2).join(' ')}`);
  }
  const source = result.stdout.trim();
  return source ? JSON.parse(source) : null;
}

async function fetchNpmPackage() {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`,
    {
      headers: { accept: 'application/json', 'user-agent': 'lingua-cli-publish-prerequisites' },
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry prerequisite probe failed (${response.status}).`);
  return response.json();
}

export async function collectCliPublishPrerequisites() {
  const auth = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf8',
    timeout: GH_COMMAND_TIMEOUT_MS,
  });
  if (auth.error) throw auth.error;
  if (auth.status !== 0) {
    throw new Error('GitHub CLI authentication is required for the CLI publication preflight.');
  }
  const immutableReleases = runGh(
    [
      'api',
      `repos/${CLI_PUBLISH_REPOSITORY}/immutable-releases`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
    ],
    { allowNotFound: true }
  );
  const environment = runGh(
    [
      'api',
      `repos/${CLI_PUBLISH_REPOSITORY}/environments/${CLI_PUBLISH_ENVIRONMENT}`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
    ],
    { allowNotFound: true }
  );
  const environmentSecrets = environment
    ? (runGh([
        'secret',
        'list',
        '--env',
        CLI_PUBLISH_ENVIRONMENT,
        '--repo',
        CLI_PUBLISH_REPOSITORY,
        '--json',
        'name',
      ]) ?? [])
    : [];
  const npmPackage = await fetchNpmPackage();
  return assessCliPublishPrerequisites({
    immutableReleases,
    environment,
    environmentSecrets,
    npmPackage,
  });
}

function printHelp() {
  console.log(`Usage: node scripts/cli-publish-prerequisites.mjs [options]

Inspect external CLI publication prerequisites without changing them.

Options:
  --format <markdown|json|html>  Output format (default: markdown)
  --locale <en|es>              Report language (default: en)
  --input <path>                Render a saved schema-v1 report without network or gh
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
    : await collectCliPublishPrerequisites();
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
