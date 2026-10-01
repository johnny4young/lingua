# Project definition and references

Desktop Go and Rust editors use the existing gopls and rust-analyzer adapters for Monaco's definition and references actions. Existing Monaco keybindings remain unchanged (including F12 definition); no global shortcut is added. Servers must be separately available on PATH. Lingua does not install them.

Navigation requires a file bound to the active authorized project. Main resolves the optional root capability before launching the server and supplies it in initialize. Switching projects replaces that context. Unbound scratchpads retain existing intelligence but do not promise project navigation. Browser builds and missing servers degrade without pretending to resolve destinations.

The server must declare definition/reference capabilities. Both Location and LocationLink responses are supported; links select targetSelectionRange. Main authorizes each destination using the same filesystem containment, sensitive-path and symlink rules as project reads. A server URI grants no permissions. External, malformed, revoked and directory destinations are rejected.

Open dirty buffers are synchronized before navigation. Destination opening reuses an existing project tab rather than replacing its contents. Cancelled responses and responses from changed documents/project contexts are discarded. Go and Rust models have stable per-tab URIs and owned models are disposed when their tabs close. Crash/restart invalidates document registration so the new server receives didOpen, not an orphaned didChange.

No external navigation, installer, call hierarchy or execution hook is included.

The pinned Monaco dependency has a narrow patch for owned delayed-task
cancellation during model handoff and reference-tree disposal. Unexpected errors
still reach Monaco's error handler; no global error or harness filtering is added.
Occurrence decorations, references and the existing editor options stay enabled.

Project documents remain open in the server while their tabs exist, including inactive dirty buffers. Switching focus does not close and reopen those documents; closing a tab, changing the root, or losing the server context drops ownership.
