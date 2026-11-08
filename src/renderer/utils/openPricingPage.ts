import { useUIStore } from '../stores/uiStore';

/** The public pricing page in the interface language. */
export function pricingUrl(language: string): string {
  return language.startsWith('es') ? 'https://linguacode.dev/es/pricing' : 'https://linguacode.dev/pricing';
}

export async function openPricingPage(language: string): Promise<void> {
  try {
    if (await window.lingua.openExternal(pricingUrl(language))) return;
  } catch {
    // The OS shell can refuse even a fixed trusted URL.
  }
  useUIStore.getState().pushStatusNotice({ tone: 'error', messageKey: 'license.benefits.pricingOpenFailed' });
}
