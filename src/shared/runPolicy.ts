/**
 * When Scratchpad runs, per language group, with Run state on in Labs.
 * Manual never schedules a run; SQL and HTTP have no group and never auto-run.
 */
export const RUN_POLICY_GROUPS = ['jsTs', 'pythonRuby', 'goRust'] as const;
export type RunPolicyGroup = (typeof RUN_POLICY_GROUPS)[number];

export const RUN_POLICIES = ['keystroke', 'pause', 'manual'] as const;
export type RunPolicy = (typeof RUN_POLICIES)[number];

export type RunPolicyByGroup = Record<RunPolicyGroup, RunPolicy>;

export const DEFAULT_RUN_POLICY_BY_GROUP: RunPolicyByGroup = { jsTs: 'keystroke', pythonRuby: 'pause', goRust: 'manual' };

const DELAY_MS: Record<RunPolicy, number | null> = { keystroke: 500, pause: 1_000, manual: null };

const GROUP_BY_LANGUAGE: Readonly<Record<string, RunPolicyGroup>> = {
  javascript: 'jsTs',
  typescript: 'jsTs',
  python: 'pythonRuby',
  ruby: 'pythonRuby',
  go: 'goRust',
  rust: 'goRust',
};

export function runPolicyGroupFor(language: string): RunPolicyGroup | undefined {
  return GROUP_BY_LANGUAGE[language];
}

export function isRunPolicy(value: unknown): value is RunPolicy {
  return typeof value === 'string' && (RUN_POLICIES as readonly string[]).includes(value);
}

/** Debounce for the language's policy: null is Manual, undefined means no group. */
export function runPolicyDelayMs(language: string, policies: RunPolicyByGroup): number | null | undefined {
  const group = runPolicyGroupFor(language);
  return group === undefined ? undefined : DELAY_MS[policies[group]];
}

/** Keeps known groups with a known policy; the rest fall back to the defaults. */
export function sanitizeRunPolicyByGroup(value: unknown): RunPolicyByGroup {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const policies = { ...DEFAULT_RUN_POLICY_BY_GROUP };
  for (const group of RUN_POLICY_GROUPS) {
    const candidate = source[group];
    if (isRunPolicy(candidate)) policies[group] = candidate;
  }
  return policies;
}
