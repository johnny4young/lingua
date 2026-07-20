/**
 * implementation note — `timestamp` adapter.
 *
 * Parses a Unix epoch (seconds or milliseconds) OR a date string and
 * emits a deterministic multi-line readout: ISO 8601 (UTC), epoch
 * milliseconds, and epoch seconds. Pure — derives everything from the
 * INPUT, never the current clock, so it is referentially transparent
 * and trivially testable. Unparseable input → `invalid-input`.
 */

import type { UtilityAdapter } from './types';

/** No options. */
export type TimestampOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): TimestampOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

/**
 * Resolve the input to epoch milliseconds. All-digit input is treated
 * as epoch: <= 11 digits is seconds (through year ~5138), more is
 * milliseconds. Otherwise it is parsed as a date string. Returns `null`
 * when the value cannot be interpreted as a finite instant.
 */
function toEpochMs(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (/^-?\d+$/u.test(trimmed)) {
    const digits = trimmed.replace(/^-/u, '').length;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return digits <= 11 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export const timestampAdapter: UtilityAdapter<TimestampOptions> = {
  id: 'timestamp',
  titleKey: 'utilityPipeline.adapter.timestamp.title',
  descriptionKey: 'utilityPipeline.adapter.timestamp.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    const epochMs = toEpochMs(input);
    if (epochMs === null) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: 'expected a Unix epoch or a parseable date string',
      };
    }
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, reason: 'invalid-input', detail: 'out of range' };
    }
    const value = [
      `ISO 8601: ${date.toISOString()}`,
      `Epoch ms: ${epochMs}`,
      `Epoch s:  ${Math.floor(epochMs / 1000)}`,
    ].join('\n');
    return { ok: true, value };
  },
};
