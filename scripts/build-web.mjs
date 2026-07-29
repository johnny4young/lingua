#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProductionReactBundle,
  forceProductionNodeEnv,
} from './lib/productionBuild.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

forceProductionNodeEnv();

const { build } = await import('vite');

await build({
  configFile: path.join(repoRoot, 'vite.web.config.mts'),
});
await assertProductionReactBundle(path.join(repoRoot, 'dist/web/assets'));
