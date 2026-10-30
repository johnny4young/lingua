export interface ProjectTestFailureSummary {
  /** First meaningful line of the runner message, without the error class or a `file:line:` prefix. */
  headline: string;
  expected?: string;
  received?: string;
}

const VALUE_LIMIT = 120;

const clip = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > VALUE_LIMIT ? `${trimmed.slice(0, VALUE_LIMIT - 1)}…` : trimmed;
};

// Each pattern returns [received, expected]; runners phrase the pair in different orders.
const PATTERNS: Array<(message: string) => [string, string] | null> = [
  // Chai, used by Vitest: expected 1211 to be 1210.5 // Object.is equality
  message => {
    const match = /expected (.+?) to (?:be|equal|eql|deeply equal|strictly equal)(?! a\b| an\b) (.+?)(?:\s+\/\/.*)?$/mu.exec(message);
    return match && !/\bto not\b/u.test(match[0]) ? [match[1]!, match[2]!] : null;
  },
  // Jest: Expected: 1210.5 / Received: 1211
  message => {
    const expected = /^\s*Expected(?: value)?:\s*(.+)$/mu.exec(message);
    const received = /^\s*Received(?: value)?:\s*(.+)$/mu.exec(message);
    return expected && received ? [received[1]!, expected[1]!] : null;
  },
  // testify: expected: 1210.5 / actual  : 1211
  message => {
    const match = /expected\s*:\s*(.+)\n\s*actual\s*:\s*(.+)/u.exec(message);
    return match ? [match[2]!, match[1]!] : null;
  },
  // Rust assert_eq!(actual, expected): left / right
  message => {
    const left = /^\s*left:\s*(.+)$/mu.exec(message);
    const right = /^\s*right:\s*(.+)$/mu.exec(message);
    return left && right ? [left[1]!, right[1]!] : null;
  },
  // pytest assertion rewriting: assert actual == expected
  message => {
    const match = /^assert (.+?) == (.+)$/mu.exec(message);
    return match ? [match[1]!, match[2]!] : null;
  },
  // Hand-written Go messages
  message => {
    const match = /expected (.+?),? but got (.+)$/mu.exec(message) ?? /\bgot:? (.+?),? want:? (.+)$/mu.exec(message);
    if (!match) return null;
    return match[0].startsWith('expected') ? [match[2]!, match[1]!] : [match[1]!, match[2]!];
  },
];

export function summarizeProjectTestFailure(message: string | undefined): ProjectTestFailureSummary | null {
  const lines = (message ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const headline = clip(lines[0]!.replace(/^(?:\w*Error:\s*)/u, '').replace(/^[\w./-]+\.\w+:\d+:\s*/u, ''));
  for (const pattern of PATTERNS) {
    const pair = pattern(message!);
    if (pair) return { headline, received: clip(pair[0]), expected: clip(pair[1]) };
  }
  return { headline };
}
