/**
 * Reads the compared values out of a failing assertion's message. Each runner
 * family phrases the pair its own way, so only its own patterns apply.
 */

import { PROJECT_TEST_VALUE_LIMIT } from '../shared/projectTests';
import { truncateText } from '../shared/truncateText';

export type AssertionFamily = 'jest' | 'pytest' | 'go' | 'cargo';

interface AssertionValues {
  expected: string;
  received: string;
}

type Pattern = (message: string) => AssertionValues | null;

// Chai prints positive zero as +0 so it differs from -0; plain 0 reads the same and keeps -0 apart.
const plainZero = (value: string) => value.replace(/(?<![\w.])\+0(?![\w.])/gu, '0');

// Chai, used by Vitest: expected 1211 to be 1210.5 // Object.is equality
const chai: Pattern = message => {
  const match = /expected (.+?) to (?:be|equal|eql|deeply equal|strictly equal)(?! a\b| an\b) (.+?)(?:\s+\/\/.*)?$/mu.exec(message);
  return match && !/\bto not\b/u.test(match[0]) ? { received: plainZero(match[1]!), expected: plainZero(match[2]!) } : null;
};

// Jest: Expected: 1210.5 / Received: 1211
const jest: Pattern = message => {
  const expected = /^\s*Expected(?: value)?:\s*(.+)$/mu.exec(message);
  const received = /^\s*Received(?: value)?:\s*(.+)$/mu.exec(message);
  return expected && received ? { received: received[1]!, expected: expected[1]! } : null;
};

// pytest assertion rewriting: assert actual == expected
const balanced = (value: string) => [`'`, '"'].every(quote => value.split(quote).length % 2 === 1);
const pytest: Pattern = message => {
  const match = /^(?:\w*Error:\s*)?assert (.+?) == (.+)$/mu.exec(message);
  // An unbalanced quote means the split landed inside a string literal.
  return match && balanced(match[1]!) && balanced(match[2]!) ? { received: match[1]!, expected: match[2]! } : null;
};

// testify: expected: 1210.5 / actual  : 1211
const testify: Pattern = message => {
  const match = /expected\s*:\s*(.+)\n\s*actual\s*:\s*(.+)/u.exec(message);
  return match ? { received: match[2]!, expected: match[1]! } : null;
};

// Hand-written Go messages
const goText: Pattern = message => {
  const expectedFirst = /expected (.+?),? but got (.+)$/mu.exec(message);
  if (expectedFirst) return { received: expectedFirst[2]!, expected: expectedFirst[1]! };
  const gotFirst = /\bgot:? (.+?),? want:? (.+)$/mu.exec(message);
  return gotFirst ? { received: gotFirst[1]!, expected: gotFirst[2]! } : null;
};

// Rust assert_eq!(actual, expected): left / right, each value quoted in backticks before Rust 1.73
const rustValue = (value: string) => /^`(.*)`,?$/u.exec(value.trim())?.[1] ?? value;
const cargo: Pattern = message => {
  if (/left != right/u.test(message)) return null;
  const left = /^\s*left:\s*(.+)$/mu.exec(message);
  const right = /^\s*right:\s*(.+)$/mu.exec(message);
  return left && right ? { received: rustValue(left[1]!), expected: rustValue(right[1]!) } : null;
};

const PATTERNS: Record<AssertionFamily, Pattern[]> = {
  jest: [chai, jest],
  pytest: [pytest],
  go: [testify, goText],
  cargo: [cargo],
};

const clip = (value: string) => truncateText(value.trim(), PROJECT_TEST_VALUE_LIMIT);

export function assertionValues(family: AssertionFamily, message: string | undefined): AssertionValues | null {
  if (!message) return null;
  for (const pattern of PATTERNS[family]) {
    const values = pattern(message);
    if (values) {
      const received = clip(values.received);
      const expected = clip(values.expected);
      return received && expected ? { received, expected } : null;
    }
  }
  return null;
}
