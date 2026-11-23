# Lingua — press kit

Single source of truth for every Phase 2 launch asset. When the website ships the downloadable ZIP at `linguacode.dev/press`, it builds
directly from this directory.

## Contents

- `boilerplate.md` — company + product descriptions at three lengths
  (25, 50, 150 words). Copy paste into articles and outreach.
- `pricing-one-pager.md` — Free / Monthly / Pro / Team / Education matrix
  for press and partners.
- `founder-bio.md` — short + medium founder bio.
- `launch-copy.md` — drafts for Show HN, Product Hunt, r/golang,
  r/rust, r/Python.
- Logo files are not kept here: `scripts/brand/generate-brand-assets.mjs`
  writes them from `assets/brand/` into `website/public/press/`, and the
  ZIP picks them up from there.

## Rules for every file here

1. **Nothing can be more than one hop from reality.** If a feature is
   not shipped, do not claim it. Use the phrase "Lingua today" and
   anchor every claim to features that have actually shipped.
2. **Match the posture in `LICENSE`.** Source-available commercial —
   never claim "open source" or "MIT".
3. **Pricing matches the published tiers** (Free, Monthly, Pro, Team,
   Education). If any of these change, update this kit
   in the same commit.
4. **Spanish mirror**: every customer-facing string file ships `en`
   and `es` variants in the same file, delimited by `## English` /
   `## Español` headers.
