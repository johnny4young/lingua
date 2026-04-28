# Git policy — lingua-ship

Hard rule applied across both phases of the workflow.

## Single mutating command allowed

`git add <paths>` is the only mutating git command authorised. Use it
to group the ticket diff plus any inline collateral fixes into one
coherent staging area for the human to commit.

## Forbidden mutating commands

- `git commit` (in any form, including `--amend`, `--no-verify`).
- `git reset` (in any form, soft / mixed / hard).
- `git restore --staged` and `git restore <path>` (no unstaging, no
  worktree wipes).
- `git checkout` against modified files (no discarding the implementer's
  changes mid-flight).
- `git stash`, `git rebase`, `git merge`, `git cherry-pick`, `git clean`,
  `git push --force`.
- Hook-skipping flags: `--no-verify`, `--no-gpg-sign`, `-c
  commit.gpgsign=false`. Hook failures investigate the root cause, never
  bypass.

## Read-only git is unrestricted

Run as often as needed for self-review:

- `git status`, `git diff`, `git diff --cached`, `git diff --stat`.
- `git log` (any flags), `git show`, `git blame`.
- `git ls-files`, `git rev-parse`, `git config --get` (read-only get).

## End-of-ticket handover

When the ticket is ready:

1. Print the suggested commit message in chat (single, unified —
   covers ticket + docs sync + every collateral fix).
2. Print the ticket closure report and the Review Guide block (see
   `references/review-guide-template.md`).
3. Stop. The human pastes or adapts the message and runs `git commit`
   themselves.

The agent never amends, never splits the commit into pieces, never
force-pushes, and never adds AI co-authorship trailers.

## Why this shape

The single staged diff respects the human's review-before-commit
cadence. Splitting the commit is the human's prerogative via
`git add -p` after review. Forbidding `git restore` and `git checkout`
prevents the agent from silently discarding work it didn't author.
The read-only allowance keeps self-review fast without giving up
control of the index.
