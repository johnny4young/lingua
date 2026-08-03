#!/usr/bin/env node

/**
 * Authenticated, read-only preflight for the GitHub secret names required by
 * the Windows Authenticode release path. Secret values are never requested.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export const WINDOWS_SIGNING_REPOSITORY = 'johnny4young/lingua';
export const WINDOWS_SIGNING_WORKFLOW = 'release.yml';
export const WINDOWS_CERTIFICATE_SECRET = 'WIN_CERT_FILE';
export const WINDOWS_CERTIFICATE_PASSWORD_SECRET = 'WIN_CERT_PASSWORD';
export const WINDOWS_SIGNING_SUMMARY_LINES = Object.freeze([
  'Windows installer: Authenticode signature valid',
  'Windows CLI: Authenticode signature valid',
]);

const GH_COMMAND_TIMEOUT_MS = 15_000;

function actionsForChecks(checks) {
  const actions = [];
  if (!checks.secretPair.complete) {
    if (checks.secretPair.partial) {
      const missing = checks.certificateSecret.present
        ? WINDOWS_CERTIFICATE_PASSWORD_SECRET
        : WINDOWS_CERTIFICATE_SECRET;
      actions.push(
        `Complete the Authenticode pair by adding ${missing}, or remove the orphaned secret before the next release.`
      );
    } else {
      actions.push(
        'Obtain an exportable public-trust code-signing certificate whose identity, expiry, and Windows trust chain have been reviewed.'
      );
      actions.push(
        `Add ${WINDOWS_CERTIFICATE_SECRET} and ${WINDOWS_CERTIFICATE_PASSWORD_SECRET} as repository secrets; never store either value in the repository or a report.`
      );
    }
  } else {
    actions.push(
      `Run a draft ${WINDOWS_SIGNING_WORKFLOW} release with both Windows and CLI artifacts enabled.`
    );
    actions.push(
      `Require the workflow summary to contain ${WINDOWS_SIGNING_SUMMARY_LINES.map(line => JSON.stringify(line)).join(' and ')} before publication.`
    );
    actions.push(
      'Verify install, launch, update, uninstall, publisher identity, and SmartScreen behavior on a clean Windows 11 system before winget submission.'
    );
  }
  return actions;
}

export function assessWindowsSigningPrerequisites({
  repositorySecrets,
  generatedAt = new Date().toISOString(),
}) {
  const names = new Set(repositorySecrets.map(secret => secret.name));
  const certificatePresent = names.has(WINDOWS_CERTIFICATE_SECRET);
  const passwordPresent = names.has(WINDOWS_CERTIFICATE_PASSWORD_SECRET);
  const complete = certificatePresent && passwordPresent;
  const partial = certificatePresent !== passwordPresent;
  const checks = {
    certificateSecret: {
      status: certificatePresent ? 'ready' : 'blocked',
      name: WINDOWS_CERTIFICATE_SECRET,
      present: certificatePresent,
    },
    passwordSecret: {
      status: passwordPresent ? 'ready' : 'blocked',
      name: WINDOWS_CERTIFICATE_PASSWORD_SECRET,
      present: passwordPresent,
    },
    secretPair: {
      status: complete ? 'ready' : 'blocked',
      complete,
      partial,
    },
    runtimeVerification: {
      status: 'review-required',
      requiredEvidence: [...WINDOWS_SIGNING_SUMMARY_LINES],
    },
  };
  const automatedStatus = complete ? 'ready' : 'blocked';
  return {
    schemaVersion: 1,
    generatedAt,
    repository: WINDOWS_SIGNING_REPOSITORY,
    workflow: WINDOWS_SIGNING_WORKFLOW,
    automatedStatus,
    status: complete ? 'review-required' : 'blocked',
    checks,
    actions: actionsForChecks(checks),
  };
}

function statusLabel(status, locale) {
  const labels = {
    en: { ready: 'Ready', blocked: 'Blocked', 'review-required': 'Review required' },
    es: { ready: 'Listo', blocked: 'Bloqueado', 'review-required': 'Requiere revisión' },
  };
  return labels[locale]?.[status] ?? status;
}

function evidenceLabel(value, locale) {
  const labels = {
    en: {
      present: 'present',
      missing: 'missing',
      complete: 'complete',
      partial: 'partial',
      absent: 'not configured',
      runtime: 'installer + CLI',
    },
    es: {
      present: 'presente',
      missing: 'ausente',
      complete: 'completo',
      partial: 'incompleto',
      absent: 'sin configurar',
      runtime: 'instalador + CLI',
    },
  };
  return labels[locale]?.[value] ?? value;
}

function localizeAction(action, locale) {
  if (locale !== 'es') return action;
  if (action.startsWith('Complete the Authenticode pair')) {
    const missing = action.includes(WINDOWS_CERTIFICATE_PASSWORD_SECRET)
      ? WINDOWS_CERTIFICATE_PASSWORD_SECRET
      : WINDOWS_CERTIFICATE_SECRET;
    return `Completa el par de Authenticode agregando ${missing}, o elimina el secreto huérfano antes de la próxima release.`;
  }
  if (action.startsWith('Obtain an exportable public-trust')) {
    return 'Obtén un certificado exportable de firma de código con confianza pública y revisa su identidad, vencimiento y cadena de confianza de Windows.';
  }
  if (action.startsWith(`Add ${WINDOWS_CERTIFICATE_SECRET}`)) {
    return `Agrega ${WINDOWS_CERTIFICATE_SECRET} y ${WINDOWS_CERTIFICATE_PASSWORD_SECRET} como secretos del repositorio; nunca guardes sus valores en el repositorio ni en un reporte.`;
  }
  if (action.startsWith('Run a draft')) {
    return `Ejecuta una release draft con ${WINDOWS_SIGNING_WORKFLOW} y activa tanto los artefactos de Windows como los del CLI.`;
  }
  if (action.startsWith('Require the workflow summary')) {
    return `Exige que el resumen del workflow contenga ${WINDOWS_SIGNING_SUMMARY_LINES.map(line => JSON.stringify(line)).join(' y ')} antes de publicar.`;
  }
  if (action.startsWith('Verify install')) {
    return 'Verifica instalación, apertura, actualización, desinstalación, identidad del editor y comportamiento de SmartScreen en un Windows 11 limpio antes de enviar a winget.';
  }
  return action;
}

function reportRows(report, locale) {
  const es = locale === 'es';
  const pairEvidence = report.checks.secretPair.complete
    ? 'complete'
    : report.checks.secretPair.partial
      ? 'partial'
      : 'absent';
  return [
    [
      es ? 'Secreto del certificado' : 'Certificate secret',
      report.checks.certificateSecret.status,
      evidenceLabel(report.checks.certificateSecret.present ? 'present' : 'missing', locale),
    ],
    [
      es ? 'Secreto de contraseña' : 'Password secret',
      report.checks.passwordSecret.status,
      evidenceLabel(report.checks.passwordSecret.present ? 'present' : 'missing', locale),
    ],
    [
      es ? 'Par de Authenticode' : 'Authenticode pair',
      report.checks.secretPair.status,
      evidenceLabel(pairEvidence, locale),
    ],
    [
      es ? 'Verificación de la release' : 'Release verification',
      report.checks.runtimeVerification.status,
      evidenceLabel('runtime', locale),
    ],
  ];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderMarkdownReport(report, locale = 'en') {
  const es = locale === 'es';
  const rows = reportRows(report, locale);
  return [
    `# ${es ? 'Prerrequisitos de firma para Windows' : 'Windows signing prerequisites'}`,
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
  const cards = reportRows(report, locale)
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
        `<li><span>${index + 1}</span>${escapeHtml(localizeAction(action, locale))}</li>`
    )
    .join('');
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${es ? 'Prerrequisitos de firma para Windows de Lingua' : 'Lingua Windows signing prerequisites'}</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#050908;color:#eef7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% 8%,#23380d 0,transparent 34%),#050908;padding:64px}.shell{width:min(1180px,100%);margin:auto;border:1px solid #37452b;border-radius:24px;background:#0a1008dd;box-shadow:0 28px 100px #0008;overflow:hidden}.header{padding:34px 42px;border-bottom:1px solid #28351f;display:flex;justify-content:space-between;gap:32px}.brand{font:700 12px ui-monospace;letter-spacing:.18em;color:#b6e43c;text-transform:uppercase}.header h1{font-size:32px;margin:10px 0 8px}.header p{color:#9ba88f;margin:0;line-height:1.6}.overall{align-self:flex-start;border:1px solid #5a4525;border-radius:999px;padding:8px 12px;color:#f4be55;font:700 12px ui-monospace;text-transform:uppercase;white-space:nowrap}.grid{display:flex;gap:12px;padding:28px 42px}.card{flex:1 1 0;min-width:0;min-height:150px;border:1px solid #33412a;border-radius:14px;padding:18px;background:#0d140b;display:flex;flex-direction:column;gap:15px}.card strong{font-size:18px}.card code{margin-top:auto;color:#a0ad96;font-size:12px;overflow-wrap:anywhere}.eyebrow{font:700 11px ui-monospace;letter-spacing:.12em;color:#8f9d85;text-transform:uppercase;overflow-wrap:anywhere}.ready strong{color:#83e447}.blocked strong,.review-required strong{color:#f4be55}.actions{padding:0 42px 40px}.actions h2{font-size:16px;margin:4px 0 14px}.actions ol{list-style:none;padding:0;margin:0;display:grid;gap:10px}.actions li{min-width:0;display:flex;align-items:flex-start;gap:12px;border-top:1px solid #26321f;padding-top:12px;color:#b1bcaa;line-height:1.45;overflow-wrap:anywhere}.actions li span{display:grid;place-items:center;min-width:24px;height:24px;border:1px solid #496435;border-radius:50%;font:11px ui-monospace;color:#b6e43c}@media(max-width:900px){body{padding:20px}.grid{flex-wrap:wrap}.card{flex-basis:calc(50% - 6px)}.header{display:block}.overall{display:inline-block;margin-top:18px}}@media(max-width:560px){body{padding:12px}.header,.grid,.actions{padding-left:20px;padding-right:20px}.card{flex-basis:100%}}
  </style><body><main class="shell"><header class="header"><div><div class="brand">Lingua · ${es ? 'firma Windows' : 'Windows signing'}</div><h1>${es ? 'Confianza antes de publicar' : 'Trust before publication'}</h1><p>${es ? 'Inspección autenticada de nombres; los valores de secretos nunca se solicitan.' : 'Authenticated name-only inspection; secret values are never requested.'}</p></div><span class="overall">${escapeHtml(statusLabel(report.status, locale))}</span></header><section class="grid">${cards}</section><section class="actions"><h2>${es ? 'Próximas acciones' : 'Next actions'}</h2><ol>${actions}</ol></section></main></body></html>`;
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key))
  );
}

export function parseReportSnapshot(source) {
  const report = JSON.parse(source);
  const checks = report?.checks;
  const validGeneratedAt =
    typeof report?.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(report.generatedAt)) &&
    new Date(report.generatedAt).toISOString() === report.generatedAt;
  const exactShape =
    hasExactKeys(report, [
      'schemaVersion',
      'generatedAt',
      'repository',
      'workflow',
      'automatedStatus',
      'status',
      'checks',
      'actions',
    ]) &&
    hasExactKeys(checks, [
      'certificateSecret',
      'passwordSecret',
      'secretPair',
      'runtimeVerification',
    ]) &&
    hasExactKeys(checks?.certificateSecret, ['status', 'name', 'present']) &&
    hasExactKeys(checks?.passwordSecret, ['status', 'name', 'present']) &&
    hasExactKeys(checks?.secretPair, ['status', 'complete', 'partial']) &&
    hasExactKeys(checks?.runtimeVerification, ['status', 'requiredEvidence']);
  if (
    !exactShape ||
    report.schemaVersion !== 1 ||
    report.repository !== WINDOWS_SIGNING_REPOSITORY ||
    report.workflow !== WINDOWS_SIGNING_WORKFLOW ||
    !validGeneratedAt ||
    checks.certificateSecret.name !== WINDOWS_CERTIFICATE_SECRET ||
    typeof checks.certificateSecret.present !== 'boolean' ||
    checks.passwordSecret.name !== WINDOWS_CERTIFICATE_PASSWORD_SECRET ||
    typeof checks.passwordSecret.present !== 'boolean' ||
    typeof checks.secretPair.complete !== 'boolean' ||
    typeof checks.secretPair.partial !== 'boolean' ||
    !Array.isArray(checks.runtimeVerification.requiredEvidence) ||
    !checks.runtimeVerification.requiredEvidence.every(item => typeof item === 'string') ||
    !Array.isArray(report.actions) ||
    !report.actions.every(action => typeof action === 'string')
  ) {
    throw new Error(
      'The input file is not a Lingua Windows signing prerequisite schema v1 report.'
    );
  }

  const certificatePresent = checks.certificateSecret.present;
  const passwordPresent = checks.passwordSecret.present;
  const complete = certificatePresent && passwordPresent;
  const partial = certificatePresent !== passwordPresent;
  const expectedChecks = {
    certificateStatus: certificatePresent ? 'ready' : 'blocked',
    passwordStatus: passwordPresent ? 'ready' : 'blocked',
    pairStatus: complete ? 'ready' : 'blocked',
  };
  if (
    checks.certificateSecret.status !== expectedChecks.certificateStatus ||
    checks.passwordSecret.status !== expectedChecks.passwordStatus ||
    checks.secretPair.status !== expectedChecks.pairStatus ||
    checks.secretPair.complete !== complete ||
    checks.secretPair.partial !== partial ||
    checks.runtimeVerification.status !== 'review-required' ||
    JSON.stringify(checks.runtimeVerification.requiredEvidence) !==
      JSON.stringify(WINDOWS_SIGNING_SUMMARY_LINES) ||
    report.automatedStatus !== (complete ? 'ready' : 'blocked') ||
    report.status !== (complete ? 'review-required' : 'blocked') ||
    JSON.stringify(report.actions) !== JSON.stringify(actionsForChecks(checks))
  ) {
    throw new Error(
      'The input file has inconsistent Lingua Windows signing prerequisite evidence.'
    );
  }
  return report;
}

function collectRepositorySecretNames() {
  const auth = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf8',
    timeout: GH_COMMAND_TIMEOUT_MS,
  });
  if (auth.error) throw auth.error;
  if (auth.status !== 0) {
    throw new Error('GitHub CLI authentication is required for the Windows signing preflight.');
  }
  const result = spawnSync(
    'gh',
    ['secret', 'list', '--repo', WINDOWS_SIGNING_REPOSITORY, '--json', 'name'],
    { encoding: 'utf8', timeout: GH_COMMAND_TIMEOUT_MS }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('GitHub CLI could not inspect repository secret names.');
  }
  const source = result.stdout.trim();
  const secrets = source ? JSON.parse(source) : [];
  if (!Array.isArray(secrets) || !secrets.every(secret => typeof secret?.name === 'string')) {
    throw new Error('GitHub CLI returned malformed repository secret metadata.');
  }
  return secrets;
}

export function collectWindowsSigningPrerequisites() {
  return assessWindowsSigningPrerequisites({ repositorySecrets: collectRepositorySecretNames() });
}

function printHelp() {
  console.log(`Usage: node scripts/windows-signing-prerequisites.mjs [options]

Inspect Windows signing secret names without changing GitHub or reading values.

Options:
  --format <markdown|json|html>  Output format (default: markdown)
  --locale <en|es>              Report language (default: en)
  --input <path>                Render a saved schema-v1 report without gh
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
    : collectWindowsSigningPrerequisites();
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
