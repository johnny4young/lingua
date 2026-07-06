import { en } from '~/i18n/en';
import { es } from '~/i18n/es';
import { SITE } from '~/lib/site';

export const DEFAULT_LOCALE = 'en';
export const LOCALES = [
  { code: 'en', path: '', label: 'English', shortLabel: 'EN', htmlLang: 'en', ogLocale: 'en_US' },
  { code: 'es', path: 'es', label: 'Español', shortLabel: 'ES', htmlLang: 'es', ogLocale: 'es_ES' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

const DICTIONARIES = { en, es } as const;
const LOCALE_CODES = new Set<string>(LOCALES.map((locale) => locale.code));

export function isLocale(value: string | undefined): value is Locale {
  return Boolean(value && LOCALE_CODES.has(value));
}

const PAGE_MODULES = import.meta.glob('../pages/**/*.astro');
const DOC_MODULES = import.meta.glob('../content/docs/*/**/*.md');
const SEO_MODULES = import.meta.glob('../content/seo/*/**/*.md');
const ROUTES_BY_LOCALE = buildRoutesByLocale();

export function t(locale: Locale) {
  return DICTIONARIES[locale];
}

export function getLocaleMeta(locale: Locale) {
  return LOCALES.find((item) => item.code === locale) ?? LOCALES[0];
}

export function getLocaleFromPath(pathname: string): Locale {
  const first = pathname.split('/').filter(Boolean)[0];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

export function stripLocaleFromPath(pathname: string): string {
  const url = pathname.startsWith('http') ? new URL(pathname) : null;
  const path = url ? url.pathname : pathname;
  const segments = path.split('/').filter(Boolean);
  if (isLocale(segments[0])) segments.shift();
  const stripped = `/${segments.join('/')}`;
  return stripped === '/' ? '/' : stripped.replace(/\/$/, '');
}

export function localizePath(locale: Locale, path: string): string {
  if (isExternalPath(path) || path.startsWith('#')) return path;

  const [pathnameWithQuery, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathnameWithQuery.split('?');
  const stripped = stripLocaleFromPath(pathname || '/');
  const localized =
    locale === DEFAULT_LOCALE ? stripped : `/es${stripped === '/' ? '' : stripped}`;
  const normalized = localized === '' ? '/' : localized;
  return `${normalized}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

export function switchLocalePath(currentPath: string, targetLocale: Locale): string {
  const stripped = stripLocaleFromPath(currentPath);
  return localizePath(targetLocale, hasLocalizedRoute(targetLocale, stripped) ? stripped : '/');
}

export function absoluteUrl(path: string): string {
  return new URL(path, SITE.url).toString();
}

export function canonicalUrl(locale: Locale, currentPath: string): string {
  return absoluteUrl(localizePath(locale, stripLocaleFromPath(currentPath)));
}

export function alternateUrls(currentPath: string) {
  const stripped = stripLocaleFromPath(currentPath);
  return [
    ...LOCALES.map((locale) => ({
      locale: locale.code,
      hreflang: locale.code,
      href: absoluteUrl(localizePath(locale.code, stripped)),
    })),
    {
      locale: DEFAULT_LOCALE,
      hreflang: 'x-default',
      href: absoluteUrl(localizePath(DEFAULT_LOCALE, stripped)),
    },
  ] as const;
}

export function isExternalPath(path: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) || /^(?:mailto|tel|lingua):/i.test(path);
}

export function hasLocalizedRoute(locale: Locale, path: string): boolean {
  return ROUTES_BY_LOCALE[locale].has(stripLocaleFromPath(path));
}

function buildRoutesByLocale(): Record<Locale, Set<string>> {
  const routes = Object.fromEntries(
    LOCALES.map((locale) => [locale.code, new Set<string>(['/'])]),
  ) as Record<Locale, Set<string>>;

  for (const key of Object.keys(PAGE_MODULES)) {
    const route = routeFromPageModule(key);
    if (route) routes[route.locale].add(route.path);
  }

  for (const key of Object.keys(DOC_MODULES)) {
    const route = routeFromContentModule(key, 'docs');
    if (route) routes[route.locale].add(route.path);
  }

  for (const key of Object.keys(SEO_MODULES)) {
    const route = routeFromContentModule(key, 'seo');
    if (route) routes[route.locale].add(route.path);
  }

  return routes;
}

function routeFromPageModule(key: string): { locale: Locale; path: string } | null {
  if (key.includes('/[')) return null;

  const relative = key.replace('../pages/', '').replace(/\.astro$/, '');
  const parts = relative.split('/').filter(Boolean);
  const first = parts[0];
  const locale = isLocale(first) ? first : DEFAULT_LOCALE;
  const routeParts = isLocale(first) ? parts.slice(1) : parts;
  const normalized = routeParts[routeParts.length - 1] === 'index'
    ? routeParts.slice(0, -1)
    : routeParts;
  const path = normalized.length === 0 ? '/' : `/${normalized.join('/')}`;

  return { locale, path };
}

function routeFromContentModule(
  key: string,
  collection: 'docs' | 'seo',
): { locale: Locale; path: string } | null {
  const match = key.match(new RegExp(`\\.\\./content/${collection}/([^/]+)/(.+)\\.md$`));
  if (!match) return null;

  const [, localeValue, slugValue] = match;
  if (!isLocale(localeValue) || !slugValue) return null;

  const slug = slugValue.replace(/\/index$/, '');
  const path = collection === 'docs' ? `/docs/${slug}` : `/${slug}`;
  return { locale: localeValue, path };
}
