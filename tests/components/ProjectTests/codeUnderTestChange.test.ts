import { describe, expect, it, vi } from 'vitest';
import {
  findCodeUnderTestChange,
  firstHunk,
  relativeImports,
  type CodeChangeSources,
} from '../../../src/renderer/components/ProjectTests/codeUnderTestChange';

const FILES: Record<string, { head: string; now: string }> = {
  'src/cart.test.ts': { head: '', now: '' },
  'src/cart.ts': { head: "export { shipping } from './shipping.js';\n", now: "export { shipping } from './shipping.js';\n" },
  'src/shipping.ts': { head: 'a\nreturn total > 40 ? 0 : 4.9;\nc\n', now: 'a\nreturn total >= 50 ? 0 : 4.9;\nc\n' },
  'src/coupons/index.ts': { head: 'x\n', now: 'y\n' },
  'src/new.ts': { head: '', now: 'fresh\n' },
  'src/helper.test.ts': { head: '1\n', now: '2\n' },
  'src/crlf.ts': { head: 'a\nb\n', now: 'a\r\nb\r\n' },
};

function sources(): CodeChangeSources & { diff: ReturnType<typeof vi.fn> } {
  return {
    listDirectory: async directory => {
      const prefix = directory ? `${directory}/` : '';
      const names = new Map<string, boolean>();
      for (const file of Object.keys(FILES)) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...rest] = file.slice(prefix.length).split('/');
        names.set(name!, rest.length > 0);
      }
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    diff: vi.fn(async (file: string) => {
      const found = FILES[file];
      return found ? { original: found.head, modified: found.now } : null;
    }),
  };
}

describe('relativeImports', () => {
  it('reads imports, re-exports, dynamic imports and requires once each', () => {
    const source = [
      "import { a } from './a';",
      "export * from '../b';",
      "const c = await import('./c');",
      "const d = require('./d');",
      "import './e';",
      "import { a as again } from './a';",
      "import vitest from 'vitest';",
    ].join('\n');
    expect(relativeImports(source)).toEqual(['./a', '../b', './c', './d', './e']);
  });
});

describe('firstHunk', () => {
  it('places the first changed block on the working copy and caps its lines', () => {
    expect(firstHunk('a\nb\nc', 'a\nB\nc')).toEqual({ line: 2, removed: ['b'], added: ['B'], more: 0 });
    expect(firstHunk('a', 'a\n1\n2\n3\n4\n5')).toEqual({ line: 2, removed: [], added: ['1', '2', '3'], more: 2 });
    expect(firstHunk('same', 'same')).toBeNull();
  });
});

describe('findCodeUnderTestChange', () => {
  it('follows the import graph two levels down and prefers the module the failing line calls', async () => {
    const found = await findCodeUnderTestChange(
      { testFile: 'src/cart.test.ts', testSource: "import { shipping } from './cart';\nimport './coupons';", failingLine: 'expect(shipping(41.4)).toBe(0);' },
      sources()
    );
    expect(found).toEqual({ file: 'src/shipping.ts', line: 2, removed: ['return total > 40 ? 0 : 4.9;'], added: ['return total >= 50 ? 0 : 4.9;'], more: 0 });
  });

  it('falls back to the first changed import and resolves a directory index', async () => {
    const found = await findCodeUnderTestChange(
      { testFile: 'src/cart.test.ts', testSource: "import { coupon } from './coupons';", failingLine: 'expect(coupon()).toBe(1);' },
      sources()
    );
    expect(found?.file).toBe('src/coupons/index.ts');
  });

  it('leaves out untracked files, test files and imports outside the project', async () => {
    const lookup = sources();
    const found = await findCodeUnderTestChange(
      { testFile: 'src/cart.test.ts', testSource: "import './new';\nimport './helper.test';\nimport '../../outside';", failingLine: '' },
      lookup
    );
    expect(found).toBeNull();
    expect(lookup.diff).not.toHaveBeenCalledWith(expect.stringContaining('outside'));
  });

  it('does not count a CRLF checkout of an LF file as a change', async () => {
    const found = await findCodeUnderTestChange({ testFile: 'src/cart.test.ts', testSource: "import './crlf';", failingLine: '' }, sources());
    expect(found).toBeNull();
  });

  it('does nothing for files that are not JavaScript or TypeScript', async () => {
    const lookup = sources();
    expect(await findCodeUnderTestChange({ testFile: 'test_cart.py', testSource: 'from cart import x', failingLine: '' }, lookup)).toBeNull();
    expect(lookup.diff).not.toHaveBeenCalled();
  });
});
