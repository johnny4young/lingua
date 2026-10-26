/**
 * Turns each runner's report into project-relative test cases. Paths outside
 * the project root are dropped, so the renderer never sees an absolute path.
 */

import path from 'node:path';
import {
  PROJECT_TEST_MAX_CASES,
  type ProjectTestCase,
  type ProjectTestCaseStatus,
} from '../shared/projectTests';

const MESSAGE_LIMIT = 2_000;

export interface ParsedProjectTestCases {
  cases: ProjectTestCase[];
  truncated: boolean;
}

class CaseList {
  readonly cases: ProjectTestCase[] = [];
  truncated = false;

  push(entry: ProjectTestCase): void {
    if (this.cases.length >= PROJECT_TEST_MAX_CASES) {
      this.truncated = true;
      return;
    }
    this.cases.push(entry);
  }

  done(): ParsedProjectTestCases {
    return { cases: this.cases, truncated: this.truncated };
  }
}

function relativeTo(rootPath: string, absolute: string): string | null {
  const relative = path.relative(rootPath, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function clip(message: string): string | undefined {
  const trimmed = message.trim();
  return trimmed ? trimmed.slice(0, MESSAGE_LIMIT) : undefined;
}

function lineAfter(text: string, prefix: string): number | undefined {
  const at = text.indexOf(prefix);
  if (at < 0) return undefined;
  const match = /^(\d+)/u.exec(text.slice(at + prefix.length));
  return match ? Number(match[1]) : undefined;
}

function failureFields(file: string | undefined, line: number | undefined, message: string | undefined) {
  return {
    ...(file && line ? { failureFile: file, failureLine: line } : {}),
    ...(message ? { failureMessage: message } : {}),
  };
}

/** Vitest's JSON reporter writes the same shape as Jest's `--json`. */
export function parseJestStyleReport(json: string, rootPath: string): ParsedProjectTestCases | null {
  let report: unknown;
  try {
    report = JSON.parse(json);
  } catch {
    return null;
  }
  const suites = (report as { testResults?: unknown })?.testResults;
  if (!Array.isArray(suites)) return null;
  const list = new CaseList();
  for (const suite of suites as Array<Record<string, unknown>>) {
    const absolute = typeof suite.name === 'string' ? suite.name : '';
    const file = relativeTo(rootPath, absolute);
    if (!file) continue;
    const assertions = Array.isArray(suite.assertionResults) ? (suite.assertionResults as Array<Record<string, unknown>>) : [];
    if (assertions.length === 0 && suite.status === 'failed') {
      const message = typeof suite.message === 'string' ? suite.message : '';
      list.push({ file, path: [], status: 'failed', runnable: false, ...failureFields(undefined, undefined, clip(message)) });
      continue;
    }
    for (const assertion of assertions) {
      const titles = Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles.filter((title): title is string => typeof title === 'string') : [];
      const title = typeof assertion.title === 'string' ? assertion.title : '';
      const status: ProjectTestCaseStatus =
        assertion.status === 'passed' ? 'passed' : assertion.status === 'failed' ? 'failed' : 'skipped';
      const raw = Array.isArray(assertion.failureMessages) && typeof assertion.failureMessages[0] === 'string' ? assertion.failureMessages[0] : '';
      list.push({
        file,
        path: [...titles, title],
        status,
        ...(typeof assertion.duration === 'number' ? { durationMs: assertion.duration } : {}),
        ...(status === 'failed'
          ? failureFields(file, lineAfter(raw, `${absolute}:`), clip(raw.split(/\n\s+at /u)[0] ?? ''))
          : {}),
      });
    }
  }
  return list.done();
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const point = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

interface XmlElement {
  attributes: Record<string, string>;
  body: string;
}

/** Reads one tag's attributes from `start` (just after the tag name), honouring quotes. */
function readTag(xml: string, start: number): { attributes: Record<string, string>; end: number; selfClosing: boolean } | null {
  const attributes: Record<string, string> = {};
  let index = start;
  while (index < xml.length) {
    while (/\s/u.test(xml[index] ?? '')) index += 1;
    if (xml.startsWith('/>', index)) return { attributes, end: index + 2, selfClosing: true };
    if (xml[index] === '>') return { attributes, end: index + 1, selfClosing: false };
    const name = /^[\w:.-]+/u.exec(xml.slice(index))?.[0];
    if (!name) return null;
    index += name.length;
    while (/\s/u.test(xml[index] ?? '')) index += 1;
    if (xml[index] !== '=') return null;
    index += 1;
    while (/\s/u.test(xml[index] ?? '')) index += 1;
    const quote = xml[index];
    if (quote !== '"' && quote !== "'") return null;
    const close = xml.indexOf(quote, index + 1);
    if (close < 0) return null;
    attributes[name] = decodeXml(xml.slice(index + 1, close));
    index = close + 1;
  }
  return null;
}

function elements(xml: string, tag: string): XmlElement[] {
  const found: XmlElement[] = [];
  let from = 0;
  for (;;) {
    const open = xml.indexOf(`<${tag}`, from);
    if (open < 0) return found;
    const next = xml[open + tag.length + 1];
    if (next !== undefined && !/[\s/>]/u.test(next)) {
      from = open + 1;
      continue;
    }
    const parsed = readTag(xml, open + tag.length + 1);
    if (!parsed) return found;
    if (parsed.selfClosing) {
      found.push({ attributes: parsed.attributes, body: '' });
      from = parsed.end;
      continue;
    }
    const close = xml.indexOf(`</${tag}>`, parsed.end);
    if (close < 0) return found;
    found.push({ attributes: parsed.attributes, body: xml.slice(parsed.end, close) });
    from = close + tag.length + 3;
  }
}

/** pytest's JUnit XML with `junit_family=xunit1`, which records each test's file. */
export function parsePytestJunit(xml: string): ParsedProjectTestCases | null {
  if (!xml.includes('<testsuite')) return null;
  const list = new CaseList();
  for (const testcase of elements(xml, 'testcase')) {
    const file = testcase.attributes.file?.split('\\').join('/');
    const name = testcase.attributes.name;
    if (!file || !name || file.startsWith('/') || file.startsWith('..')) continue;
    const module = file.replace(/\.py$/u, '').split('/').join('.');
    const classname = testcase.attributes.classname ?? '';
    const classes = classname.startsWith(`${module}.`) ? classname.slice(module.length + 1).split('.').filter(Boolean) : [];
    const failure = elements(testcase.body, 'failure')[0] ?? elements(testcase.body, 'error')[0];
    const skipped = elements(testcase.body, 'skipped').length > 0;
    const status: ProjectTestCaseStatus = failure ? 'failed' : skipped ? 'skipped' : 'passed';
    const seconds = Number(testcase.attributes.time);
    const body = failure ? decodeXml(failure.body) : '';
    const lines = [...body.matchAll(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:(\\d+):`, 'gmu'))];
    const line = lines.length > 0 ? Number(lines[lines.length - 1]![1]) : undefined;
    list.push({
      file,
      path: [...classes, name],
      status,
      ...(Number.isFinite(seconds) ? { durationMs: Math.round(seconds * 1000) } : {}),
      ...(failure ? failureFields(file, line, clip(failure.attributes.message ?? body)) : {}),
    });
  }
  return list.done();
}

interface GoTestState {
  file: string;
  path: string[];
  status: ProjectTestCaseStatus | null;
  durationMs?: number;
  output: string[];
}

const GO_OUTPUT_LIMIT = 64;
// Parents and leaves both arrive as events; this bounds the work after the run.
const GO_TEST_LIMIT = PROJECT_TEST_MAX_CASES * 4;
const GO_FRAME = /^\s*(=== (RUN|PAUSE|CONT|NAME)|--- (PASS|FAIL|SKIP):)/u;

/**
 * `go test -json` arrives as a stream of events. The collector keeps only what
 * each test needs and hands back the plain `go test` text for the raw output.
 */
export function createGoTestCollector(modulePath: string) {
  const tests = new Map<string, GoTestState>();
  const packageOutput = new Map<string, string[]>();
  const failedPackages = new Set<string>();
  let pending = '';
  let overflow = false;

  const remember = (dir: string, text: string) => {
    const lines = packageOutput.get(dir) ?? [];
    if (lines.length < GO_OUTPUT_LIMIT) lines.push(text.trimEnd());
    packageOutput.set(dir, lines);
  };

  const directoryOf = (pkg: string): string | null =>
    pkg === modulePath ? '.' : pkg.startsWith(`${modulePath}/`) ? pkg.slice(modulePath.length + 1) : null;

  const handle = (line: string): string => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return `${line}\n`;
    }
    const output = typeof event.Output === 'string' ? event.Output : '';
    // Build events name the test binary (`pkg.test` or `pkg [pkg.test]`) instead of the package.
    const importPath = typeof event.ImportPath === 'string' ? event.ImportPath.split(' ')[0]!.replace(/\.test$/u, '') : '';
    const pkg = typeof event.Package === 'string' ? event.Package : importPath;
    const dir = directoryOf(pkg);
    const name = typeof event.Test === 'string' ? event.Test : '';
    if (dir === null) return output;
    if (!name) {
      if (event.Action === 'build-output' && output && !output.startsWith('# ')) remember(dir, output);
      else if (event.Action === 'output' && output && !/^(ok|FAIL|PASS|\?)\s/u.test(output)) remember(dir, output);
      if (event.Action === 'fail' || event.Action === 'build-fail') failedPackages.add(dir);
      return output;
    }
    const key = `${dir}\u0000${name}`;
    let state = tests.get(key);
    if (!state) {
      if (tests.size >= GO_TEST_LIMIT) {
        overflow = true;
        return output;
      }
      state = { file: dir, path: name.split('/'), status: null, output: [] };
      tests.set(key, state);
    }
    if (event.Action === 'output' && output && !GO_FRAME.test(output) && state.output.length < GO_OUTPUT_LIMIT) {
      state.output.push(output.trimEnd());
    } else if (event.Action === 'pass' || event.Action === 'fail' || event.Action === 'skip') {
      state.status = event.Action === 'pass' ? 'passed' : event.Action === 'fail' ? 'failed' : 'skipped';
      if (typeof event.Elapsed === 'number') state.durationMs = Math.round(event.Elapsed * 1000);
    }
    return output;
  };

  return {
    push(chunk: string): string {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      return lines.map(handle).join('');
    },
    /** Call after `flush`, once the stream has ended. */
    finish(): ParsedProjectTestCases {
      const list = new CaseList();
      const parents = new Set<string>();
      for (const key of tests.keys()) {
        for (let at = key.indexOf('/'); at >= 0; at = key.indexOf('/', at + 1)) parents.add(key.slice(0, at));
      }
      for (const [key, state] of tests) {
        if (state.status === null) continue;
        // Report leaves only: a parent's result repeats its subtests'.
        if (parents.has(key)) continue;
        let failureFile: string | undefined;
        let failureLine: number | undefined;
        for (const text of state.output) {
          const match = /^\s+([\w.-]+\.go):(\d+):/u.exec(text);
          if (match) {
            failureFile = state.file === '.' ? match[1] : `${state.file}/${match[1]}`;
            failureLine = Number(match[2]);
            break;
          }
        }
        list.push({
          file: state.file,
          path: state.path,
          status: state.status,
          ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
          ...(state.status === 'failed' ? failureFields(failureFile, failureLine, clip(state.output.join('\n'))) : {}),
        });
      }
      // A package that failed without a failing test did not build or could not start.
      const testFailed = new Set(list.cases.filter(entry => entry.status === 'failed').map(entry => entry.file));
      for (const dir of failedPackages) {
        if (testFailed.has(dir)) continue;
        const lines = packageOutput.get(dir) ?? [];
        const at = lines.map(text => /^([\w./-]+\.go):(\d+):/u.exec(text.trim())).find(Boolean);
        list.push({
          file: dir,
          path: [],
          status: 'failed',
          runnable: false,
          ...failureFields(at?.[1], at ? Number(at[2]) : undefined, clip(lines.join('\n'))),
        });
      }
      if (overflow) list.truncated = true;
      return list.done();
    },
    /** The text `go test` would have printed, for output that ends without a newline. */
    flush(): string {
      const rest = pending;
      pending = '';
      return rest ? handle(rest) : '';
    },
  };
}

/** `cargo test` has no stable machine format, so this reads libtest's text. */
export function parseCargoTestOutput(text: string): ParsedProjectTestCases {
  const list = new CaseList();
  const failures = new Map<string, { file?: string; line?: number; message: string[] }>();
  const byKey = new Map<string, ProjectTestCase>();
  let file: string | null = null;
  let doc = false;
  let section: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    const running = /^\s*Running (?:unittests )?(\S+) \(/u.exec(line);
    if (running) {
      file = running[1]!;
      doc = false;
      section = null;
      continue;
    }
    if (/^\s*Doc-tests \S+/u.test(line)) {
      file = null;
      doc = true;
      section = null;
      continue;
    }
    const header = /^---- (.+) stdout ----$/u.exec(line);
    if (header) {
      section = `${doc ? 'doc' : file}\u0000${header[1]}`;
      failures.set(section, { message: [] });
      continue;
    }
    if (section) {
      if (/^(failures:|test result:)/u.test(line) || line.startsWith('---- ')) {
        section = null;
      } else {
        const failure = failures.get(section)!;
        const panic = /panicked at ([^:]+):(\d+):\d+:?$/u.exec(line);
        if (panic) {
          failure.file = panic[1];
          failure.line = Number(panic[2]);
        } else if (line.trim() && !line.startsWith('note: run with') && failure.message.length < GO_OUTPUT_LIMIT) {
          failure.message.push(line);
        }
        continue;
      }
    }
    const result = /^test (.+?) \.\.\. (ok|FAILED|ignored)\b/u.exec(line);
    if (!result || (!file && !doc)) continue;
    const name = result[1]!;
    const status: ProjectTestCaseStatus = result[2] === 'ok' ? 'passed' : result[2] === 'FAILED' ? 'failed' : 'skipped';
    const entry: ProjectTestCase = doc
      ? { file: name.split(' - ')[0] ?? name, path: [name.split(' - ').slice(1).join(' - ') || name], status, runnable: false }
      : { file: file!, path: name.split('::'), status };
    byKey.set(`${doc ? 'doc' : file}\u0000${name}`, entry);
    list.push(entry);
  }
  for (const [key, failure] of failures) {
    const entry = byKey.get(key);
    if (!entry) continue;
    Object.assign(entry, failureFields(failure.file, failure.line, clip(failure.message.join('\n'))));
  }
  return list.done();
}
