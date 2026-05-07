# Lingua — press kit

Single source of truth for every Phase 2 launch asset. When the website
(RL-063) ships the downloadable ZIP at `linguacode.dev/press`, it builds
directly from this directory.

## Contents

- `boilerplate.md` — company + product descriptions at three lengths
  (25, 50, 150 words). Copy paste into articles and outreach.
- `pricing-one-pager.md` — Free / Monthly / Pro / Education matrix
  for press and partners.
- `founder-bio.md` — short + medium founder bio.
- `launch-copy.md` — drafts for Show HN, Product Hunt, r/golang,
  r/rust, r/Python.
- `assets/` — canonical icons, logos, and screenshots. **Stay
  empty in git** until the final shoot; check in only
  production-ready PNG/SVG/MP4 to avoid bloating history with WIP
  files.

## Rules for every file here

1. **Nothing can be more than one hop from reality.** If a feature is
   not shipped, do not claim it. Use the phrase "Lingua today" and
   anchor to the [PLAN.md](../PLAN.md) RL entries.
2. **Match the posture in `LICENSE`.** Source-available commercial —
   never claim "open source" or "MIT".
3. **Pricing matches [PLAN.md](../PLAN.md) Section 13** (Free,
   Monthly, Pro, Education). If any of these change, update this kit
   in the same commit.
4. **Spanish mirror**: every customer-facing string file ships `en`
   and `es` variants in the same file, delimited by `## English` /
   `## Español` headers.
