import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const probeFiles = [
  'src/main/node-runner.ts',
  'src/main/ruby-runner.ts',
  'src/main/dependencies.ts',
] as const;

describe('main execution probes use asynchronous filesystem APIs', () => {
  it.each(probeFiles)('%s stays off synchronous filesystem calls', async (file) => {
    const source = await readFile(path.join(process.cwd(), file), 'utf-8');

    expect(source).toContain("node:fs/promises");
    expect(source).not.toMatch(/from ['"]node:fs['"]/u);
    expect(source).not.toMatch(/\b(?:accessSync|existsSync|readdirSync|readFileSync)\b/u);
  });
});
