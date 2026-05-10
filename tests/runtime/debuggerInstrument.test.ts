import { describe, expect, it } from 'vitest';
import { instrumentForDebugger } from '@/runtime/debuggerInstrument';

describe('instrumentForDebugger (RL-027 Slice 1)', () => {
  it('injects __lingua_dbg_yield before each top-level statement', () => {
    const result = instrumentForDebugger(
      `const a = 1;\nconst b = 2;\nconst c = a + b;\n`
    );
    expect(result.code).toContain('__lingua_dbg_yield(1');
    expect(result.code).toContain('__lingua_dbg_yield(2');
    expect(result.code).toContain('__lingua_dbg_yield(3');
    expect(result.instrumentedLines).toEqual([1, 2, 3]);
  });

  it('does NOT inject in front of the function declaration itself or inside sync bodies', () => {
    // Multi-line function so the declaration and body are clearly
    // separated. Line 1 is the FunctionDeclaration header (skipped);
    // line 2 is the inner return statement (sync body, skipped); line
    // 4 is the call site at top level (instrumented).
    const result = instrumentForDebugger(
      `function add(a, b) {\n  return a + b;\n}\nconst x = add(1, 2);\n`
    );
    expect(result.instrumentedLines).toEqual([4]);
    // The first statement of the program (FunctionDeclaration on line 1)
    // gets no yield because it's a hoisted declaration.
    const yieldsAtLine1 = (result.code.match(/__lingua_dbg_yield\(1,/g) ?? []).length;
    expect(yieldsAtLine1).toBe(0);
    expect(result.code).not.toContain('__lingua_dbg_yield(2');
  });

  it('descends into async function bodies and tracks frame push/pop', () => {
    const result = instrumentForDebugger(
      `async function add(a, b) {\n  const sum = a + b;\n  return sum;\n}\nawait add(1, 2);\n`
    );
    expect(result.instrumentedLines).toContain(2);
    expect(result.instrumentedLines).toContain(3);
    expect(result.instrumentedLines).toContain(5);
    expect(result.code).toContain('__lingua_dbg_frame("add", 1);');
    expect(result.code).toContain('__lingua_dbg_pop();');
  });

  it('keeps TDZ locals from blanking the whole locals snapshot', () => {
    const result = instrumentForDebugger(
      `const ready = true;\nconsole.log(ready);\nlet later = 1;\n`
    );
    expect(result.code).toContain('try { __lingua_dbg_locals["ready"] = ready; } catch {}');
    expect(result.code).toContain('try { __lingua_dbg_locals["later"] = later; } catch {}');
    expect(result.code).not.toContain('typeof later');
  });

  it('produces a non-empty source map', () => {
    const result = instrumentForDebugger(`const a = 1;\n`);
    expect(result.map).toBeTruthy();
    expect(result.map).toContain('"version"');
  });

  it('uses a custom helper name when provided', () => {
    const result = instrumentForDebugger(`const a = 1;\n`, {
      yieldHelperName: '__custom_yield',
    });
    expect(result.code).toContain('__custom_yield(1');
  });

  it('throws SyntaxError on malformed input', () => {
    expect(() => instrumentForDebugger(`const a = ;`)).toThrow();
  });

  it('handles async functions and top-level await', () => {
    const result = instrumentForDebugger(
      `await Promise.resolve();\nconst x = await fetch('/');\n`
    );
    expect(result.instrumentedLines).toEqual([1, 2]);
  });
});
