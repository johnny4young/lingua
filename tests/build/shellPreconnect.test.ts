// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const preconnects = async (entry: string): Promise<string[]> =>
  (await readFile(path.join(root, entry), 'utf8')).match(/<link[^>]*rel="preconnect"[^>]*>/g) ?? [];

describe('shell preconnect hints', () => {
  it('opens no connection at desktop startup, where license and update checks run in main', async () => {
    expect(await preconnects('index.html')).toEqual([]);
  });

  it('keeps both first-party hints on the web shell, which calls them from the page', async () => {
    const links = await preconnects('src/web/index.html');
    expect(links.some(link => link.includes('https://licenses.linguacode.dev'))).toBe(true);
    expect(links.some(link => link.includes('https://updates.linguacode.dev'))).toBe(true);
  });
});
