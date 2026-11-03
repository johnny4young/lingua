import { createHash } from 'node:crypto';

const CI_PORT = 4175;
const DERIVED_PORT_BASE = 20000;
const DERIVED_PORT_RANGE = 10000;
const MAX_DERIVED_PROBES = 20;
const PROBE_TIMEOUT_MS = 2000;

/**
 * @param {string} repoRoot
 * @returns {number} a stable port private to this checkout, below the
 *   ephemeral ranges and above Chromium's blocked ports
 */
export function deriveE2ePreviewPort(repoRoot) {
  const digest = createHash('sha256').update(repoRoot).digest();
  return DERIVED_PORT_BASE + (digest.readUInt32BE(0) % DERIVED_PORT_RANGE);
}

/**
 * Bundle file names are content-hashed and the license key is baked into the
 * bundle, so an identical index.html means this checkout's build.
 *
 * @param {number} port
 * @param {string} indexHtml
 * @returns {Promise<'free' | 'own' | 'foreign'>}
 */
async function probePort(port, indexHtml) {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return (await response.text()) === indexHtml ? 'own' : 'foreign';
  } catch (error) {
    return error?.cause?.code === 'ECONNREFUSED' ? 'free' : 'foreign';
  }
}

/**
 * `reuse` is true only when the port already serves this checkout's build, so
 * a run never adopts another checkout's server.
 */
export async function resolveE2ePreviewServer({ repoRoot, indexHtml, env = process.env }) {
  const override = env.LINGUA_E2E_PORT ? Number(env.LINGUA_E2E_PORT) : undefined;
  if (override !== undefined && !(Number.isInteger(override) && override > 0 && override < 65536)) {
    throw new Error(`LINGUA_E2E_PORT must be a port number, got ${env.LINGUA_E2E_PORT}.`);
  }
  if (env.CI) return { port: override ?? CI_PORT, reuse: false };

  if (override !== undefined) {
    const state = await probePort(override, indexHtml);
    if (state === 'foreign') {
      throw new Error(
        `LINGUA_E2E_PORT=${override} is serving something other than this checkout's dist/web.`
      );
    }
    return { port: override, reuse: state === 'own' };
  }

  const derived = deriveE2ePreviewPort(repoRoot) - DERIVED_PORT_BASE;
  for (let step = 0; step < MAX_DERIVED_PROBES; step += 1) {
    const port = DERIVED_PORT_BASE + ((derived + step) % DERIVED_PORT_RANGE);
    const state = await probePort(port, indexHtml);
    if (state !== 'foreign') return { port, reuse: state === 'own' };
  }
  throw new Error(
    `No free e2e preview port near ${DERIVED_PORT_BASE + derived}. Set LINGUA_E2E_PORT to a free port.`
  );
}
