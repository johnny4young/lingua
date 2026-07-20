import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { RUNTIME_ASSETS, type RuntimeAssetId } from '../src/shared/runtimeAssets';

type CopyRuntimeAssetsPluginOptions = {
  readonly exclude?: readonly RuntimeAssetId[];
};

type RuntimeAssetRequestResolution =
  | { status: 'next' }
  | { status: 'bad-request' }
  | { status: 'serve'; absolutePath: string };

export function resolveRuntimeAssetRequestPath(
  sourceDir: string,
  urlPrefix: string,
  requestUrl: string | undefined
): RuntimeAssetRequestResolution {
  if (!requestUrl || !requestUrl.startsWith(urlPrefix)) {
    return { status: 'next' };
  }

  const cleanUrl = requestUrl.split('?')[0] ?? '';
  let relative: string;
  try {
    relative = decodeURIComponent(cleanUrl.slice(urlPrefix.length));
  } catch {
    return { status: 'bad-request' };
  }

  const segments = relative.split('/');
  if (
    relative.length === 0 ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    /^[A-Za-z]:/u.test(relative) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return { status: 'bad-request' };
  }

  const root = path.resolve(sourceDir);
  const absolutePath = path.resolve(root, ...segments);
  const relativeFromRoot = path.relative(root, absolutePath);
  if (
    relativeFromRoot === '' ||
    relativeFromRoot.startsWith('..') ||
    path.isAbsolute(relativeFromRoot)
  ) {
    return { status: 'bad-request' };
  }

  return { status: 'serve', absolutePath };
}

export async function copyRuntimeAssetFiles(
  sourceDir: string,
  targetDir: string,
  files: readonly string[],
  criticalFiles: readonly string[]
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const critical = new Set(criticalFiles);

  for (const file of files) {
    try {
      await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
    } catch (err) {
      if (critical.has(file)) {
        throw new Error(
          `[copy-runtime-assets] failed to copy critical runtime asset ${file}`,
          { cause: err }
        );
      }

      // Missing optional files (e.g. .d.ts in a leaner upstream
      // build) should warn but not fail the build.
      console.warn(`[copy-runtime-assets] skipped ${file}:`, err);
    }
  }
}

/**
 * implementation (extended in implementation) — copy runtime assets
 * into the renderer build output and serve them from the dev server.
 *
 * The plugin walks every entry in `RUNTIME_ASSETS` (Pyodide and Ruby
 * today) and:
 *
 * Build mode: after Rollup writes the bundle, copies each file in the
 * entry's `copyFiles` list (or `criticalFiles` when omitted) from
 * `node_modules/<entry.nodeModulesPath>` into
 * `<outDir>/<entry.servedPath>/`. The worker chunk lands in
 * `<outDir>/assets/` so `new URL('../<servedPath>/...', import.meta.url)`
 * resolves to the copied tree.
 *
 * Dev mode: Vite serves the worker source at
 * `/src/renderer/workers/...`, so the same `../<servedPath>/` relative
 * URL resolves to `/src/renderer/<servedPath>/`. A middleware here
 * serves the files from `node_modules/<nodeModulesPath>/` under that
 * prefix. Registered as `pre` so Vite's static-file pipeline does not
 * 404 the request before we do.
 */
export function selectRuntimeAssetEntries(
  excluded: readonly RuntimeAssetId[] = []
): Array<(typeof RUNTIME_ASSETS)[RuntimeAssetId]> {
  const excludedSet = new Set<RuntimeAssetId>(excluded);
  return Object.entries(RUNTIME_ASSETS)
    .filter(([id]) => !excludedSet.has(id as RuntimeAssetId))
    .map(([, asset]) => asset);
}

export function copyRuntimeAssetsPlugin(
  options: CopyRuntimeAssetsPluginOptions = {}
): Plugin {
  const assetEntries = selectRuntimeAssetEntries(options.exclude);

  return {
    name: 'lingua:copy-runtime-assets',
    apply: () => true,
    enforce: 'pre',

    configureServer(server: ViteDevServer) {
      // Resolve from the repo cwd rather than Vite's HTML root. The
      // renderer config uses the repo root, while the standalone web
      // config uses `src/web`; both still share the top-level
      // `node_modules/` install.
      const middlewareConfigs = assetEntries.map((asset) => ({
        sourceDir: path.resolve(process.cwd(), asset.nodeModulesPath),
        urlPrefix: `/src/renderer/${asset.servedPath}/`,
      }));

      server.middlewares.use(async (req, res, next) => {
        for (const { sourceDir, urlPrefix } of middlewareConfigs) {
          const resolution = resolveRuntimeAssetRequestPath(
            sourceDir,
            urlPrefix,
            req.url
          );
          if (resolution.status === 'next') continue;
          if (resolution.status === 'bad-request') {
            res.statusCode = 400;
            res.end('bad request');
            return;
          }

          try {
            const fileStat = await stat(resolution.absolutePath);
            if (!fileStat.isFile()) {
              // Try the remaining asset entries — a stat-but-not-a-file
              // hit here does not necessarily mean the request was for
              // this asset's tree. Without `continue`, requests for a
              // later asset could be silently 404'd when an earlier
              // asset's source dir contains a directory entry with the
              // matching relative name.
              continue;
            }
            // Pyodide + Ruby ship a few asset types — set the well-known
            // ones and let the rest fall back to octet-stream.
            const ext = path.extname(resolution.absolutePath).toLowerCase();
            if (ext === '.mjs' || ext === '.js') {
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            } else if (ext === '.wasm') {
              res.setHeader('Content-Type', 'application/wasm');
            } else if (ext === '.json') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
            } else if (ext === '.zip') {
              res.setHeader('Content-Type', 'application/zip');
            } else if (ext === '.ts') {
              res.setHeader('Content-Type', 'application/typescript; charset=utf-8');
            } else {
              res.setHeader('Content-Type', 'application/octet-stream');
            }
            const { createReadStream } = await import('node:fs');
            createReadStream(resolution.absolutePath).pipe(res);
            return;
          } catch {
            // Same rationale as the !isFile branch above — fall through
            // to the next asset entry rather than short-circuiting the
            // whole middleware.
            continue;
          }
        }
        return next();
      });
    },

    async writeBundle(options) {
      // Fail loud if the bundler did not give us an output directory
      // — silently falling back to `<cwd>/dist/...` under Forge means
      // the packaged app finds no runtime assets at runtime even
      // though the build looks healthy. (Reviewer flagged this on the
      // Pyodide path; same rationale applies to Ruby.)
      if (!options.dir) {
        throw new Error(
          '[copy-runtime-assets] writeBundle received no options.dir; refusing to guess an output path.'
        );
      }

      for (const asset of assetEntries) {
        const targetDir = path.join(options.dir, asset.servedPath);
        // The package root holds the static asset tree; copy a curated
        // list rather than the whole directory so we never accidentally
        // ship test fixtures or sourcemaps the upstream package may add.
        const sourceDir = path.resolve(asset.nodeModulesPath);
        const files = asset.copyFiles ?? asset.criticalFiles;
        await copyRuntimeAssetFiles(
          sourceDir,
          targetDir,
          files,
          asset.criticalFiles
        );
      }
    },
  };
}
