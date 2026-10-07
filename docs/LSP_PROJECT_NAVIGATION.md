# Project definition and references

Desktop Go and Rust editors use the existing gopls and rust-analyzer adapters for Monaco's definition and references actions. Existing Monaco keybindings remain unchanged (including F12 definition); no global shortcut is added. Servers must be separately available on PATH. Lingua does not install them.

Navigation requires a file bound to the active authorized project. Main resolves the optional root capability before launching the server and supplies it in initialize. The server is started at the authorized root path as the user picked it, symlinks included, because that is the path the editor opens documents under; destinations and diagnostics a server still reports through the root's realpath are mapped back onto it. Switching projects replaces that context. Unbound scratchpads retain existing intelligence but do not promise project navigation. Browser builds and missing servers degrade without pretending to resolve destinations.

The server must declare definition/reference capabilities. Both Location and LocationLink responses are supported; links select targetSelectionRange. Main authorizes each destination using the same filesystem containment, sensitive-path and symlink rules as project reads. A server URI grants no permissions. External, malformed, revoked and directory destinations are rejected.

While a project context is active, main forwards editor requests and didOpen/didChange/didClose only for documents under the authorized root (or its realpath) and for unsaved scratch buffers; anything else is dropped before it reaches the server. Without a project context only the URI shape (a plain `file:` URI) is enforced. Every server request has a 30 second deadline: an unanswered request is cancelled with `$/cancelRequest` and fails instead of waiting forever.

Open dirty buffers are synchronized before navigation. Destination opening reuses an existing project tab rather than replacing its contents. Peek and Find All References need a Monaco model for every destination, so authorized destinations without one get a preview model (from the open buffer when a tab exists, otherwise read through the project capability). At most 50 preview models stay alive; they are disposed when the project changes and before a real tab for the same file becomes active, so the tab never adopts a stale preview. Cancelled responses and responses from changed documents/project contexts are discarded. Go and Rust models have stable per-tab URIs and owned models are disposed when their tabs close. Crash/restart invalidates document registration so the new server receives didOpen, not an orphaned didChange.

No external navigation, installer, call hierarchy or execution hook is included.

The pinned Monaco dependency has a narrow patch for owned delayed-task
cancellation during model handoff and reference-tree disposal. Unexpected errors
still reach Monaco's error handler; no global error or harness filtering is added.
Occurrence decorations, references and the existing editor options stay enabled.

Project documents remain open in the server while their tabs exist, including inactive dirty buffers. Switching focus does not close and reopen those documents; closing a tab, changing the root, or losing the server context drops ownership.

Destination opening rechecks that the requested buffer actually became active. A
refused or stale open never queues a selection for a later visit to that buffer.
