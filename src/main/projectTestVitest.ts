/** Main-owned child entrypoint: Vitest CLI file filters are substring matches. */
export const scopedVitestRunner = `
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [entry, selected, report, pattern] = process.argv.slice(2);
const api = createRequire(pathToFileURL(entry)).resolve('vitest/node');
const { createVitest } = await import(pathToFileURL(api).href);
process.env.TEST = 'true';
process.env.VITEST = 'true';
process.env.NODE_ENV ??= 'test';
const ctx = await createVitest('test', {
  run: true, watch: false, color: false,
  reporters: ['default', 'json'], outputFile: { json: report },
  ...(pattern ? { testNamePattern: pattern } : {}),
});
try {
  // init is the pre-4.1 name; both initialize reporters without executing tests.
  await (ctx.standalone ? ctx.standalone() : ctx.init());
  const key = file => {
    const normalized = path.resolve(file);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const specs = (await ctx.globTestSpecifications([selected]))
    .filter(spec => key(spec.moduleId) === key(selected));
  if (!specs.length) throw new Error('The selected file is not a configured Vitest test file.');
  await ctx.runTestSpecifications(specs);
} finally {
  await ctx.close();
}
`;
