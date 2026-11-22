import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { HttpEnvironmentSelector } from '../../../src/renderer/components/HttpWorkspace/HttpEnvironmentSelector';
import { ENVIRONMENT_TINTS } from '../../../src/renderer/components/HttpWorkspace/httpScopeColors';
import type { HttpEnvironmentV1 } from '../../../src/shared/httpEnvironment';

const env = (id: string, name: string, keys: string[]): HttpEnvironmentV1 => ({
  version: 1,
  id,
  name,
  variables: keys.map((key) => ({ key, value: 'v', secret: false })),
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

const environments = [env('stg', 'staging', ['baseUrl', 'token', 'page']), env('dev', 'dev', ['baseUrl'])];

beforeEach(async () => {
  await initI18n();
});

describe('HttpEnvironmentSelector', () => {
  it('shows the active environment and its variable count on the chip', () => {
    render(<HttpEnvironmentSelector environments={environments} activeEnvironmentId="stg" onSelect={vi.fn()} onManage={vi.fn()} tint={ENVIRONMENT_TINTS.red} />);
    const chip = screen.getByTestId('http-environment-selector');
    expect(chip.textContent).toContain('staging');
    expect(chip.textContent).toContain('3 variables');
    expect(chip.getAttribute('data-environment-id')).toBe('stg');
    expect(chip.getAttribute('aria-label')).toBe('Environment: staging');
  });

  it('names No environment when none is active', () => {
    render(<HttpEnvironmentSelector environments={environments} activeEnvironmentId={null} onSelect={vi.fn()} onManage={vi.fn()} />);
    expect(screen.getByTestId('http-environment-selector').textContent).toContain('No environment');
  });

  it('picks an environment, clears it, and opens the manager from the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onManage = vi.fn();
    render(<HttpEnvironmentSelector environments={environments} activeEnvironmentId="stg" onSelect={onSelect} onManage={onManage} />);
    await user.click(screen.getByTestId('http-environment-selector'));
    expect(screen.getByTestId('http-environment-option-stg').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('http-environment-option-dev').textContent).toContain('1 variable');
    await user.click(screen.getByTestId('http-environment-option-dev'));
    expect(onSelect).toHaveBeenLastCalledWith('dev');
    expect(screen.queryByTestId('http-environment-menu')).toBeNull();

    await user.click(screen.getByTestId('http-environment-selector'));
    await user.click(screen.getByTestId('http-environment-option-none'));
    expect(onSelect).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByTestId('http-environment-selector'));
    await user.click(screen.getByTestId('http-environment-manage'));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('focuses the active environment when the menu opens and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<HttpEnvironmentSelector environments={environments} activeEnvironmentId="stg" onSelect={vi.fn()} onManage={vi.fn()} />);
    await user.click(screen.getByTestId('http-environment-selector'));
    expect(document.activeElement).toBe(screen.getByTestId('http-environment-option-stg'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('http-environment-option-dev'));
  });
});
