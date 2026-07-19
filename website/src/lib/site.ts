/**
 * Site-wide constants. Single source of truth for URLs, owner/repo coords,
 * and the tagline used across <head>.
 */

export const SITE = {
  url: 'https://linguacode.dev',
  appUrl: 'https://app.linguacode.dev',
  name: 'Lingua',
  tagline: 'Multi-language code runner for your desktop.',
  description:
    'Lingua runs JavaScript, TypeScript, Python, Go, and Rust in one offline-first desktop app. Monaco editor, Vim mode, 31 built-in dev utilities. Source-available.',
  contactEmail: 'hello@linguacode.dev',
  securityEmail: 'security@linguacode.dev',
  press: {
    contactEmail: 'hello@linguacode.dev',
  },
  social: {
    githubUrl: 'https://github.com/johnny4young/lingua',
  },
} as const;

export const NAV = [
  { href: '/features', key: 'features' },
  { href: '/pricing', key: 'pricing' },
  { href: '/docs/getting-started', key: 'docs' },
  { href: '/releases', key: 'releases' },
  { href: '/changelog', key: 'changelog' },
] as const;

export const FOOTER_NAV = {
  product: [
    { href: '/', key: 'home' },
    { href: '/features', key: 'features' },
    { href: '/compare', key: 'compare' },
    { href: '/pricing', key: 'pricing' },
    { href: '/releases', key: 'releases' },
    { href: '/changelog', key: 'changelog' },
  ],
  resources: [
    { href: '/docs/getting-started', key: 'gettingStarted' },
    { href: 'https://github.com/johnny4young/lingua', key: 'source', external: true },
    { href: SITE.appUrl, key: 'runInBrowser', external: true },
  ],
  legal: [
    { href: '/privacy', key: 'privacy' },
    { href: '/security', key: 'security' },
    { href: '/licensing', key: 'licensing' },
    { href: '/terms', key: 'terms' },
    { href: '/press', key: 'press' },
  ],
} as const;
