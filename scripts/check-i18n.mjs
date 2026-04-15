import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_LOCALES_ROOT = path.resolve('src/renderer/i18n/locales');
const SOURCE_LANGUAGE = 'en';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flattenMessages(value, prefix = '', acc = new Map()) {
  if (!isPlainObject(value)) {
    throw new Error(
      prefix
        ? `Expected "${prefix}" to be an object tree with string leaves.`
        : 'Expected locale root to be an object.'
    );
  }

  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      acc.set(nextKey, child);
      continue;
    }

    if (isPlainObject(child)) {
      flattenMessages(child, nextKey, acc);
      continue;
    }

    throw new Error(
      `Expected "${nextKey}" to resolve to a string or nested object, received ${Array.isArray(child) ? 'array' : typeof child}.`
    );
  }

  return acc;
}

async function readLocaleJson(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${filePath}: ${detail}`);
  }
}

async function collectLocaleTree(localesRoot = DEFAULT_LOCALES_ROOT) {
  const localeEntries = await readdir(localesRoot, { withFileTypes: true });
  const localeTree = new Map();

  for (const entry of localeEntries) {
    if (!entry.isDirectory()) continue;

    const localeDir = path.join(localesRoot, entry.name);
    const namespaceEntries = await readdir(localeDir, { withFileTypes: true });
    const namespaces = new Map();

    for (const namespaceEntry of namespaceEntries) {
      if (!namespaceEntry.isFile() || !namespaceEntry.name.endsWith('.json')) continue;

      const namespace = namespaceEntry.name.replace(/\.json$/u, '');
      const filePath = path.join(localeDir, namespaceEntry.name);
      const raw = await readLocaleJson(filePath);
      const flattened = flattenMessages(raw);
      namespaces.set(namespace, { filePath, raw, flattened });
    }

    localeTree.set(entry.name, namespaces);
  }

  return localeTree;
}

export async function validateLocaleTree(localesRoot = DEFAULT_LOCALES_ROOT) {
  const localeTree = await collectLocaleTree(localesRoot);
  const sourceNamespaces = localeTree.get(SOURCE_LANGUAGE);

  if (!sourceNamespaces || sourceNamespaces.size === 0) {
    throw new Error(`Missing source locale "${SOURCE_LANGUAGE}" under ${localesRoot}.`);
  }

  const issues = [];

  for (const [language, namespaces] of localeTree.entries()) {
    if (language === SOURCE_LANGUAGE) continue;

    for (const sourceNamespace of sourceNamespaces.keys()) {
      if (!namespaces.has(sourceNamespace)) {
        issues.push(`${language}: missing namespace "${sourceNamespace}.json"`);
      }
    }

    for (const namespace of namespaces.keys()) {
      if (!sourceNamespaces.has(namespace)) {
        issues.push(`${language}: orphan namespace "${namespace}.json"`);
      }
    }

    for (const [namespace, sourceData] of sourceNamespaces.entries()) {
      const targetData = namespaces.get(namespace);
      if (!targetData) continue;

      for (const key of sourceData.flattened.keys()) {
        if (!targetData.flattened.has(key)) {
          issues.push(`${language}/${namespace}: missing key "${key}"`);
        }
      }

      for (const key of targetData.flattened.keys()) {
        if (!sourceData.flattened.has(key)) {
          issues.push(`${language}/${namespace}: orphan key "${key}"`);
        }
      }
    }
  }

  return {
    localesRoot,
    languages: [...localeTree.keys()].sort(),
    issues,
  };
}

async function main() {
  try {
    const result = await validateLocaleTree(process.argv[2] ?? DEFAULT_LOCALES_ROOT);

    if (result.issues.length > 0) {
      console.error('i18n locale check failed:');
      for (const issue of result.issues) {
        console.error(`- ${issue}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `i18n locale check passed for ${result.languages.length} languages in ${result.localesRoot}.`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`i18n locale check failed: ${detail}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}

export { DEFAULT_LOCALES_ROOT, SOURCE_LANGUAGE, flattenMessages };
