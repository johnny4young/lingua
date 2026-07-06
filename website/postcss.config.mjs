// website/ styles Tailwind through @tailwindcss/vite (the Vite plugin), NOT
// PostCSS. This empty config stops PostCSS from walking up the directory tree
// into the lingua repo root's postcss.config.mjs, which loads
// @tailwindcss/postcss — a dependency this standalone package deliberately
// does not install. Without this, `astro build` fails in CI (where only
// website/'s own deps are installed) with "Cannot find module
// '@tailwindcss/postcss'".
export default {};
