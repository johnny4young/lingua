/** How one local differs from the pause before it. */
export type LocalChange = { readonly kind: 'new' } | { readonly kind: 'changed'; readonly before: string };

type Locals = Readonly<Record<string, string>>;

/** The locals that are new or hold a different value since `previous`; none on the first pause. */
export function localsChanges(previous: Locals | null | undefined, current: Locals): Map<string, LocalChange> {
  const changes = new Map<string, LocalChange>();
  if (!previous) return changes;
  for (const [name, value] of Object.entries(current)) {
    if (!Object.hasOwn(previous, name)) changes.set(name, { kind: 'new' });
    else if (previous[name] !== value) changes.set(name, { kind: 'changed', before: previous[name]! });
  }
  return changes;
}

/** Locals in the order they had at the previous pause, new ones after, so rows do not jump between steps. */
export function orderedLocals(previous: Locals | null | undefined, current: Locals): [string, string][] {
  const names = Object.keys(current);
  if (!previous) return names.map((name) => [name, current[name]!]);
  const known = Object.keys(previous).filter((name) => Object.hasOwn(current, name));
  const added = names.filter((name) => !Object.hasOwn(previous, name));
  return [...known, ...added].map((name) => [name, current[name]!]);
}
