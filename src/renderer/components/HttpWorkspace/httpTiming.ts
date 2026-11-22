import type { HttpResponseTiming } from '../../../shared/httpWorkspaceSchema';

const PHASES = [
  { key: 'dnsMs', label: 'dns', color: 'var(--color-border-strong)' },
  { key: 'connectMs', label: 'connect', color: 'var(--color-border-strong)' },
  { key: 'tlsMs', label: 'tls', color: 'var(--color-syntax-function)' },
  { key: 'waitingMs', label: 'waiting', color: 'var(--color-accent)' },
  { key: 'downloadMs', label: 'download', color: 'var(--color-success)' },
] as const satisfies ReadonlyArray<{ key: keyof HttpResponseTiming; label: string; color: string }>;

/** The measured phases of the hop that answered, named in the current language. */
export function timingPhases(timing: HttpResponseTiming, t: (key: string) => string) {
  return PHASES.map((phase) => ({ ...phase, ms: timing[phase.key], name: t(`httpWorkspace.response.timing.phase.${phase.label}`) }));
}

/** `DNS 8 · Connect 21 · … ms`, the split in one line. */
export function timingSummary(phases: ReadonlyArray<{ name: string; ms: number }>): string {
  return `${phases.map((phase) => `${phase.name} ${phase.ms}`).join(' · ')} ms`;
}
