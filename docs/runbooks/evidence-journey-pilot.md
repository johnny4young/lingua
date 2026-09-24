# Evidence journey pilot protocol

This is a **script for a future moderated pilot**, not evidence that any
participant, production traffic, or public deployment has been validated.
Recruiting, consent, and running the sessions are external to the PR review.
The public [English](https://linguacode.dev/docs/reproducible-run) and
[Spanish](https://linguacode.dev/es/docs/reproducible-run) walkthroughs are the
task instructions; use a preview build while the site changes are unmerged.

## Setup and consent

- Recruit up to five participants across browser and desktop familiarity; do
  not report a sample size until the sessions actually occur.
- Ask explicit consent before screen recording, screenshots, or notes. A
  participant may decline recording or stop at any time without penalty.
- Use the deterministic JavaScript example only. Do not ask participants to
  paste employer code, credentials, personal files, tokens, or real project
  paths. Provide a synthetic sample folder for any CLI command.
- Tell participants that a Run Capsule contains source and possibly output;
  review its JSON locally before sharing. Never upload it to a research tool.
- Use a disposable profile and do not enable telemetry or paid trials just to
  conduct the pilot. If a paid tier is needed for a separate variant, use a
  synthetic local license and mark that variant separately.

## Moderator prompts

Do not coach the participant through a blocked step until recording the
blocker. Ask what they expect before revealing the result.

1. Open the app from the website and identify what runs in Browser versus
   Desktop. Record whether the Free/paid distinction is understood.
2. Replace the JavaScript tab with `const x = 1 + 2; console.log(x);` and
   run it. Ask where the output appears.
3. Replace it with `throw new Error('demo failure');`, run again, and ask
   what failed. Observe whether the console/error affordance is found.
4. Restore the first snippet and run again. Ask what changed and whether the
   prior error is still misleadingly shown as the current result.
5. Save the latest Run Capsule JSON. Ask which fields need review before
   sharing. If the clipboard is unavailable, observe whether the file path
   remains discoverable.
6. In a synthetic folder, ask the participant to choose the safe CLI command
   first. `lingua capsule validate` must be understood as non-executing.
   Explain that `lingua capsule replay` is a separate, trusted-code action
   with OS permissions; never execute an uninspected file.
7. Ask whether Desktop local MCP can run code. The correct boundary is
   read-only project access, not CLI replay or agent dispatch.

## Record only bounded evidence

For each consenting session, record an anonymous session label, platform,
language, completion time per step, success/abandonment, blocker category,
misunderstood wording, and a brief paraphrased observation. Record the
participant's consent status separately from task results. Do **not collect
source code**, Capsule payloads, project paths, tokens, email addresses, or
identifiable screen captures. Keep raw notes local under the research access
policy; publish only aggregated counts and actionable wording changes.

The pilot is successful as a learning exercise if the team can identify and
prioritize the highest-friction step; there is no invented conversion target.
Do not claim user validation in a PR merely because this protocol exists.
