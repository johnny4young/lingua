/**
 * Tests for src/renderer/plugins/index.ts (PluginRegistry + BasePluginRunner)
 * and src/renderer/plugins/lua-runner.ts (LuaRunner + luaPlugin)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry, BasePluginRunner } from '@/plugins/index';
import type { LinguaPlugin } from '@/plugins/index';
import type { ExecutionContext, ExecutionResult } from '@/types';
import { LuaRunner, luaPlugin } from '@/plugins/lua-runner';

// ---------------------------------------------------------------- PluginRegistry

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  const makePlugin = (id: string, language = id): LinguaPlugin => ({
    id,
    name: id,
    version: '0.1.0',
    language,
    extensions: [`.${id}`],
    async createRunner() {
      // Concrete inline runner for testing
      class TestRunner extends BasePluginRunner {
        id = id;
        name = id;
        language = language;
        extensions = [`.${id}`];
        async execute(): Promise<ExecutionResult> {
          return { stdout: [], stderr: [], executionTime: 0 };
        }
      }
      return new TestRunner();
    },
  });

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('starts empty', () => {
    expect(registry.getAll()).toHaveLength(0);
  });

  it('registers a plugin', () => {
    registry.register(makePlugin('test-lang'));
    expect(registry.getAll()).toHaveLength(1);
  });

  it('retrieves a plugin by id', () => {
    registry.register(makePlugin('foo'));
    expect(registry.get('foo')).toBeDefined();
    expect(registry.get('bar')).toBeUndefined();
  });

  it('retrieves a plugin by language', () => {
    registry.register(makePlugin('my-plugin', 'my-lang'));
    expect(registry.getByLanguage('my-lang')).toBeDefined();
    expect(registry.getByLanguage('other-lang')).toBeUndefined();
  });

  it('hasLanguage returns correct boolean', () => {
    registry.register(makePlugin('chk', 'chk-lang'));
    expect(registry.hasLanguage('chk-lang')).toBe(true);
    expect(registry.hasLanguage('missing')).toBe(false);
  });

  it('throws on duplicate id registration', () => {
    registry.register(makePlugin('dup'));
    expect(() => registry.register(makePlugin('dup'))).toThrow(
      /already registered/
    );
  });

  it('unregisters a plugin', () => {
    registry.register(makePlugin('temp'));
    registry.unregister('temp');
    expect(registry.get('temp')).toBeUndefined();
  });
});

// ---------------------------------------------------------------- BasePluginRunner

describe('BasePluginRunner', () => {
  class ConcreteRunner extends BasePluginRunner {
    id = 'concrete';
    name = 'Concrete';
    language = 'concrete';
    extensions = ['.con'];
    async execute(_code: string, _ctx?: ExecutionContext): Promise<ExecutionResult> {
      return { stdout: [], stderr: [], executionTime: 42 };
    }
  }

  it('is not ready before init', () => {
    const r = new ConcreteRunner();
    expect(r.isReady()).toBe(false);
  });

  it('is ready after init', async () => {
    const r = new ConcreteRunner();
    await r.init();
    expect(r.isReady()).toBe(true);
  });

  it('stop() does not throw', () => {
    const r = new ConcreteRunner();
    expect(() => r.stop()).not.toThrow();
  });

  it('execute returns an ExecutionResult', async () => {
    const r = new ConcreteRunner();
    await r.init();
    const result = await r.execute('test code');
    expect(result).toHaveProperty('executionTime', 42);
    expect(Array.isArray(result.stdout)).toBe(true);
    expect(Array.isArray(result.stderr)).toBe(true);
  });
});

// ---------------------------------------------------------------- LuaRunner

describe('LuaRunner', () => {
  it('has correct metadata', () => {
    const runner = new LuaRunner();
    expect(runner.id).toBe('lua');
    expect(runner.name).toBe('Lua');
    expect(runner.language).toBe('lua');
    expect(runner.extensions).toContain('.lua');
  });

  it('is not ready before init', () => {
    const runner = new LuaRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('is ready after init', async () => {
    const runner = new LuaRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('executes Lua and captures print output', async () => {
    const runner = new LuaRunner();
    await runner.init();
    const result = await runner.execute('print("hello", "world")');
    expect(result.stdout).toEqual([
      {
        type: 'log',
        args: ['hello', 'world'],
      },
    ]);
    expect(result.error).toBeUndefined();
  });

  it('returns Lua values from the executed chunk', async () => {
    const runner = new LuaRunner();
    await runner.init();
    const result = await runner.execute('return 21 * 2');
    expect(result.result).toBe(42);
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('surfaces Lua runtime errors', async () => {
    const runner = new LuaRunner();
    await runner.init();
    const result = await runner.execute('error("boom")');
    expect(result.error?.message).toMatch(/boom/);
  });
});

// ---------------------------------------------------------------- luaPlugin descriptor

describe('luaPlugin', () => {
  it('has expected metadata', () => {
    expect(luaPlugin.id).toBe('lua');
    expect(luaPlugin.name).toBe('Lua');
    expect(luaPlugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(luaPlugin.monacoLanguage).toBe('lua');
    expect(luaPlugin.extensions).toContain('.lua');
  });

  it('has default code', () => {
    expect(typeof luaPlugin.defaultCode).toBe('string');
    expect(luaPlugin.defaultCode!.length).toBeGreaterThan(0);
  });

  it('createRunner() returns a LuaRunner', async () => {
    const runner = await luaPlugin.createRunner();
    expect(runner).toBeInstanceOf(LuaRunner);
  });
});
