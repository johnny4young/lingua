import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  env: {
    PATH: '/opt/toolchains/bin',
    GOPATH: '/tmp/go-path',
    NODE_PATH: '/tmp/node-modules',
    DENO_DIR: '/tmp/deno-cache',
    RBENV_VERSION: '3.3.6',
    API_TOKEN: 'private-project-secret',
    NODE_OPTIONS: '--require /tmp/loader.js',
  },
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ activeTabId: 'tab-1' }) },
}));
vi.mock('../../src/renderer/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'project-1' } }) },
}));
vi.mock('../../src/renderer/stores/envVarsStore', () => ({
  useEnvVarsStore: { getState: () => ({
    project: { 'project-1': { API_TOKEN: 'private-project-secret' } },
    resolveEffectiveEnv: () => mocks.env,
  }) },
}));

import {
  resolveUserEnvForNativeProbe,
  resolveUserEnvForRunner,
} from '../../src/renderer/runners/env';

describe('passive native toolchain environment', () => {
  beforeEach(() => { mocks.trackEvent.mockClear(); });

  it('does not count a passive capability preview as a project runtime use', () => {
    expect(resolveUserEnvForNativeProbe('go', 'darwin')).toEqual({
      PATH: '/opt/toolchains/bin', GOPATH: '/tmp/go-path',
    });
    expect(resolveUserEnvForNativeProbe('node', 'darwin')).toEqual({
      PATH: '/opt/toolchains/bin', NODE_PATH: '/tmp/node-modules',
    });
    expect(resolveUserEnvForNativeProbe('deno', 'darwin')).toEqual({
      PATH: '/opt/toolchains/bin', DENO_DIR: '/tmp/deno-cache',
    });
    expect(resolveUserEnvForNativeProbe('ruby', 'darwin')).toEqual({
      PATH: '/opt/toolchains/bin', RBENV_VERSION: '3.3.6',
    });
    expect(mocks.trackEvent).not.toHaveBeenCalled();
    expect(resolveUserEnvForRunner()).toEqual(mocks.env);
    expect(mocks.trackEvent).toHaveBeenCalledWith('env.project_scope_used', {
      hasProjectVars: true,
    });
  });
});
