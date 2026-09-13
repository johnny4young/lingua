/**
 * Ambient module declaration for the Vite `?raw` imports in the test
 * suite (`../wrangler.toml?raw` in `test/cors.test.ts`, the migration
 * SQL files in `test/licenses.test.ts`).
 *
 * vitest resolves them at runtime through its own Vite dependency and
 * hands back the file contents as a string. `vite` itself is not a
 * declared dependency of this project, so `vite/client` types only
 * resolved by walking up to the repo root `node_modules`; declaring the
 * one query the tests use keeps `pnpm run typecheck` working from a
 * standalone license-server install.
 *
 * Test-only. Worker source cannot use `?raw` because wrangler / esbuild
 * do not parse Vite query suffixes (see `src/emails/templates.d.ts`).
 */

declare module '*?raw' {
  const value: string;
  export default value;
}
