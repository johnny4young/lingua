/**
 * Ambient module declarations so TypeScript accepts the
 * `import trialTemplate from '../emails/trial.html'` (etc.) calls
 * in `src/lib/resend.ts` and `test/emails/templates.test.ts`.
 *
 * The actual loading happens at runtime:
 *   - wrangler / esbuild → `[[rules]] type = "Text"` in wrangler.toml.
 *   - vitest / vite      → `loadHtmlAndCssAsText` plugin in
 *                           vitest.config.ts.
 *
 * Both sides return the raw file contents as a string. The Vite-only
 * `?raw` suffix is intentionally NOT used because esbuild does not
 * parse Vite query suffixes.
 */

declare module '*.html' {
  const value: string;
  export default value;
}

declare module '*.css' {
  const value: string;
  export default value;
}
