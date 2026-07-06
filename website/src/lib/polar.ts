/**
 * Polar.sh checkout URL validation.
 *
 * This module is intentionally env-var-free. The marketing site reads
 * `PUBLIC_POLAR_CHECKOUT_*` at the consumption site (the .astro frontmatter
 * that renders the pricing buttons), using Astro/Vite `import.meta.env` and
 * Node `process.env` as build-time sources. Keeping env-var reading out of
 * shared library code avoids the SSR-sandbox hydration quirks we hit when
 * accessing `import.meta.env` dynamically.
 *
 * `validateCheckoutUrl` is the only public surface: pass in whatever the
 * caller pulled from env (or null) and get back a sanitised https URL or
 * null. The pricing component renders a disabled tooltip-bearing button
 * when null — never a broken <a href>.
 */

export type PaidTier = 'pro' | 'pro_lifetime' | 'team';

export function validateCheckoutUrl(value: string | undefined | null): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
