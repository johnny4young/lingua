import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  passive: vi.fn(() => ({ RBENV_VERSION: '3.3.6' })),
  explicit: vi.fn(() => ({ API_TOKEN: 'private-project-secret' })),
}));

vi.mock('../../../src/renderer/runners/env', () => ({
  resolveUserEnvForNativeProbe: env.passive,
  resolveUserEnvForRunner: env.explicit,
}));

import { RubyRuntimeRow } from '../../../src/renderer/components/Settings/RubyRuntimeRow';

describe('RubyRuntimeRow', () => {
  afterEach(() => {
    delete (window as Window & { lingua?: unknown }).lingua;
    vi.clearAllMocks();
  });

  it('uses a filtered passive environment when the Settings row mounts', async () => {
    const detect = vi.fn().mockResolvedValue({ installed: true, version: 'ruby 3.3.6' });
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'darwin', ruby: { detect } },
      configurable: true,
      writable: true,
    });
    render(<RubyRuntimeRow />);
    await waitFor(() => expect(detect).toHaveBeenCalledWith({ RBENV_VERSION: '3.3.6' }));
    expect(env.passive).toHaveBeenCalledWith('ruby', 'darwin');
    expect(env.explicit).not.toHaveBeenCalled();
  });

  it('does not describe a failed version check as a missing Ruby binary', async () => {
    const detect = vi.fn().mockResolvedValue({ installed: false, reason: 'check-failed' });
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'darwin', ruby: { detect } },
      configurable: true,
      writable: true,
    });
    render(<RubyRuntimeRow />);
    await waitFor(() => expect(screen.getByTestId('settings-ruby-runtime-status').textContent)
      .toContain('Could not check system Ruby'));
    expect(screen.getByTestId('settings-ruby-runtime-status').textContent)
      .not.toContain('not detected');
  });
});
