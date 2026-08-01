# SEO landing pages

Canonical English content for the bilingual language-intent landing
pages hosted by `linguacode.dev`:

- `/javascript-code-runner-desktop/`
- `/typescript-playground-offline/`
- `/python-repl-desktop/`
- `/go-playground-desktop/`
- `/rust-code-runner-desktop/`
- `/multi-language-code-runner/`
- `/lua-offline-playground/`

The website sync copies these Markdown files into
`website/src/content/seo/en/`. Spanish translations live beside the
vendored copy in `website/src/content/seo/es/`.

## Shared rules

1. **Every claim must match shipped reality.** Cross-check
   `docs/CAPABILITY_MATRIX.md`, the shared language-support profiles,
   and entitlement policy before adding a feature claim.
2. **Front matter is strict.** Required keys are `title`, `description`
   (160 characters or fewer), `canonical`, `ogImage`, and `language`.
3. **English and Spanish slugs stay in parity.** Every canonical is
   slashless, matching Astro's `trailingSlash: 'never'` route exactly.
4. **Every page links to the canonical Lingua download surface.**
5. **An honest limitations section is required.** Public copy must not
   leak planning identifiers or use an unshipped capability as a
   promise.
6. **Schema.org `SoftwareApplication` JSON-LD** is appended by the
   website layout.

Run `npm run check` from `website/` after syncing. The SEO content gate
checks locale parity, front matter, canonical URLs, required sections,
vendored-source drift, and known stale claims before Astro validates the
site.
