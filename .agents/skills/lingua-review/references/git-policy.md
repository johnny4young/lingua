# Git policy — lingua-review

The reviewer mutates **nothing** in git. The implementer's index is
sacred. Reviewer fixes go to the **unstaged** worktree so the human
can inspect both layers separately.

## Forbidden — zero git writes

Never run any of:

- `git commit` (any form, including `--amend`).
- `git add` (in any form — no `git add .`, no `git add -A`, no
  `git add -p`).
- `git reset` (soft / mixed / hard).
- `git restore` (with or without `--staged`).
- `git checkout` against modified files.
- `git stash`, `git rebase`, `git merge`, `git cherry-pick`,
  `git clean`.
- `git config` (any subcommand that writes — `--unset`, `--add`,
  setting a key).
- Any hook-skipping flag: `--no-verify`, `--no-gpg-sign`,
  `-c commit.gpgsign=false`. Hook failures investigate the root
  cause; never bypass.

## Allowed — read-only git only

Use as often as needed:

- `git status`, `git diff`, `git diff --cached`, `git diff --stat`.
- `git log` (any flags), `git show`, `git blame`.
- `git ls-files`, `git rev-parse`, `git config --get` (read-only get).

## Why the index is sacred

The implementer ran `git add` on their work. The diff visible at
`git diff --cached` is the diff the implementer **intended**. If the
reviewer added or removed files there, the human would lose the
ability to attribute work — they could no longer see "what landed
because the implementer wrote it" vs "what landed because the
reviewer fixed it".

Two physical layers, separately inspectable:

- `git diff --cached` → implementer's diff (untouched).
- `git diff` → reviewer's fixes (unstaged).

The human chooses how to combine them by running `git add` themselves
after reading both. They can stage all reviewer fixes, stage some,
or restore others — the agent does not pre-commit that decision.

## End-of-review handover

When the review is complete:

1. Print the report exactly per `references/report-template.md`.
2. Print the suggested commit message in chat.
3. Stop. Do not run `git commit`. Do not stage your fixes.

The human pastes the message, runs `git add` on whichever fixes they
accept, and commits.

## Why this shape

The unstaged-fixes worktree gives the human a second physical layer
to inspect, accept, or reject independently. Splitting the layers
this way preserves provenance — without it, the diff the human reviews
would no longer be the diff the implementer authored.
