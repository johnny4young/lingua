/**
 * RL-099 Slice 6 — `number-base` adapter.
 *
 * Convert an integer between binary / octal / decimal / hex. Pure
 * shared implementation (the shared layer cannot import the renderer
 * helpers; mirrors the `base64` / `stringCase` precedent). BigInt-based
 * so arbitrarily large integers convert without precision loss.
 *
 * `from = auto` sniffs a `0x` / `0o` / `0b` prefix (else decimal);
 * an explicit `from` base strips a matching prefix and validates every
 * digit against the base. `_` separators are tolerated. A digit out of
 * range for the source base, or empty / non-integer input, settles as
 * `invalid-input`. Fold G: `prefixOutput` re-attaches the `0x`/`0o`/`0b`
 * marker to a non-decimal result.
 */

import type { UtilityAdapter, UtilityOptionField } from './types';

/** Source-base choices. `auto` sniffs a literal prefix, else decimal. */
export const NUMBER_BASE_FROM = ['auto', '2', '8', '10', '16'] as const;
export type NumberBaseFrom = (typeof NUMBER_BASE_FROM)[number];

/** Target-base choices (no `auto` — the output base must be explicit). */
export const NUMBER_BASE_TO = ['2', '8', '10', '16'] as const;
export type NumberBaseTo = (typeof NUMBER_BASE_TO)[number];

/** Structured options for the `number-base` adapter. */
export interface NumberBaseOptions {
  /** Source base, or `auto` to sniff a `0x`/`0o`/`0b` prefix. */
  readonly from: NumberBaseFrom;
  /** Target base for the rendered output. */
  readonly to: NumberBaseTo;
  /** Fold G — prefix a non-decimal result with `0x`/`0o`/`0b`. */
  readonly prefixOutput: boolean;
}

const FROM_SET: ReadonlySet<string> = new Set(NUMBER_BASE_FROM);
const TO_SET: ReadonlySet<string> = new Set(NUMBER_BASE_TO);

const FROM_OPTION: UtilityOptionField = {
  key: 'from',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.numberBase.options.from.label',
  defaultValue: 'auto',
  options: NUMBER_BASE_FROM.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.numberBase.options.from.${value}`,
  })),
};

const TO_OPTION: UtilityOptionField = {
  key: 'to',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.numberBase.options.to.label',
  defaultValue: '10',
  options: NUMBER_BASE_TO.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.numberBase.options.to.${value}`,
  })),
};

const PREFIX_OPTION: UtilityOptionField = {
  key: 'prefixOutput',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.numberBase.options.prefixOutput.label',
  defaultValue: false,
};

const DIGITS_BY_BASE: Readonly<Record<number, RegExp>> = {
  2: /^[01]+$/u,
  8: /^[0-7]+$/u,
  10: /^[0-9]+$/u,
  16: /^[0-9a-f]+$/u,
};

const PREFIX_BY_BASE: Readonly<Record<number, string>> = {
  2: '0b',
  8: '0o',
  16: '0x',
};

function detectBase(body: string): number {
  const lower = body.toLowerCase();
  if (lower.startsWith('0x')) return 16;
  if (lower.startsWith('0o')) return 8;
  if (lower.startsWith('0b')) return 2;
  return 10;
}

/**
 * Parse a possibly-signed integer literal in `base` to a BigInt, or
 * `null` when any digit is out of range / the body is empty. Strips a
 * matching base prefix and `_` separators first.
 */
function parseInBase(raw: string, base: number): bigint | null {
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (s[0] === '+' || s[0] === '-') {
    negative = s[0] === '-';
    s = s.slice(1);
  }
  const lower = s.toLowerCase();
  const prefix = PREFIX_BY_BASE[base];
  if (prefix && lower.startsWith(prefix)) {
    s = s.slice(2);
  }
  s = s.replace(/_/gu, '').toLowerCase();
  if (s === '') return null;
  if (!DIGITS_BY_BASE[base]!.test(s)) return null;
  const radix = BigInt(base);
  let result = 0n;
  for (const ch of s) {
    result = result * radix + BigInt(Number.parseInt(ch, base));
  }
  return negative ? -result : result;
}

export const numberBaseAdapter: UtilityAdapter<NumberBaseOptions> = {
  id: 'number-base',
  titleKey: 'utilityPipeline.adapter.numberBase.title',
  descriptionKey: 'utilityPipeline.adapter.numberBase.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [FROM_OPTION, TO_OPTION, PREFIX_OPTION],
  defaultOptions: () => ({ from: 'auto', to: '10', prefixOutput: false }),
  parseOptions: (raw) => {
    if (raw === undefined || raw === null) {
      return { from: 'auto', to: '10', prefixOutput: false };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as {
      from?: unknown;
      to?: unknown;
      prefixOutput?: unknown;
    };
    const from = candidate.from === undefined ? 'auto' : candidate.from;
    const to = candidate.to === undefined ? '10' : candidate.to;
    const prefixOutput =
      candidate.prefixOutput === undefined ? false : candidate.prefixOutput;
    if (typeof from !== 'string' || !FROM_SET.has(from)) return null;
    if (typeof to !== 'string' || !TO_SET.has(to)) return null;
    if (typeof prefixOutput !== 'boolean') return null;
    return {
      from: from as NumberBaseFrom,
      to: to as NumberBaseTo,
      prefixOutput,
    };
  },
  run: async (input, options) => {
    const trimmed = input.trim();
    if (trimmed === '') {
      return { ok: false, reason: 'invalid-input', detail: 'empty input' };
    }
    const sourceBase =
      options.from === 'auto'
        ? detectBase(trimmed.replace(/^[+-]/u, ''))
        : Number.parseInt(options.from, 10);
    const value = parseInBase(trimmed, sourceBase);
    if (value === null) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: `not a base-${sourceBase} integer`,
      };
    }
    const targetBase = Number.parseInt(options.to, 10);
    let out = value.toString(targetBase);
    if (options.prefixOutput && targetBase !== 10) {
      const prefix = PREFIX_BY_BASE[targetBase]!;
      out = out.startsWith('-') ? `-${prefix}${out.slice(1)}` : `${prefix}${out}`;
    }
    return { ok: true, value: out };
  },
};
