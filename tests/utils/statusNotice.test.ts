import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '@/stores/uiStore';
import {
  pushErrorNotice,
  pushInfoNotice,
  pushSuccessNotice,
  pushWarningNotice,
} from '@/utils/statusNotice';

describe('statusNotice helpers', () => {
  beforeEach(() => {
    useUIStore.setState({ statusNotice: null });
  });

  it.each([
    ['info', pushInfoNotice],
    ['success', pushSuccessNotice],
    ['warning', pushWarningNotice],
    ['error', pushErrorNotice],
  ] as const)('enforces the %s tone', (tone, push) => {
    push(`notice.${tone}`, {
      ...({ tone: 'spoofed', messageKey: 'notice.spoofed' } as unknown as Record<string, never>),
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone,
      messageKey: `notice.${tone}`,
    });
  });

  it('forwards the complete notice option surface unchanged', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const onSurvived = vi.fn();
    const actions = [{ labelKey: 'notice.action', onClick }];

    pushSuccessNotice('notice.complete', {
      values: { count: 2 },
      detail: 'detail',
      actions,
      priority: 'high',
      onDismiss,
      onSurvived,
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'notice.complete',
      values: { count: 2 },
      detail: 'detail',
      actions,
      priority: 'high',
      onDismiss,
      onSurvived,
    });
  });
});
