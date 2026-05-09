import packageJson from '../../package.json';

type PackageRepository = string | { url?: string };

interface PackageJsonMetadata {
  name?: string;
  productName?: string;
  version?: string;
  license?: string;
  repository?: PackageRepository;
  homepage?: string;
}

export interface AppInfo {
  productName: string;
  version: string;
  buildDate: string | null;
  licenseType: string;
  repositoryUrl: string | null;
  websiteUrl: string | null;
  licenseUrl: string | null;
}

const metadata = packageJson as PackageJsonMetadata;

/**
 * Turn the raw package.json `license` value into something suitable for the
 * About surface. SPDX expressions like `SEE LICENSE IN LICENSE` (the shape
 * npm recommends for non-OSS commercial licenses — see RL-062) read as
 * noise to an end user, so we map them to a friendly `Commercial` label.
 * Real SPDX ids pass through unchanged.
 */
export function resolveLicenseType(license: string | undefined): string {
  if (!license) return 'Unknown';
  const trimmed = license.trim();
  if (trimmed.length === 0) return 'Unknown';
  if (/^see\s+license/iu.test(trimmed)) return 'Commercial';
  if (trimmed.toUpperCase() === 'UNLICENSED') return 'Commercial';
  return trimmed;
}

export function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function repositoryUrlFromPackage(repository: PackageRepository | undefined): string | null {
  if (!repository) {
    return null;
  }

  if (typeof repository === 'string') {
    return normalizeExternalUrl(repository);
  }

  return normalizeExternalUrl(repository.url);
}

function buildDateFromBundle(): string | null {
  return typeof __LINGUA_BUILD_DATE__ === 'string' && __LINGUA_BUILD_DATE__.trim()
    ? __LINGUA_BUILD_DATE__
    : null;
}

function websiteUrlFromBundle(): string | null {
  if (typeof __LINGUA_WEBSITE_URL__ === 'string') {
    return normalizeExternalUrl(__LINGUA_WEBSITE_URL__);
  }

  return normalizeExternalUrl(metadata.homepage);
}

export function getBundledAppInfo(overrides: Partial<AppInfo> = {}): AppInfo {
  const repositoryUrl = repositoryUrlFromPackage(metadata.repository);
  const productName = metadata.productName ?? metadata.name ?? 'Lingua';

  return {
    productName,
    version: metadata.version ?? '0.0.0',
    buildDate: buildDateFromBundle(),
    licenseType: resolveLicenseType(metadata.license),
    repositoryUrl,
    websiteUrl: websiteUrlFromBundle(),
    licenseUrl: repositoryUrl ? `${repositoryUrl.replace(/\/$/, '')}/blob/main/LICENSE` : null,
    ...overrides,
  };
}

export function canOpenExternalUrl(value: unknown): boolean {
  return normalizeExternalUrl(value) !== null;
}
