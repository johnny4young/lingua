/**
 * Minimal `{{var}}` substitution helper for the email HTML
 * templates in `src/emails/*.html` (RL-061 Slice 4).
 *
 * Why hand-rolled instead of a templating library:
 *   - Each template uses ~5-10 vars. The full feature set of a
 *     templating engine (partials, helpers, conditionals) is not
 *     needed and would bloat the worker bundle.
 *   - Strict undefined-on-missing-var semantics catch typos at
 *     test time (snapshot test renders fail loudly) instead of
 *     silently shipping a broken email to a user.
 *   - Deterministic output makes snapshot tests reliable.
 *
 * The substitution is HTML-aware in only one way: it does not
 * escape the values. Templates inline values into safe-by-construction
 * positions (text content, href attribute) and the values
 * themselves come from server-controlled sources (license token,
 * issuedTo email, expiry date) — never from arbitrary user input
 * that could contain unescaped HTML. If a future template needs
 * untrusted content, add an explicit escape helper at that call
 * site.
 */

/**
 * Replace every `{{var}}` occurrence in `template` with the
 * corresponding value in `vars`. Throws on a missing variable so
 * the snapshot test catches the typo before deploy.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(
        `renderTemplate: missing variable "${name}". Provide it in the vars map or remove it from the template.`
      );
    }
    const value = vars[name];
    if (typeof value !== 'string') {
      throw new Error(
        `renderTemplate: variable "${name}" is not a string (got ${typeof value}).`
      );
    }
    return value;
  });
}

/**
 * Same as `renderTemplate` but returns a tagged-union result
 * instead of throwing. Handlers that compose multiple templates
 * can short-circuit on the first failure without try/catch.
 */
export function renderTemplateResult(
  template: string,
  vars: Record<string, string>
): { ok: true; html: string } | { ok: false; missing: string } {
  try {
    return { ok: true, html: renderTemplate(template, vars) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /missing variable "([^"]+)"/.exec(message);
    return { ok: false, missing: match?.[1] ?? 'unknown' };
  }
}
