import { load as parseYaml } from 'js-yaml';
import type { EditorDiagnostic, Language } from '../types';

export interface ValidationResult {
  diagnostics: EditorDiagnostic[];
  fullOutput: string;
  executionTime: number;
}

type Validator = (content: string) => EditorDiagnostic[];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function locationFromOffset(content: string, offset: number): Pick<EditorDiagnostic, 'line' | 'column'> {
  const boundedOffset = Math.max(0, Math.min(offset, content.length));
  const prefix = content.slice(0, boundedOffset);
  const lines = prefix.split('\n');
  const line = Math.max(lines.length, 1);
  const column = (lines.at(-1)?.length ?? 0) + 1;

  return { line, column };
}

function formatDiagnosticsOutput(language: Language, diagnostics: EditorDiagnostic[]): string {
  if (diagnostics.length === 0) {
    switch (language) {
      case 'json':
        return 'JSON validation passed. No syntax issues found.';
      case 'yaml':
        return 'YAML validation passed. No structural issues found.';
      case 'dotenv':
        return '.env validation passed. No malformed or duplicate entries found.';
      case 'csv':
        return 'CSV validation passed. Column shapes are consistent.';
      case 'editorconfig':
        return 'EditorConfig validation passed. Known keys and values only.';
      case 'dockerfile':
        return 'Dockerfile validation passed. No common issues detected.';
      case 'gitignore':
        return 'Gitignore validation passed. No suspicious patterns detected.';
      case 'makefile':
        return 'Makefile validation passed. Recipe indentation looks consistent.';
      default:
        return 'No validation issues found.';
    }
  }

  return diagnostics
    .map((diagnostic) => {
      const location = diagnostic.column
        ? `line ${diagnostic.line}:${diagnostic.column}`
        : `line ${diagnostic.line}`;
      return `[${diagnostic.severity.toUpperCase()}] ${location} — ${diagnostic.message}`;
    })
    .join('\n');
}

function validateJson(content: string): EditorDiagnostic[] {
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const positionMatch = message.match(/position (\d+)/u);
    const offset = positionMatch ? Number(positionMatch[1]) : 0;
    const location = locationFromOffset(content, offset);

    return [
      {
        message,
        line: location.line,
        column: location.column,
        severity: 'error',
        source: 'json',
      },
    ];
  }
}

function validateYaml(content: string): EditorDiagnostic[] {
  try {
    parseYaml(content);
    return [];
  } catch (error) {
    const yamlError = error as { message?: string; mark?: { line?: number; column?: number } };

    return [
      {
        message: yamlError.message ?? 'Invalid YAML document.',
        line: (yamlError.mark?.line ?? 0) + 1,
        column: (yamlError.mark?.column ?? 0) + 1,
        severity: 'error',
        source: 'yaml',
      },
    ];
  }
}

function validateDotenv(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const seenKeys = new Map<string, number>();

  for (const [index, line] of content.split('\n').entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) {
      diagnostics.push({
        message: 'Expected KEY=value syntax.',
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dotenv',
      });
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      diagnostics.push({
        message: `Invalid environment key "${key}".`,
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dotenv',
      });
      continue;
    }

    const previousLine = seenKeys.get(key);
    if (previousLine !== undefined) {
      diagnostics.push({
        message: `Duplicate key "${key}" also defined on line ${previousLine}.`,
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'dotenv',
      });
      continue;
    }

    seenKeys.set(key, lineNumber);
  }

  return diagnostics;
}

interface ParsedCsvRow {
  cells: string[];
  error?: EditorDiagnostic;
}

function parseCsvLine(line: string, lineNumber: number): ParsedCsvRow {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    return {
      cells,
      error: {
        message: 'Unclosed quoted value.',
        line: lineNumber,
        column: Math.max(line.length, 1),
        severity: 'error',
        source: 'csv',
      },
    };
  }

  cells.push(current);
  return { cells };
}

function validateCsv(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  let expectedColumns: number | null = null;

  for (const [index, line] of content.split('\n').entries()) {
    const lineNumber = index + 1;
    if (!line.trim()) {
      continue;
    }

    const parsed = parseCsvLine(line, lineNumber);
    if (parsed.error) {
      diagnostics.push(parsed.error);
      continue;
    }

    if (expectedColumns === null) {
      expectedColumns = parsed.cells.length;
      continue;
    }

    if (parsed.cells.length !== expectedColumns) {
      diagnostics.push({
        message: `Expected ${expectedColumns} columns but found ${parsed.cells.length}.`,
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'csv',
      });
    }
  }

  return diagnostics;
}

/**
 * EditorConfig known properties (v0.15.x). Values in the map are either a
 * fixed set of allowed values (for enum-style properties) or `null` meaning
 * "free-form value, only the key name is validated". This is intentionally a
 * shallow spec — we flag unknown keys and clearly-wrong enum values, not
 * full glob-pattern sanity or cross-section semantics.
 */
const EDITORCONFIG_KEYS: Record<string, readonly string[] | null> = {
  root: ['true', 'false'],
  indent_style: ['tab', 'space'],
  indent_size: null,
  tab_width: null,
  end_of_line: ['lf', 'cr', 'crlf'],
  charset: ['latin1', 'utf-8', 'utf-8-bom', 'utf-16be', 'utf-16le'],
  trim_trailing_whitespace: ['true', 'false'],
  insert_final_newline: ['true', 'false'],
  max_line_length: null,
};

function validateEditorConfig(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue;

    const equalsIndex = rawLine.indexOf('=');
    if (equalsIndex < 0) {
      diagnostics.push({
        message: 'Expected "key = value" or a section header like "[*]".',
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'editorconfig',
      });
      continue;
    }

    const rawKey = rawLine.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = rawLine.slice(equalsIndex + 1).trim();
    const allowed = EDITORCONFIG_KEYS[rawKey];

    if (allowed === undefined) {
      diagnostics.push({
        message: `Unknown EditorConfig key "${rawKey}".`,
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'editorconfig',
      });
      continue;
    }

    // indent_size accepts a positive integer or the literal 'tab'.
    if (rawKey === 'indent_size') {
      if (rawValue !== 'tab' && !/^\d+$/.test(rawValue)) {
        diagnostics.push({
          message: 'indent_size must be a positive integer or the literal "tab".',
          line: lineNumber,
          column: equalsIndex + 2,
          severity: 'warning',
          source: 'editorconfig',
        });
      }
      continue;
    }

    if (rawKey === 'tab_width' || rawKey === 'max_line_length') {
      if (!/^\d+$/.test(rawValue)) {
        diagnostics.push({
          message: `${rawKey} must be a positive integer.`,
          line: lineNumber,
          column: equalsIndex + 2,
          severity: 'warning',
          source: 'editorconfig',
        });
      }
      continue;
    }

    if (allowed && !allowed.includes(rawValue.toLowerCase())) {
      diagnostics.push({
        message: `"${rawValue}" is not a valid value for ${rawKey}. Expected one of: ${allowed.join(', ')}.`,
        line: lineNumber,
        column: equalsIndex + 2,
        severity: 'warning',
        source: 'editorconfig',
      });
    }
  }

  return diagnostics;
}

/**
 * Dockerfile instructions we recognize (Docker v26 / OCI reference). Unknown
 * instructions are flagged as info-severity so users catch typos without the
 * noise of false positives on legitimate uppercase keys.
 */
const DOCKERFILE_INSTRUCTIONS: ReadonlySet<string> = new Set([
  'ADD',
  'ARG',
  'CMD',
  'COPY',
  'ENTRYPOINT',
  'ENV',
  'EXPOSE',
  'FROM',
  'HEALTHCHECK',
  'LABEL',
  'ONBUILD',
  'RUN',
  'SHELL',
  'STOPSIGNAL',
  'USER',
  'VOLUME',
  'WORKDIR',
]);

function validateDockerfile(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  let sawContent = false;
  let sawInstruction = false;
  let sawFrom = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    sawContent = true;

    const instructionMatch = trimmed.match(/^([A-Za-z]+)(\s+|$)/u);
    if (!instructionMatch) continue;
    const instruction = (instructionMatch[1] ?? '').toUpperCase();

    if (!DOCKERFILE_INSTRUCTIONS.has(instruction) && instruction !== 'MAINTAINER') {
      diagnostics.push({
        message: `Unknown Dockerfile instruction "${instruction}".`,
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'dockerfile',
      });
      continue;
    }

    if (instruction === 'MAINTAINER') {
      diagnostics.push({
        message: 'MAINTAINER is deprecated. Use LABEL org.opencontainers.image.authors="..." instead.',
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'dockerfile',
      });
      continue;
    }

    if (!sawInstruction && instruction !== 'FROM' && instruction !== 'ARG') {
      diagnostics.push({
        message: 'The first instruction in a Dockerfile must be FROM (ARG is the only exception).',
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dockerfile',
      });
    }
    sawInstruction = true;
    if (instruction === 'FROM') sawFrom = true;

    // `ADD <url>` is almost always a mistake — COPY + explicit fetch is
    // preferred. Flag remote URLs in ADD but leave local paths alone.
    if (instruction === 'ADD') {
      const args = trimmed.slice(instruction.length).trim();
      if (/^https?:\/\//u.test(args)) {
        diagnostics.push({
          message: 'Prefer RUN with curl/wget + COPY over ADD <url>; ADD does not verify checksums.',
          line: lineNumber,
          column: 1,
          severity: 'warning',
          source: 'dockerfile',
        });
      }
    }

    // `FROM image:latest` (or implicit `FROM image` with no tag) yields a
    // non-reproducible build — flag both forms but only at warning severity
    // since some base images legitimately omit the tag.
    if (instruction === 'FROM') {
      const args = trimmed.slice(instruction.length).trim();
      const imageRef = args.split(/\s+/u)[0] ?? '';
      if (imageRef && imageRef !== 'scratch' && !imageRef.startsWith('$')) {
        const hasDigest = imageRef.includes('@sha256:');
        if (!hasDigest) {
          const refWithoutDigest = imageRef.split('@')[0] ?? imageRef;
          const lastSlash = refWithoutDigest.lastIndexOf('/');
          const lastColon = refWithoutDigest.lastIndexOf(':');
          const tag = lastColon > lastSlash ? refWithoutDigest.slice(lastColon + 1) : null;

          if (!tag) {
            diagnostics.push({
              message: `"${imageRef}" has no tag — pin a specific tag (or digest) for reproducible builds.`,
              line: lineNumber,
              column: 1,
              severity: 'warning',
              source: 'dockerfile',
            });
          } else if (tag === 'latest') {
            diagnostics.push({
              message: '`:latest` tags are not pinned. Use a specific tag or a digest for reproducible builds.',
              line: lineNumber,
              column: 1,
              severity: 'warning',
              source: 'dockerfile',
            });
          }
        }
      }
    }

    // `RUN apt-get install …` without `-y` hangs the build waiting for a
    // prompt that will never come. `--no-install-recommends` avoids surprise
    // dependency bloat — recommend the duo together.
    if (instruction === 'RUN') {
      const args = trimmed.slice(instruction.length);
      if (/\bapt(-get)?\s+install\b/u.test(args) && !/\s-y\b|\s--yes\b|\s--assume-yes\b/u.test(args)) {
        diagnostics.push({
          message: 'apt-get install without `-y` will block the build. Add `-y --no-install-recommends` and clean up `rm -rf /var/lib/apt/lists/*`.',
          line: lineNumber,
          column: 1,
          severity: 'warning',
          source: 'dockerfile',
        });
      }
    }
  }

  if (sawContent && !sawFrom) {
    diagnostics.push({
      message: 'Dockerfile is missing a FROM instruction.',
      line: 1,
      column: 1,
      severity: 'error',
      source: 'dockerfile',
    });
  }

  return diagnostics;
}

function validateGitignore(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  const seenPatterns = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // The actual pattern; `!` negates, we compare both with and without it
    // so `foo.log` and `!foo.log` count as the same duplicate key.
    const pattern = trimmed.startsWith('!') ? trimmed.slice(1).trim() : trimmed;
    if (!pattern) {
      diagnostics.push({
        message: '"!" with no pattern does nothing.',
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'gitignore',
      });
      continue;
    }

    if (/\\/u.test(trimmed) && !/\\[ #!]/u.test(trimmed)) {
      // Backslash-as-separator is a Windows-path tell; gitignore is POSIX-only.
      diagnostics.push({
        message: 'gitignore patterns use forward slashes, not backslashes, even on Windows.',
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'gitignore',
      });
    }

    const previous = seenPatterns.get(pattern);
    if (previous !== undefined) {
      diagnostics.push({
        message: `Duplicate pattern "${pattern}" also appears on line ${previous}.`,
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'gitignore',
      });
      continue;
    }
    seenPatterns.set(pattern, lineNumber);
  }

  return diagnostics;
}

function validateMakefile(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  let activeTarget: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;

    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      activeTarget = null;
      continue;
    }

    // Recipe lines must start with a literal tab. Space-indented recipes are
    // the classic "missing separator" footgun; flag them specifically.
    if (/^ +\S/u.test(rawLine)) {
      if (activeTarget) {
        diagnostics.push({
          message: `Recipe for "${activeTarget}" is indented with spaces. Makefiles require a hard tab before each command.`,
          line: lineNumber,
          column: 1,
          severity: 'error',
          source: 'makefile',
        });
      }
      continue;
    }

    if (rawLine.startsWith('\t')) {
      if (!activeTarget) {
        diagnostics.push({
          message: 'Tab-indented command has no preceding target — Make will reject this.',
          line: lineNumber,
          column: 1,
          severity: 'error',
          source: 'makefile',
        });
      }
      continue;
    }

    // Target line: `name: deps`. Anything with a colon before any `=`.
    const colonIndex = rawLine.indexOf(':');
    const equalsIndex = rawLine.indexOf('=');
    const isAssignment = equalsIndex >= 0 && (colonIndex < 0 || equalsIndex < colonIndex);
    if (!isAssignment && colonIndex > 0) {
      activeTarget = rawLine.slice(0, colonIndex).trim().split(/\s+/u)[0] ?? null;
      continue;
    }

    activeTarget = null;
  }

  return diagnostics;
}

const validators: Partial<Record<Language, Validator>> = {
  json: validateJson,
  yaml: validateYaml,
  dotenv: validateDotenv,
  csv: validateCsv,
  editorconfig: validateEditorConfig,
  dockerfile: validateDockerfile,
  gitignore: validateGitignore,
  makefile: validateMakefile,
};

export function supportsValidation(language: Language): boolean {
  return language in validators;
}

export function validateDocument(language: Language, content: string): ValidationResult {
  const startedAt = now();
  const diagnostics = validators[language]?.(content) ?? [];
  const executionTime = now() - startedAt;

  return {
    diagnostics,
    fullOutput: formatDiagnosticsOutput(language, diagnostics),
    executionTime,
  };
}
