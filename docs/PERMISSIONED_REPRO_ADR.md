# Permissioned reproduction architecture decision

**Status:** Proposed (experiment, no shipped surface)

**Date:** 2026-10-29

## Context

A Run Capsule records what ran and what it printed, and `lingua capsule
replay`/`verify` rerun it with the current user's OS permissions. A source hash,
an environment allowlist, output caps and a timeout do not restrict what that
code can read, write or reach. Recipients of a reproduction from someone else
need a narrower contract: review what the code asks for, approve no more than
that, run it inside a boundary the workload cannot leave, and get evidence that
keeps "the output matched" apart from "the policy held".

This ADR fixes the data contract for that workflow and the first backend it
targets. It does not ship a command or a UI; those come after the backend passes
the adversarial fixtures below.

## Decision

### Artifacts

Two new versioned artifacts wrap the existing ones instead of changing them.
`RunCapsuleV1`, `CapsuleWorkspaceV1`, their migration chain and legacy replay
keep their current semantics.

- **`lingua-repro-envelope` v1** (`src/shared/reproEnvelope.ts`): one
  `RunCapsuleV1` (its source is the entry point, its result the expected
  output), the relative path the entry is staged at (`.mjs` or `.cjs`, so the
  module format never depends on a `package.json`), up to 24 supplemental files
  validated by the Capsule Workspace guards, the requested runtime (`node` plus a
  major version), and the requested policy. Unknown keys are rejected at every
  level the envelope owns.
- **`lingua-repro-receipt` v1** (`src/shared/reproReceipt.ts`): the digests the
  run was bound to, host identity (Lingua, OS, architecture, runtime, backend),
  whether launch was refused and why, per-control enforcement, the execution
  outcome, the existing strict comparison verdict, and denial evidence with its
  coverage.

Envelope paths must already be in Unicode NFC, and the entry may not match a
supplemental file, nor two files each other, once case is folded (`ß` and `ss`,
`ſ` and `s` included), because macOS file systems would stage both spellings
to one file. The staging writer still creates every file
exclusively, so a collision these checks miss fails instead of overwriting.

Neither artifact may contain an absolute host path, a capability id, a project
root, environment values or credentials. Denial records name a logical area
(`inputs`, `scratch`, `output`, or `outside`) and, inside the staging root, a
relative path; anything outside is recorded as `outside` with no path.

### Policy

`ReproPolicyV1` (`src/shared/reproPolicy.ts`) has a closed shape:

| Field                                     | Values in v1                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `filesystem.inputs`                       | `read-only` (staged source and files)                                                                       |
| `filesystem.scratch`, `filesystem.output` | `none` or `read-write`, both disposable                                                                     |
| `network`                                 | `deny` only; an allowlist needs its own ADR                                                                 |
| `limits`                                  | wall clock, output bytes (at most what the CLI captures unclipped), process count, optional memory and disk |
| `evidence.denials`                        | `required` or `if-available`                                                                                |

Three policies stay distinct:

1. **Requested**: what the envelope asks for. It never grants itself anything.
2. **Approved**: the meet of the request and the recipient's local ceiling.
   Every field takes the stricter side, so approval can only narrow.
3. **Effective**: the approved policy plus what one backend reports it can
   enforce, including ambient host access the backend needs (runtime binary, OS
   libraries). Ambient grants are host-specific and stay local.

Controls derived from the approved policy are required. Filesystem isolation,
network deny, process containment, wall clock, output and process limits are
always required; memory and disk limits are required when set; denial evidence
is required when the policy says so. A required control must be `enforced`.
`sampled` (a supervisor polling from outside) or `unsupported` refuses launch
before the workload starts. There is no fallback to an unsandboxed run, a wider
policy or a permissive audit mode.

### Approval binding

Approval is a pair of SHA-256 digests: the content digest (entry path,
runtime, stdin and arguments, the expected status and streams, and the capsule
source and each supplemental file recomputed from content) and the
approved-policy digest (canonical JSON). A content digest exists only when every
stored hash matches its recomputed content. Changing any byte of the inputs,
any policy field, or approving a policy wider than the request invalidates the
approval and requires a new review.

### Verdict

A receipt is summarized on separate axes so one cannot hide another:

- **output**: the existing strict verdict (`pass`, `fail`, `inconclusive`).
- **enforcement**: every required control was enforced, or there were gaps.
- **compliance**: `clean` (complete evidence, no denials), `violated` (any
  denial), or `not-observed` (evidence was partial or unavailable). A missing
  denial is never read as "no access was attempted".
- **evidence**: the coverage the backend reported.

The overall result is `refused`, `fail` (a denial or an output mismatch, even if
the program caught the error and printed the expected text), `incomplete`
(clipped output, a timeout or a stop, as in strict CLI verification; enforcement
gaps; required evidence not complete; collection failure; or an inconclusive
comparison), or `pass`. A denial outranks everything; an interrupted run
outranks an output mismatch.

Required controls and the evidence requirement come from the approved policy,
never from flags the receipt carries about itself. `checkReproReceipt` confirms
a receipt names the approved content and policy digests. It does not
authenticate its sender, attest a remote machine or prove code is safe.

### CLI surface

`lingua repro pack` builds an envelope from a capsule and chosen files,
`lingua repro review` verifies it and prints an approval token (SHA-256 over
the content and approved-policy digests), and `lingua repro run` needs that
token. The local ceiling is the default request until it becomes configurable,
so approval currently equals the request or something narrower. Backends plug
in through `src/cli/runtime/containment.ts`; a probe that throws counts as no
backend. On macOS the Seatbelt backend launches; elsewhere `run` refuses with
a receipt. `run` also refuses (`runtime-unavailable`) when the host Node.js
major differs from the one the envelope requests, and `review` says so first.
Review also shows the effective controls (support and required/optional status)
and the backend's ambient host grants before its approval hint. JSON exposes
`effectivePolicy`, or null when required controls are missing or no backend is
available, plus `ambientGrants` from any probed backend. Ambient grants remain
visible even when that backend cannot enforce the request. This output is
host-specific local review data, not part of the portable envelope or receipt.

### First backend: macOS Seatbelt

The issue proposed Windows with Microsoft Execution Containers first. The first
backend is macOS instead, because it can be built and tested end to end on the
development machine and on `macos-latest` CI. Windows and Linux stay follow-on
backends behind the same probe.

A spike on macOS 27.0.1 with Node 24.21 ran a script under `sandbox-exec` with a
deny-default profile. Reads outside the staging root and of `~/.ssh`, writes to
the staged source, spawning `/bin/cat`, and TCP to a public address all failed
with `EPERM`; writes to the output directory succeeded. Cold start was about
170 ms. The kernel enforces the profile and descendants inherit it.

Known limits that the backend probe must report honestly:

- **Denial evidence is unavailable.** Denials of a `sandbox-exec` process did
  not appear in the unified log, and SBPL rejects `(with report)` on deny rules.
  The backend reports `denial-evidence` as `unsupported`, so a policy with
  `evidence.denials: required` is refused on macOS, and an `if-available` run
  can reach `pass` with compliance `not-observed`, never `clean`.
- **Memory and disk are not enforced.** Node exposes no `setrlimit` and the
  supervisor does not poll, so the backend reports both as `unsupported`. A
  policy that sets either limit is refused.
- **The process limit is structural.** The profile denies `process-fork` and
  `process-exec` beyond the runtime binary, which enforces a limit of one
  process.
- **`sandbox-exec` is deprecated** but still shipped and used by browsers and
  build tools. Its removal would make the backend report itself unsupported.

### Seatbelt profile and staging

The supervisor stages the entry and files into a fresh 0700 directory under
the OS temp directory, writing each file exclusively, reading it back,
re-hashing it and making it read-only. Scratch and output start empty, and the
whole root is removed after the run, also when the backend fails.

`src/cli/runtime/seatbelt.ts` compiles one profile per run: deny by default;
exec and read only the resolved Node binary; read the OS library paths Node
loads, `/dev/null` and the random devices, the staged inputs, and scratch and
output when approved; write only those approved areas and `/dev/null`; deny
all network. Node aborts at startup unless it can list `/` and stat paths we
cannot enumerate, so file metadata stays readable except under `/Users` and
`/Volumes`, where only the ancestors of the Node binary and the staging root
are re-allowed. These host grants are listed in the effective policy and its
digest. The workload gets only `HOME` and `TMPDIR`, both pointing at scratch.

## Validation before any user-facing surface

Each fixture has a host-side assertion; in-program errors alone are not proof.

1. Read a synthetic secret outside the staging root by absolute path and alias.
2. Modify a staged input; write outside the output area.
3. Traversal and symlink escapes during staging and execution.
4. TCP, direct IP, UDP/DNS and IPv6 under network deny, with test listeners.
5. Loopback and a synthetic local socket.
6. Children and grandchildren repeating denied operations.
7. Environment and runtime injection; synthetic home and config secrets.
8. Process, output, memory and disk exhaustion.
9. Edits to staged source or policy after review; forged or overwritten
   receipts.
10. Caught denials that still print the expected output, with evidence missing.

Positive controls cover allowed reads and writes and a matching reproduction.

The fixtures live in `tests/cli/runtime/seatbeltContainment.test.ts` and run
under the real sandbox in the macOS CI job. Exhaustion is covered for output
and wall clock; memory and disk are refused at review rather than tested.
Receipts are built in the supervisor's memory, so fixture 9 checks that the
workload cannot write beside its areas. Fixture 10 runs the full `repro run`
path and expects compliance `not-observed`, never `clean`.
The usability study from the proposal (five developers, benign and overbroad
capsules) decides whether the workflow ships at all.

## Consequences

- The contract is pure, shared and covered by unit tests; it executes nothing
  and adds no dependency.
- The CLI keeps its separation from Electron modules; the backend seam will sit
  beside `src/cli/runtime/execution.ts` and reuse its spawn, cap, timeout and
  process-tree cleanup.
- Web builds can inspect and validate envelopes and receipts but never claim to
  run them.
- Supporting another OS means adding a backend that reports its own control
  support; the envelope, policy and receipt do not change.

## Related

- [`CAPSULE_WORKSPACES.md`](./CAPSULE_WORKSPACES.md) — the file guards the
  envelope reuses.
- [`CLI_USAGE.md`](./CLI_USAGE.md) — trusted replay and strict verification,
  which keep their current semantics.
- [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) — the restricted desktop Deno
  path, the closest existing containment.
