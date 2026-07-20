# Guided lessons

Content scaffolds for the first batch of guided lessons. The
interactive lesson UI ships in a later work (depends on internal
Snippet Lab + internal multi-file). Until then, these lessons are
read-only Markdown that the future runner will pick up directly —
the schema in this README is the contract that future tooling
relies on.

## Lesson schema

Every lesson file ships with YAML front-matter:

```yaml
---
id: 01-javascript-loops-and-arrays
language: javascript
title: "Loops and arrays in JavaScript"
estimatedMinutes: 8
prerequisites: []
---
```

Required keys: `id`, `language`, `title`, `estimatedMinutes`,
`prerequisites`. The `id` is the file stem; `language` matches a
`LanguagePack.id` from `src/shared/languagePacks.ts`.

The body is structured as Markdown sections with one fixed shape:

```
## English

### What you will build
### Starter code
### Walkthrough
### Try it yourself
### What you learned

## Español

### Lo que vas a construir
### Código inicial
### Paso a paso
### Inténtalo tú
### Lo que aprendiste
```

Both locales must be present in every lesson. The future runner
picks the section based on `i18next` active language at lesson
launch.

## Content rules

1. Every claim has to match a feature that ships **today**. If a
   lesson references an entitlement that's behind a paid tier, it
   must say so explicitly.
2. Code blocks fenced with the language id (` ```javascript`,
   ` ```typescript`, ` ```python`, ` ```go`, ` ```rust`) so the
   future runner can pipe the starter code into the right runtime
   without a parser.
3. No external network calls in starter code — Lingua is offline-
   first, and a lesson that requires `fetch` against a public
   endpoint regresses the offline guarantee.
4. Every lesson ends with a `## What you learned` (or `Lo que
   aprendiste`) so the future progress-tracking layer can record
   the take-aways without scraping prose.

## Files

- `01-javascript-loops-and-arrays.md`
- `02-typescript-generic-functions.md`

Each file is its own lesson. The future lesson runner inherits
shared chrome (lesson list, progress bar, "Run starter" button)
from the React app — these scaffolds own only the content.

## When to expand

Add the next lesson when the existing two ship in the runner UI
and customer feedback names the language they want next. Do not
add lessons for languages whose runners are blocked on internal
(JS/TS runtime modes) or internal (debugger MVP) — the lesson
content will outrun the platform that runs it.
