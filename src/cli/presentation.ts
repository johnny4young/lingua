// SPDX-License-Identifier: MIT
/** Stable CLI diagnostics and ANSI color policy. */

import type { CliColorMode } from './commandModel';
import type { CliIo } from './io';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
} as const;

export interface CliOutputOptions {
  json: boolean;
  quiet: boolean;
  color?: CliColorMode;
}

export interface CliFailure {
  label: string;
  reason: string;
  detail: string;
  extra?: Readonly<Record<string, unknown>>;
}

type CliOutputStream = 'stdout' | 'stderr';
type CliStyle = keyof Omit<typeof ANSI, 'reset'>;

/**
 * Explicit CLI choice wins. In auto mode, NO_COLOR disables styling and the
 * selected destination must report terminal color support. JSON is handled by
 * the caller and never reaches this formatter.
 */
export function shouldUseColor(
  io: CliIo,
  mode: CliColorMode = 'auto',
  stream: CliOutputStream
): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (io.getEnvironmentValue('NO_COLOR') !== undefined) return false;
  return stream === 'stdout' ? io.stdoutSupportsColor : io.stderrSupportsColor;
}

export function styleCliText(
  io: CliIo,
  mode: CliColorMode | undefined,
  stream: CliOutputStream,
  style: CliStyle,
  text: string
): string {
  if (!shouldUseColor(io, mode, stream)) return text;
  return `${ANSI[style]}${text}${ANSI.reset}`;
}

/**
 * Emit the cross-command failure contract. JSON retains the established
 * `{ ok, reason, detail }` keys; plain mode uses one grep-friendly shape.
 */
export function emitCliFailure(io: CliIo, options: CliOutputOptions, failure: CliFailure): void {
  if (options.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: false, ...(failure.extra ?? {}), reason: failure.reason, detail: failure.detail })}\n`
    );
    return;
  }
  if (options.quiet) return;

  const label = styleCliText(io, options.color, 'stderr', 'bold', failure.label);
  const marker = styleCliText(io, options.color, 'stderr', 'red', `error[${failure.reason}]`);
  io.writeStderr(`${label}: ${marker}: ${failure.detail}\n`);
}

/** Color only headings/labels; never mutate examples or command payloads. */
export function renderCliHelp(io: CliIo, mode: CliColorMode | undefined, helpText: string): string {
  if (!shouldUseColor(io, mode, 'stdout')) return helpText;
  const lines = helpText.split('\n');
  return lines
    .map((line, index) => {
      if (index === 0) return styleCliText(io, mode, 'stdout', 'cyan', line);
      if (/^(Usage|Commands|Flags|Exit codes|Examples):$/u.test(line)) {
        return styleCliText(io, mode, 'stdout', 'bold', line);
      }
      return line;
    })
    .join('\n');
}

export function renderCliSuccess(io: CliIo, mode: CliColorMode | undefined, text: string): string {
  return styleCliText(io, mode, 'stdout', 'green', text);
}

export function renderCliNotice(
  io: CliIo,
  mode: CliColorMode | undefined,
  text: string,
  tone: 'success' | 'warning' = 'warning'
): string {
  return styleCliText(io, mode, 'stderr', tone === 'success' ? 'green' : 'yellow', text);
}
