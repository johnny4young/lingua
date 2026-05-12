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

  it('promotes local sync functions so Step Into can pause inside them', () => {
    // Multi-line function so the declaration and body are clearly
    // separated. Line 1 is the FunctionDeclaration header (skipped);
    // line 2 is the inner return statement; lines 4 and 5 are call
    // sites, including an expression statement that starts at column 0.
    const result = instrumentForDebugger(
      `function add(a, b) {\n  return a + b;\n}\nconst x = add(1, 2);\nadd(3, 4);\n`
    );
    expect(result.instrumentedLines).toEqual([2, 4, 5]);
    expect(result.code).toContain('async function add');
    expect(result.code).toContain('const x = await add(1, 2);');
    expect(result.code).toContain('await add(3, 4);');
    expect(result.code).toContain('__lingua_dbg_yield(4');
    expect(result.code).toContain('__lingua_dbg_yield(5');
    expect(result.code).not.toContain('await await __lingua_dbg_yield');
    // The first statement of the program (FunctionDeclaration on line 1)
    // gets no yield because it's a hoisted declaration.
    const yieldsAtLine1 = (result.code.match(/__lingua_dbg_yield\(1,/g) ?? []).length;
    expect(yieldsAtLine1).toBe(0);
    expect(result.code).toContain('__lingua_dbg_yield(2');
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

  it('tracks assignment-created globals so later pauses can inspect them', () => {
    const result = instrumentForDebugger(
      `console.log("hello");\ni = "1";\nconsole.log(i + 1);\n`
    );
    expect(result.code).toContain('try { __lingua_dbg_locals["i"] = i; } catch {}');
  });

  it('produces a non-empty source map', () => {
    const result = instrumentForDebugger(`const a = 1;\n`);
    expect(result.map).toBeTruthy();
    expect(result.map).toContain('"version"');
  });

  it('maps generated debug lines back to source lines for console output', () => {
    const result = instrumentForDebugger(`console.log("hello");\nconst value = 1;\n`);
    expect(Object.values(result.sourceLineMap)).toContain(1);
    expect(Object.values(result.sourceLineMap)).toContain(2);
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

  describe('TS source-map composition (RL-027 Slice 1.5 fold G)', () => {
    // Each JS line N maps to source line N+1 in the original TS source.
    // VLQ "AACA" decodes to deltas (genCol 0, srcIdx 0, srcLine 1, srcCol 0).
    // First segment lands on (0, 0, 1, 0); subsequent `;AACA` segments
    // advance srcLine by another +1 each. 1-indexed API lookups for
    // generated lines 1/2/3 therefore return source lines 2/3/4.
    const SHIFT_MAP_BY_ONE = JSON.stringify({
      version: 3,
      sources: ['original.ts'],
      sourcesContent: [
        'type X = number;\nconst a = 1;\nconst b = 2;\nconst c = a + b;\n',
      ],
      mappings: 'AACA;AACA;AACA',
    });

    it('translates AST line numbers to user-source line numbers via inputMap', () => {
      const js = `const a = 1;\nconst b = 2;\nconst c = a + b;\n`;
      const result = instrumentForDebugger(js, { inputMap: SHIFT_MAP_BY_ONE });
      // Recorded lines are the TS coordinates the user sees in Monaco.
      expect(result.instrumentedLines).toEqual([2, 3, 4]);
      // Yield helper calls embed the translated line as the first arg.
      expect(result.code).toContain('__lingua_dbg_yield(2,');
      expect(result.code).toContain('__lingua_dbg_yield(3,');
      expect(result.code).toContain('__lingua_dbg_yield(4,');
      // The JS line numbers must NOT appear in the yields (otherwise a
      // TS breakpoint on line 2 would never match — it would be looking
      // for "1" instead of "2").
      expect(result.code).not.toMatch(/__lingua_dbg_yield\(1,/);
    });

    it('falls back to JS line numbers when inputMap is malformed', () => {
      const js = `const a = 1;\nconst b = 2;\n`;
      const result = instrumentForDebugger(js, { inputMap: 'this is not a source map' });
      // Translator returned passthrough; behavior matches the no-map path.
      expect(result.instrumentedLines).toEqual([1, 2]);
    });

    it('passes through when inputMap is omitted (pure JS path)', () => {
      const js = `const a = 1;\nconst b = 2;\n`;
      const result = instrumentForDebugger(js);
      expect(result.instrumentedLines).toEqual([1, 2]);
    });

    it('translates async function frame headers to user-source lines', () => {
      // Async function declared on JS line 1 → TS line 2.
      const js = `async function add(a, b) {\n  return a + b;\n}\nawait add(1, 2);\n`;
      const result = instrumentForDebugger(js, { inputMap: SHIFT_MAP_BY_ONE });
      // Frame header is emitted with the translated function line.
      expect(result.code).toContain('__lingua_dbg_frame("add", 2);');
    });
  });
});
