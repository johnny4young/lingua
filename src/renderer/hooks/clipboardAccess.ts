import { isEntitled } from '../../shared/entitlements';

/** The gate on every read that happens without a click: Pro and the Settings opt-in. */
export function clipboardAutomationAllowed(tier: Parameters<typeof isEntitled>[0], consent: string): boolean {
  return consent === 'granted' && isEntitled(tier, 'DEV_UTILITIES');
}

/**
 * False where a read could prompt unasked: Firefox and Safari cannot report this
 * permission, and a read on window focus should never be the one that asks.
 */
export async function clipboardReadAllowed(mayPrompt: boolean): Promise<boolean> {
  try {
    const { state } = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
    return state === 'granted' || (mayPrompt && state === 'prompt');
  } catch {
    return false;
  }
}
