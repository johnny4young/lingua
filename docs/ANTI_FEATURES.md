# Lingua anti-features

> A product is defined as much by what it refuses to be as by what it
> ships. This document enumerates features Lingua intentionally does
> NOT have — and never will, without an explicit reversal recorded
> here.
>
> When an investor, contributor, or future maintainer proposes a
> feature on this list, the answer is "no" with a link to the
> rationale below. If the answer is genuinely "yes, we changed our
> mind", the row must be reversed in this file in the same commit
> that introduces the feature.

## Status

This file is **authoritative** for product-positioning rejections.
Inputs the planning system (`ROADMAP.md`, `PLAN.md`, `BACKLOG.md`,
`WORLD_CLASS_PLAN.md`) defer to it on conflicts.

## Anti-feature catalog

### A-001 Mandatory account or signup wall

Lingua's free tier MUST function with zero account creation. The Free
license is the default; Pro is an opt-in upgrade.

**Why:** local-first positioning is incompatible with required
identity. Tools that demand signup to open a scratchpad are
adversarial — they prioritize their funnel over the user's first 60
seconds.

**Concrete consequence:** every feature ships with a
zero-account-required path. Pro-gated features show the lock badge
inline (per the existing `FloatingActionPill` pattern), never as a
modal that blocks first use.

### A-002 Telemetry without opt-in

Telemetry MUST require explicit user consent. The default at install
is OFF. The Settings → Trust Dashboard must show the current state
plainly.

**Why:** developers are the audience most sensitive to silent
tracking. One leaked code field in a telemetry event would be a brand
event that takes months to recover from.

**Concrete consequence:** every new telemetry event ships with a
closed-enum payload + a source-parity test against `update-server`.
No string-keyed `properties: Record<string, unknown>`. No payload
bodies, code, request headers, prompts, env values, or file paths.

### A-003 Blockchain, NFTs, or crypto integrations

Lingua does not ship blockchain wallet integration, NFT minting, crypto
payments, or web3 namespace resolution.

**Why:** the audience overlap with our target user (developers who
want a polyglot scratchpad) is small enough that any crypto feature
would alienate more users than it attracts. The maintenance and
abuse surface (rug-pull attempts, scam contracts, regulatory drift)
is non-trivial.

**Concrete consequence:** payments stay credit-card via Polar (already
shipped under RL-061). No wallet connect. No on-chain anything.

### A-004 Social-network features

Lingua is not a social network. No follow/unfollow, no public
profiles, no DMs, no comments, no upvote/downvote, no public activity
feeds.

**Why:** the moderation surface for any of these is enormous. They
also pull product attention away from the core differentiator
(workspace) toward a content-platform shape we do not want to be.

**Concrete consequence:** RL-106 (curated community snippets, Phase
A) explicitly ships as a curated catalog, NOT a marketplace. Users
contribute via PR review, not in-app submit. No comments or upvotes
on snippets in any phase before a formal reversal of this rule.

### A-005 Ads, sponsored content, or affiliate links

Lingua does not show advertising. Pricing pages do not show
"compare to competitor" affiliate links. The Marketing site
(`linguacode.dev`, separate repo) follows the same rule.

**Why:** ads in a developer tool kill trust permanently. The revenue
model is straightforward Pro/Team subscriptions.

**Concrete consequence:** any new growth feature (newsletter signup,
"download our other tool" cross-promotion, etc.) ships as
zero-attribution and zero-pixel.

### A-006 Mandatory cloud sync

User data — snippets, capsules, settings, license — MUST function
locally without cloud. Cloud sync is opt-in for users who want it,
never required.

**Why:** local-first is the positioning. A user with no internet
should be able to open Lingua, edit a snippet, run it, and quit
with zero degraded functionality.

**Concrete consequence:** every persisted store lives in
`localStorage` first. Cloud sync (when it eventually ships) is
additive — a backup destination, not the primary store.

### A-007 AI without citations or explicit user action

AI-generated code MUST NOT auto-insert. AI responses MUST show what
context was used (cited sources). AI features MUST be opt-in at the
feature level AND at the per-request level (the prompt preview UI
described in RL-031 Slice 2).

**Why:** AI without provenance is unsafe in a coding environment.
Auto-insert is a footgun for inexperienced users and an annoyance
for experienced ones.

**Concrete consequence:** the AI response component always renders
`{ answerMarkdown, citations, suggestedActions }`. The `actions`
require an explicit click ("Copy", "Insert at cursor", "Open cited
doc"). The "auto-apply" pattern from other AI tools is forbidden.

### A-008 Background network calls

Lingua does not make network calls the user did not initiate. License
verification at startup is a known exception (documented in
`docs/USAGE.md`); update checks are visible via the existing
UpdateReadyChip. Beyond those two, every network call is user-initiated.

**Why:** silent network calls in a developer tool break the
local-first claim and create attack surface (CDN compromise, DNS
hijack, MitM).

**Concrete consequence:** the Trust Dashboard (RL-096) lists every
known network feature with its state and last-call timestamp. No
analytics beacons. No prefetching from third-party CDNs. The
Pyodide and Ruby WASM runtimes self-host from the renderer build
output (RL-083, RL-042 Slice 5).

### A-009 Hidden project-wide AI context

When the user invokes AI on a snippet, only that snippet + explicitly
selected supporting context (cited local docs per RL-031 Slice 2)
travels to the model. Unrelated tabs, file tree, environment
variables, and license details NEVER leave the renderer by default.

**Why:** users who paste sensitive code into a snippet must trust
that running AI on a DIFFERENT snippet does not exfiltrate the
sensitive one.

**Concrete consequence:** the AI prompt preview UI shows the exact
context list. Users can remove items before sending. The default
context is "this tab only".

### A-010 Cloud relay for collaboration before LAN ships

LAN Collaboration (RL-050 Phase A) ships first. Cross-internet
pairing (Phase B) only ships after LAN proves the threat model,
share-preview UI, and redaction contract.

**Why:** the worst case for collaboration is a public Lingua URL
leaking secrets via screen-sharing. LAN is constrained enough that
the threat surface is bounded; cross-internet adds transport + auth +
abuse vectors that double the work and the risk.

**Concrete consequence:** no cross-internet pairing code lands until
the Phase A ADR + LAN implementation ship.

### A-011 Mobile authoring

Lingua's mobile companion (RL-105) is read-only. No mobile editor.
No mobile run. Mobile users browse capsules + shared snippets;
authoring happens on a real keyboard.

**Why:** code is keyboard-first. A mobile-authoring UX is its own
multi-month project and would dilute the core. Read-only mobile is
useful for "did my CI snippet pass?" and "show this trick on the
go" — both of which are 80% of mobile demand without 99% of the
build cost.

**Concrete consequence:** the PWA at `m.linguacode.dev` (or
equivalent) renders capsules + shared links read-only. No edit
affordance. No "open in Lingua desktop" deep link until desktop deep
links are signed (RL-040).

### A-012 Hosted-credit AI pool

Lingua does not run a credit-pool hosted-LLM service ("bring your
own usage, we charge").

**Why:** that's a separate business with separate liability (token
metering, prompt logging, terms of service for AI providers,
content moderation when users paste sensitive code). Each is a
multi-quarter commitment that pulls the team away from the
workspace.

**Concrete consequence:** AI is local-first (Ollama, RL-031 Slice
0/1) with optional WebGPU on web (RL-104, behind feature flag).
Bring-your-own-key for hosted providers (OpenAI, Anthropic) is a
future possibility but explicitly NOT a Lingua-hosted credit pool.

### A-013 Real-time multi-cursor editing

Lingua does not ship Google-Docs-style real-time collaborative
editing. LAN collaboration (RL-050) is read-only Phase A; Phase B
adds cross-internet pairing but still read-only.

**Why:** multi-cursor editing is a one-year build (CRDT, presence
indicators, conflict resolution, network protocol, abuse). Live
Share style "give me view-only access" covers the actual use case
(interviews, pair debugging, classroom demos) without the cost.

**Concrete consequence:** the host has the single edit cursor; the
guest sees code + run output. Forking the host's state into the
guest's local Lingua is the path to "ok now I want to edit too".

### A-014 Plugin marketplaces with arbitrary code execution

Lingua's plugin system (RL-038, the built-in language pack registry)
ships only bundled plugins. There is no community plugin
marketplace that loads arbitrary JS at runtime.

**Why:** every plugin marketplace eventually becomes a malware
distribution channel. The maintenance and review cost of vetting
community plugins is enormous and we are too small to do it
responsibly.

**Concrete consequence:** community contributions land via PR review
into the Lingua repo. They ship with the next release. No remote
loading of plugin code.

### A-015 VSCode keybinding emulation as a goal

Lingua respects VSCode-style shortcuts where they are industry
standard (Cmd+P for Quick Open, Cmd+Shift+P for Palette, Cmd+/ for
comment toggle). We do not pursue VSCode parity as a goal.

**Why:** chasing parity is a never-ending tax. Lingua's positioning
is "the scratchpad you wished VSCode was for ad-hoc code". Parity
would dilute that.

**Concrete consequence:** keymap presets ship for common
environments (VSCode, Sublime, Vim/Monaco-vim). Beyond presets, the
user customizes shortcuts via Settings (RL-074). No "VSCode 100%
compatibility" claim ever.

## Reversal protocol

If one of these rules ever ships in reverse:

1. Mark the row above as "REVERSED on YYYY-MM-DD — see RL-XXX" with
   a strikethrough.
2. Add a new section to the bottom of this file explaining the
   reversal rationale and the new commitment.
3. The change must land in the same commit as the feature that
   contradicts the rule.
4. Reversals require a documented product-decision sign-off in
   `docs/PLAN.md` under the relevant ticket.

The default is to refuse the reversal. This file is intentionally
hard to change.
