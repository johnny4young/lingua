import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditDirectTelemetryCalls,
  scanDirectTelemetryCalls,
} from '../../scripts/check-telemetry-call-sites.mjs';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-telemetry-audit-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('telemetry call-site audit', () => {
  it('allows the hook entry point and a legacy file within its ceiling', () => {
    const root = makeRoot({
      'src/renderer/hooks/useTelemetry.ts':
        "import { trackEvent } from '../utils/telemetry'; trackEvent('app.launched');",
      'src/renderer/legacy.ts':
        "import { trackEvent } from './utils/telemetry'; void trackEvent('app.launched');",
    });

    const result = auditDirectTelemetryCalls(root, {
      'src/renderer/legacy.ts': 1,
    });

    expect(result.issues).toEqual([]);
  });

  it('rejects a new direct caller', () => {
    const root = makeRoot({
      'src/renderer/components/NewSurface.tsx':
        "import { trackEvent } from '../utils/telemetry'; void trackEvent('overlay.opened');",
    });

    expect(auditDirectTelemetryCalls(root, {}).issues).toEqual([
      'src/renderer/components/NewSurface.tsx: 1 direct trackEvent call(s); route React callers through useTelemetry()',
    ]);
  });

  it('rejects increases above a grandfathered ceiling', () => {
    const root = makeRoot({
      'src/renderer/legacy.ts': [
        "import { trackEvent } from './utils/telemetry';",
        "void trackEvent('app.launched');",
        "void trackEvent('overlay.opened');",
      ].join('\n'),
    });

    expect(
      auditDirectTelemetryCalls(root, {
        'src/renderer/legacy.ts': 1,
      }).issues
    ).toEqual([
      'src/renderer/legacy.ts: 2 direct trackEvent call(s), legacy ceiling is 1',
    ]);
  });

  it('requires a grandfathered ceiling to ratchet downward', () => {
    const root = makeRoot({
      'src/renderer/legacy.ts':
        "import { trackEvent } from './utils/telemetry'; void trackEvent('app.launched');",
    });

    expect(
      auditDirectTelemetryCalls(root, {
        'src/renderer/legacy.ts': 2,
        'src/renderer/removed.ts': 1,
      }).issues
    ).toEqual([
      'src/renderer/legacy.ts: 1 direct trackEvent call(s), legacy ceiling is 2; lower or remove the stale ceiling',
      'src/renderer/removed.ts: 0 direct trackEvent call(s), legacy ceiling is 1; lower or remove the stale ceiling',
    ]);
  });

  it('detects aliased direct imports', () => {
    const root = makeRoot({
      'src/renderer/aliased.ts':
        "import { trackEvent as emit } from './utils/telemetry'; void emit('app.launched');",
    });

    expect(scanDirectTelemetryCalls(root).get('src/renderer/aliased.ts')).toBe(1);
  });

  it('detects relative utility imports and aliased dynamic imports', () => {
    const root = makeRoot({
      'src/renderer/utils/staticCaller.ts':
        "import { trackEvent } from './telemetry'; void trackEvent('app.launched');",
      'src/renderer/utils/dynamicCaller.ts':
        "void import('./telemetry').then(({ trackEvent: emit }) => { void emit('app.launched'); });",
    });

    const calls = scanDirectTelemetryCalls(root);
    expect(calls.get('src/renderer/utils/staticCaller.ts')).toBe(1);
    expect(calls.get('src/renderer/utils/dynamicCaller.ts')).toBe(1);
  });
});
