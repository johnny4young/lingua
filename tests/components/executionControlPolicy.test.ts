import { describe, expect, it } from 'vitest';
import {
  executionDisabledTooltipKey,
  resolveExecutionControlPolicy,
} from '@/components/Toolbar/executionControlPolicy';

function resolve(
  overrides: Partial<Parameters<typeof resolveExecutionControlPolicy>[0]> = {},
) {
  return resolveExecutionControlPolicy({
    language: 'javascript',
    effectiveTier: 'pro',
    isWebBuild: true,
    isNotebookTab: false,
    enabledBreakpointCount: 0,
    ...overrides,
  });
}

describe('executionControlPolicy', () => {
  it('requires an enabled breakpoint for Debug without blocking Run or Scratchpad', () => {
    const policy = resolve();

    expect(policy.actions.run).toEqual({ disabled: false, reason: null });
    expect(policy.actions.debug).toEqual({
      disabled: true,
      reason: 'no-enabled-breakpoint',
    });
    expect(policy.actions.scratchpad).toEqual({ disabled: false, reason: null });
    expect(
      executionDisabledTooltipKey('debug', policy.actions.debug.reason),
    ).toBe('toolbar.debug.noBreakpoint');
  });

  it('enables Debug when the active tab has an enabled breakpoint', () => {
    const policy = resolve({ enabledBreakpointCount: 1 });

    expect(policy.actions.debug).toEqual({ disabled: false, reason: null });
  });

  it('uses the workflow capability matrix for Debug and Scratchpad', () => {
    const python = resolve({ language: 'python' });
    const ruby = resolve({ language: 'ruby' });

    expect(python.actions.debug.reason).toBe('unsupported-workflow');
    expect(python.actions.scratchpad.disabled).toBe(false);
    expect(ruby.actions.debug.reason).toBe('unsupported-workflow');
    expect(ruby.actions.scratchpad.reason).toBe('unsupported-workflow');
    expect(
      executionDisabledTooltipKey(
        'scratchpad',
        ruby.actions.scratchpad.reason,
      ),
    ).toBe('workflowMode.unsupportedReason.scratchpad');
  });

  it('gives the license gate precedence over the desktop gate', () => {
    const freeWeb = resolve({
      language: 'go',
      effectiveTier: 'free',
    });
    const proWeb = resolve({ language: 'go' });

    expect(freeWeb.proLanguageGate).toBe(true);
    expect(freeWeb.desktopOnlyGate).toBe(false);
    expect(freeWeb.actions.run.reason).toBe('pro-only');
    expect(proWeb.proLanguageGate).toBe(false);
    expect(proWeb.desktopOnlyGate).toBe(true);
    expect(proWeb.actions.run.reason).toBe('desktop-only');
  });

  it('routes notebooks to their cell controls and blocks view-only tabs', () => {
    const notebook = resolve({ isNotebookTab: true });
    const viewOnly = resolve({ language: 'plaintext' });

    expect(notebook.actions.run.reason).toBe('notebook');
    expect(notebook.actions.debug.reason).toBe('notebook');
    expect(notebook.actions.scratchpad.reason).toBe('notebook');
    expect(
      executionDisabledTooltipKey('run', notebook.actions.run.reason),
    ).toBe('notebook.notice.useNotebookToolbar');
    expect(viewOnly.actions.run.reason).toBe('view-only');
  });
});
