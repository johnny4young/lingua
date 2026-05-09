import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { PYODIDE_COPY_FILES, RUNTIME_ASSETS } from '../src/shared/runtimeAssets';

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
 * RL-083 Slice 1 — copy Pyodide runtime assets into the renderer
 * build output and serve them from the dev server.
 *
 * Build mode: after Rollup writes the bundle, we copy each file in
 * `PYODIDE_COPY_FILES` from `node_modules/pyodide/` into
 * `<outDir>/pyodide/`. The worker chunk lands in `<outDir>/assets/`
 * so `new URL('../pyodide/...', import.meta.url)` resolves to the
 * copied tree.
 *
 * Dev mode: Vite serves the worker source at
 * `/src/renderer/workers/python-worker.ts`, so the same
 * `../pyodide/` relative URL resolves to `/src/renderer/pyodide/`.
 * A middleware here serves the same files from `node_modules/pyodide/`
 * under that prefix. The middleware is registered as `pre` so Vite's
 * own static-file pipeline does not 404 the request before us.
 */
export function copyRuntimeAssetsPlugin(): Plugin {
  const pyodide = RUNTIME_ASSETS.pyodide;
  const devUrlPrefix = `/src/renderer/${pyodide.servedPath}/`;

  return {
    name: 'lingua:copy-runtime-assets',
    apply: () => true,
    enforce: 'pre',

    configureServer(server: ViteDevServer) {
      // Resolve from the repo cwd rather than Vite's HTML root. The
      // renderer config uses the repo root, while the standalone web
      // config uses `src/web`; both still share the top-level
      // `node_modules/pyodide` install.
      const sourceDir = path.resolve(process.cwd(), pyodide.nodeModulesPath);
      const urlPrefix = devUrlPrefix;

      server.middlewares.use(async (req, res, next) => {
        const resolution = resolveRuntimeAssetRequestPath(
          sourceDir,
          urlPrefix,
          req.url
        );
        if (resolution.status === 'next') {
          return next();
        }
        if (resolution.status === 'bad-request') {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }

        try {
          const fileStat = await stat(resolution.absolutePath);
          if (!fileStat.isFile()) {
            return next();
          }
          // Pyodide ships a few asset types — set the well-known ones
          // and let the rest fall back to octet-stream.
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
        } catch {
          return next();
        }
      });
    },

    async writeBundle(options) {
      // Fail loud if the bundler did not give us an output directory
      // — silently falling back to `<cwd>/dist/pyodide` under Forge
      // means the packaged app finds no Pyodide assets at runtime
      // even though the build looks healthy. (Reviewer flagged this.)
      if (!options.dir) {
        throw new Error(
          '[copy-runtime-assets] writeBundle received no options.dir; refusing to guess an output path.'
        );
      }
      const targetDir = path.join(options.dir, pyodide.servedPath);

      // The package root holds the static asset tree; copy a curated
      // list rather than the whole directory so we never accidentally
      // ship test fixtures or sourcemaps the upstream package may add.
      const sourceDir = path.resolve(pyodide.nodeModulesPath);
      await copyRuntimeAssetFiles(
        sourceDir,
        targetDir,
        PYODIDE_COPY_FILES,
        pyodide.criticalFiles
      );
    },
  };
}
