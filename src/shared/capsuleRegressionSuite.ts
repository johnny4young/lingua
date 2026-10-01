import { parseRunCapsule, type RunCapsuleV1 } from './runCapsule';
import { utf8ByteLength } from './utf8';

export const MAX_REGRESSION_SUITE_BYTES = 4 * 1024 * 1024;
const MAX_REGRESSION_CASES = 20;
interface CapsuleRegressionCase {
  id: string;
  name: string;
  target: string;
  baseline: RunCapsuleV1;
}
export interface CapsuleRegressionSuiteV1 {
  kind: 'lingua-regression-suite';
  suiteVersion: 1;
  cases: CapsuleRegressionCase[];
}
/** Portable artifact paths are relative on every host, not just the current OS. */
export function isRegressionTarget(target: unknown): target is string {
  return (
    typeof target === 'string' &&
    target.length > 0 &&
    target.length <= 4096 &&
    !Array.from(target).some(character => character.charCodeAt(0) < 32) &&
    !/^[\\/]|^[a-zA-Z]:/.test(target) &&
    !target.split(/[\\/]/).some(part => part === '..' || part === '.' || part === '')
  );
}
export function parseCapsuleRegressionSuite(
  raw: string
): { ok: true; suite: CapsuleRegressionSuiteV1 } | { ok: false; reason: string } {
  if (utf8ByteLength(raw) > MAX_REGRESSION_SUITE_BYTES)
    return { ok: false, reason: 'suite-too-large' };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-suite-json' };
  }
  if (
    !value ||
    value.kind !== 'lingua-regression-suite' ||
    value.suiteVersion !== 1 ||
    Object.keys(value).some(key => !['kind', 'suiteVersion', 'cases'].includes(key)) ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    value.cases.length > MAX_REGRESSION_CASES
  )
    return { ok: false, reason: 'invalid-suite' };
  const cases: CapsuleRegressionCase[] = [];
  const ids = new Set<string>();
  for (const entry of value.cases) {
    if (
      !entry ||
      Object.keys(entry).some(key => !['id', 'name', 'target', 'baseline'].includes(key)) ||
      typeof entry.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.length > 200 ||
      !isRegressionTarget(entry.target)
    )
      return { ok: false, reason: 'invalid-suite-case' };
    const baseline = parseRunCapsule(JSON.stringify(entry.baseline));
    if (!baseline.ok) return { ok: false, reason: `invalid-baseline:${baseline.reason}` };
    ids.add(entry.id);
    cases.push({ id: entry.id, name: entry.name, target: entry.target, baseline: baseline.value });
  }
  return { ok: true, suite: { kind: 'lingua-regression-suite', suiteVersion: 1, cases } };
}
export function serializeCapsuleRegressionSuite(suite: CapsuleRegressionSuiteV1): string {
  const raw = JSON.stringify(suite, null, 2);
  const parsed = parseCapsuleRegressionSuite(`${raw}\n`);
  if (!parsed.ok) throw new Error(parsed.reason);
  return `${raw}\n`;
}
