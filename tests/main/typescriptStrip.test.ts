import { afterAll, describe, expect, it } from 'vitest';
import { TypeScriptStripper } from '../../src/main/ipc/typescriptStrip';

// swc backtracks for minutes on this valid TypeScript.
const BACKTRACKING = `x = ${'a ? (b): c => '.repeat(26)}d;`;

describe('TypeScriptStripper', () => {
  const stripper = new TypeScriptStripper(5_000);
  afterAll(() => stripper.dispose());

  it('erases types and keeps every line and column', async () => {
    const code = [
      'import type { User } from "./user";',
      'interface Point { x: number }',
      'const total: number = [1, 2].reduce((a: number, b) => a + b, 0) satisfies number;',
      'function id<T>(value: T): T { return value; }',
      'console.log(id(total as number), await Promise.resolve(1));',
    ].join('\n');
    const js = await stripper.strip(code);
    expect(js).not.toBeNull();
    expect(js!.split('\n').map(line => line.length)).toEqual(code.split('\n').map(line => line.length));
    expect(js).toContain('const total         = [1, 2]');
    expect(js).not.toContain('interface');
  });

  it.each([
    ['enum', 'enum Color { Red }'],
    ['namespace', 'namespace N { export const a = 1; }'],
    ['parameter property', 'class A { constructor(private x: number) {} }'],
    ['import equals', 'import fs = require("fs");'],
    ['angle-bracket cast', 'const x = <any>1;'],
    ['JSX', 'const node = <div />;'],
    ['decorator', 'function dec(value: unknown) {}\n@dec class A {}'],
    ['accessor', 'class A { accessor x = 1; }'],
    ['static import', 'import { a } from "./a";'],
    ['syntax error', 'const = ;'],
  ])('leaves %s to esbuild', async (_label, code) => {
    expect(await stripper.strip(code)).toBeNull();
  });

  it('refuses what it cannot vouch for', async () => {
    expect(await stripper.strip(42)).toBeNull();
    expect(await stripper.strip(undefined)).toBeNull();
    expect(await stripper.strip('let a = 1;'.padEnd(200_001, ' '))).toBeNull();
    expect(await stripper.strip('')).toBe('');
  });

  it('replaces swc after a stack overflow, every time', async () => {
    const deep = `const x = ${'('.repeat(3_000)}1${')'.repeat(3_000)};`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await stripper.strip(deep)).toBeNull();
      expect(await stripper.strip('let y: string = "a";')).toBe('let y         = "a";');
    }
  });
});

describe('TypeScriptStripper timeouts', () => {
  it('gives up on runaway input and serves the next request from a fresh thread', async () => {
    const stripper = new TypeScriptStripper(400);
    try {
      const started = Date.now();
      expect(await stripper.strip(BACKTRACKING)).toBeNull();
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(await stripper.strip('let y: string = "a";')).toBe('let y         = "a";');
    } finally {
      stripper.dispose();
    }
  });

  it('keeps only the newest waiting request', async () => {
    const stripper = new TypeScriptStripper(400);
    try {
      const stuck = stripper.strip(BACKTRACKING);
      const older = stripper.strip('let a: number = 1;');
      const newer = stripper.strip('let b: number = 2;');
      expect(await older).toBeNull();
      expect(await stuck).toBeNull();
      expect(await newer).toBe('let b         = 2;');
    } finally {
      stripper.dispose();
    }
  });
});
