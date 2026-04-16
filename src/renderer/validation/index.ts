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

const validators: Partial<Record<Language, Validator>> = {
  json: validateJson,
  yaml: validateYaml,
  dotenv: validateDotenv,
  csv: validateCsv,
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
