# Notebook project documents

Open a selected `.linguanb` file with Open File (Cmd/Ctrl+O) or from the project
tree. A Pro notebook opens as a notebook, not JSON text, preserving v1 IDs,
per-cell JS/TS/Python/SQL languages, markdown, outputs and execution order.
Opening/importing never runs code. Reopened outputs are stale evidence: refresh
explicitly to recompute them, and do not assume kernel variables survived.

Use Save (Cmd/Ctrl+S) for a bound file, or Save As (Cmd/Ctrl+Shift+S) to select a
new destination. Notebook toolbar buttons expose the same actions. Disk saving
is manual only. Export/download keeps its existing behavior but does not bind a
file or mark a project document saved. Existing notebook entitlements apply.

A changed disk file produces a conflict, retaining edits in memory. Reload only
if discarding those edits is intended; otherwise Save As preserves both versions.
Cancellation, write errors and revoked permissions also preserve the document.
Edits arriving while Save is in flight remain dirty after that snapshot is saved,
and close will not discard them. Project-watch reload requires confirmation for
dirty notebooks and removes the old runtime heap.

Desktop stages a temporary file and replaces it by rename. Chromium uses File
System Access handles and close-to-commit, not an atomic rename promise. Browsers
without a save picker cannot save a project document; export remains a separate
download. Web handle grants do not survive app reload: session recovery retains
cells/output evidence, but reselect a file with Save As before saving again.
Document v1 and existing import/export formats remain unchanged. Local recovery
is not disk autosave, a backup service, or a guarantee against external-process
races; expected hashes detect optimistic conflicts at commit time.

Mounted code and markdown drafts flush before manual save and close, including edits made within the normal persistence debounce. Occurrence highlighting is disabled only in ephemeral notebook cell editors to avoid Monaco cancellation errors during blur disposal; completion, hover and diagnostics remain enabled.

Notebook document buffers never enter Scratchpad auto-run; cells execute only through the notebook kernel and explicit notebook controls.

A running cell holds its shared JavaScript or Python runner: editor auto-run waits for it, a manual editor run on that runtime shows a notice instead of terminating it, and notebook Stop or close stops only the runner the cell holds. A cell does not start while a manual editor run uses its runtime.

Disk-save actions and notebook writer logic load only after an explicit save gesture; initial dirty tracking does not eagerly load the writer.

Manual save freezes the persistible document at the gesture, after flushing mounted drafts and before lock queueing or lazy imports. Later edits remain in memory and dirty even while the action module is loading.

Queued file opens preserve the optional navigation-context guard before focusing an existing buffer and after asynchronous reads/parsing. An old request cannot refocus a buffer after the active document or project changes.
