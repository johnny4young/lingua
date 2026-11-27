import { describe, expect, it } from 'vitest';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';
import { capsulePlatformLabel, capsuleRuntimeLabel } from '../../../src/renderer/components/CapsuleList/capsuleRunDetails';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';

const t = (key: string) => `t:${key}`;

function capsule(language: string, runtimeMode: string, platform: 'web' | 'desktop' = 'web'): RunCapsuleV1 {
  return {
    ...FIXTURE_MINIMAL_JS,
    tab: { ...FIXTURE_MINIMAL_JS.tab, language, runtimeMode },
    environment: { ...FIXTURE_MINIMAL_JS.environment, platform, runner: runtimeMode },
  };
}

describe('capsule run details', () => {
  it('names JavaScript runtimes and the browser preview', () => {
    expect(capsuleRuntimeLabel(capsule('javascript', 'worker'), t)).toBe('Web Worker');
    expect(capsuleRuntimeLabel(capsule('typescript', 'node', 'desktop'), t)).toBe('t:runtimeMode.mode.node');
    expect(capsuleRuntimeLabel(capsule('javascript', 'future-mode'), t)).toBeNull();
    expect(capsuleRuntimeLabel(capsule('javascript', 'browser-preview'), t)).toBe('t:runtimeMode.mode.browserPreview');
  });

  it('reads a known engine per language or workspace', () => {
    expect(capsuleRuntimeLabel(capsule('python', 'worker', 'desktop'), t)).toBe('Pyodide');
    expect(capsuleRuntimeLabel(capsule('ruby', 'worker'), t)).toBe('ruby.wasm');
    expect(capsuleRuntimeLabel(capsule('sql', 'duckdb-wasm'), t)).toBe('DuckDB');
    expect(capsuleRuntimeLabel(capsule('sql', 'sql-postgres'), t)).toBe('Postgres');
    expect(capsuleRuntimeLabel(capsule('http', 'http-client'), t)).toBe('t:capsuleList.runtime.http');
    expect(capsuleRuntimeLabel(capsule('pipeline', 'utility-pipeline'), t)).toBe('t:capsuleList.runtime.pipeline');
  });

  it('leaves the runtime out when the stored mode cannot say what ran', () => {
    expect(capsuleRuntimeLabel(capsule('go', 'worker', 'desktop'), t)).toBeNull();
    expect(capsuleRuntimeLabel(capsule('ruby', 'worker', 'desktop'), t)).toBeNull();
    expect(capsuleRuntimeLabel(capsule('sql', 'sql-unknown'), t)).toBeNull();
  });

  it('labels the platform', () => {
    expect(capsulePlatformLabel(capsule('javascript', 'worker', 'web'), t)).toBe('t:license.devices.surface.web');
    expect(capsulePlatformLabel(capsule('javascript', 'worker', 'desktop'), t)).toBe('t:license.devices.surface.desktop');
  });
});
