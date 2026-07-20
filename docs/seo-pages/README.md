# SEO landing pages

Content scaffolds for the language-intent landing pages that
`linguacode.dev` will host:

- `/go-playground-desktop/`
- `/rust-code-runner-desktop/`
- `/python-repl-desktop/`
- `/typescript-playground-offline/`
- `/multi-language-code-runner/`
- `/lua-offline-playground/`

The scaffolds live in this directory as Markdown + front-matter so the
website build can pick them up directly. Shape is static-site friendly
(Astro, Next static export, Eleventy — anything that reads Markdown
plus YAML front-matter).

## Shared rules — read before editing any page here

1. **Every claim has to match shipped reality**. The internal acceptance
   line is explicit: "every page must say something true about
   Lingua's real support for that language, or we do not ship the
   page." Cross-check against features that have actually shipped
   before adding a feature claim.
2. **Front-matter is strict**. Required keys: `title`, `description`
   (<=160 chars for the meta tag), `canonical`, `ogImage`,
   `language` (the intent this page targets). Missing keys should
   fail the website build.
3. **Every page links back to the canonical download** on
   `https://linguacode.dev` and renders the same "download" CTA string
   so SEO doesn't see near-duplicate CTAs diverge per page.
4. **Honest limitations section is required**. No marketing without a
   matching "what doesn't work today" paragraph — this is the
   difference between SEO that ranks and SEO that gets flagged as
   content-farming.
5. **Schema.org `SoftwareApplication` JSON-LD** is appended by the
   website build; these scaffolds only own the prose.

## Files

- `go-playground-desktop.md`
- `rust-code-runner-desktop.md`
- `python-repl-desktop.md`
- `typescript-playground-offline.md`
- `multi-language-code-runner.md`
- `lua-offline-playground.md`

Each file is its own page. The website build inherits a shared header,
nav, and footer — pages own only `<main>`-level content and the
front-matter.
