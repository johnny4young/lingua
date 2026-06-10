import { describe, expect, it } from 'vitest';
import {
  JS_FAMILY_LANGUAGES,
  WORKER_RUNNER_LANGUAGES,
  isJavaScriptFamily,
  isWorkerRunnerLanguage,
} from '../../src/shared/languageFamilies';

describe('languageFamilies', () => {
  it('isJavaScriptFamily accepts exactly the JS family', () => {
    expect(isJavaScriptFamily('javascript')).toBe(true);
    expect(isJavaScriptFamily('typescript')).toBe(true);
    expect(isJavaScriptFamily('python')).toBe(false);
    expect(isJavaScriptFamily('go')).toBe(false);
    expect(isJavaScriptFamily('rust')).toBe(false);
    expect(isJavaScriptFamily('ruby')).toBe(false);
    expect(isJavaScriptFamily('lua')).toBe(false);
  });

  it('isWorkerRunnerLanguage accepts exactly the worker-runner set', () => {
    expect(isWorkerRunnerLanguage('javascript')).toBe(true);
    expect(isWorkerRunnerLanguage('typescript')).toBe(true);
    expect(isWorkerRunnerLanguage('python')).toBe(true);
    expect(isWorkerRunnerLanguage('go')).toBe(false);
    expect(isWorkerRunnerLanguage('rust')).toBe(false);
    expect(isWorkerRunnerLanguage('ruby')).toBe(false);
    expect(isWorkerRunnerLanguage('lua')).toBe(false);
  });

  it('rejects null, undefined, empty, and case-variant inputs', () => {
    for (const fn of [isJavaScriptFamily, isWorkerRunnerLanguage]) {
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
      expect(fn('')).toBe(false);
      expect(fn('JavaScript')).toBe(false);
      expect(fn(' javascript')).toBe(false);
    }
  });

  it('keeps the predicates consistent with the exported membership sets', () => {
    // The sets are the single source of truth; the predicates must never
    // drift from them (e.g. by growing a hardcoded special case).
    for (const language of JS_FAMILY_LANGUAGES) {
      expect(isJavaScriptFamily(language)).toBe(true);
    }
    for (const language of WORKER_RUNNER_LANGUAGES) {
      expect(isWorkerRunnerLanguage(language)).toBe(true);
    }
    // JS family is a strict subset of the worker-runner set today: both
    // JS dialects execute in the shared js-worker.
    for (const language of JS_FAMILY_LANGUAGES) {
      expect(WORKER_RUNNER_LANGUAGES.has(language)).toBe(true);
    }
  });
});
