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

function normalizeUrl(value: string | undefined | null): string | null {
  if (!value) {
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
    return normalizeUrl(repository);
  }

  return normalizeUrl(repository.url);
}

function buildDateFromBundle(): string | null {
  return typeof __LINGUA_BUILD_DATE__ === 'string' && __LINGUA_BUILD_DATE__.trim()
    ? __LINGUA_BUILD_DATE__
    : null;
}

function websiteUrlFromBundle(): string | null {
  if (typeof __LINGUA_WEBSITE_URL__ === 'string') {
    return normalizeUrl(__LINGUA_WEBSITE_URL__);
  }

  return normalizeUrl(metadata.homepage);
}

export function getBundledAppInfo(overrides: Partial<AppInfo> = {}): AppInfo {
  const repositoryUrl = repositoryUrlFromPackage(metadata.repository);
  const productName = metadata.productName ?? metadata.name ?? 'Lingua';

  return {
    productName,
    version: metadata.version ?? '0.0.0',
    buildDate: buildDateFromBundle(),
    licenseType: metadata.license ?? 'Unknown',
    repositoryUrl,
    websiteUrl: websiteUrlFromBundle(),
    licenseUrl: repositoryUrl ? `${repositoryUrl.replace(/\/$/, '')}/blob/main/LICENSE` : null,
    ...overrides,
  };
}

export function canOpenExternalUrl(value: string): boolean {
  return normalizeUrl(value) !== null;
}
