# Local MCP security model

Lingua can expose the currently approved desktop project to local MCP clients.
This document defines the security boundary for that integration before any
additional tool is added.

## Product contract

The server is:

- **desktop-only** and absent from the web adapter;
- **off by default** and started only after an explicit acknowledgement in
  Settings;
- bound to `127.0.0.1` on an ephemeral port, never to a LAN interface;
- authenticated with a cryptographically random, session-only bearer token;
- bound to exactly one live project `rootId` capability and one Electron
  renderer owner;
- read-only: it cannot write, delete, execute, install, spawn, fetch, or access
  arbitrary host paths;
- stopped when the project capability is revoked, the renderer is destroyed,
  the user presses Stop, a replacement server starts, or the app quits.

Stopping and restarting the server rotates both its port and token. Neither is
persisted, logged, included in telemetry, or copied without a user action.

## Threat model

| Threat                                                    | Boundary or mitigation                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote host reaches the server                            | Listen only on `127.0.0.1`; never accept a configurable bind address.                                                                                                                |
| Malicious website targets localhost through DNS rebinding | Validate `Host` and every present `Origin` header against loopback names before authentication or protocol parsing.                                                                  |
| Untrusted local process probes the endpoint               | Require a 256-bit bearer token and compare it in constant time. Return the same unauthorized response for missing and incorrect tokens.                                              |
| Client escapes the selected project                       | Resolve every tool path through the existing `rootId` capability chokepoint, including symlink containment checks, on every call.                                                    |
| Client reads common secret files                          | Refuse known secret-bearing names and private-key extensions even inside the project. The consent copy still states that source code itself may contain secrets.                     |
| Oversized or binary input exhausts memory                 | Bound HTTP bodies, request concurrency, path/query lengths, tree entries, search matches, file sizes, and returned bytes. Refuse binary reads.                                       |
| MCP client mutates or executes project code               | Register read-only tools only and mark them with read-only, idempotent, closed-world annotations. No shell, runner, network, write, prompt, or elicitation capability is registered. |
| Stale token survives a lifecycle change                   | Keep the runtime and token in main-process memory and stop it on root revoke, renderer destruction, replacement, and app quit.                                                       |
| Compromised renderer silently broadens authority          | Main validates the explicit acknowledgement flag, known `rootId`, owner, and lifecycle. Tool definitions are fixed in main and cannot be supplied by the renderer.                   |

## Protocol surface

Lingua uses the official TypeScript SDK and one Streamable HTTP endpoint at
`/mcp`. The entry supports the current stateless protocol and the SDK's
stateless compatibility path for 2025-era clients. No legacy HTTP+SSE endpoint
is added.

The initial tool set is deliberately small:

| Tool                    | Purpose                                                   | Limits                                                                                                  |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lingua_project_info`   | Describe the approved project and server posture.         | No absolute path or capability token is returned.                                                       |
| `lingua_list_files`     | List visible files and directories below a relative path. | Bounded depth and entry count; hidden build/vendor directories and secret-bearing paths are omitted.    |
| `lingua_read_file`      | Read a UTF-8 text slice from one relative file.           | Bounded offset and byte count; binary and secret-bearing files are refused.                             |
| `lingua_search_project` | Literal text search below a relative path.                | Bounded query, files, file size, matches per file, and total results; secret-bearing paths are omitted. |

Tool failures return stable, non-sensitive messages. They never include an
absolute path, bearer token, `rootId`, raw exception stack, or file contents
outside a successful bounded read/search result.

## Permission-promotion rule

Read-only access is the maximum authority of this band. A future write,
execution, network, or package-management tool requires a separate reviewed
change that adds all of the following:

1. a user-visible per-capability permission rather than one broad toggle;
2. a main-process policy and request-time authorization check;
3. destructive/open-world MCP annotations that match the real behavior;
4. revocation and in-flight cancellation semantics;
5. focused abuse tests plus packaged desktop validation;
6. updated consent copy and this threat model.

Being on loopback or possessing the read token is not sufficient authorization
for a future privileged capability.

## Validation requirements

The release gate for this surface includes:

- direct tests for authentication, Host/Origin rejection, request limits, path
  traversal, symlink escape, secret-file denial, tool bounds, and lifecycle;
- a real SDK client journey that lists and calls the tools against a temporary
  approved project;
- typed IPC and preload contract checks;
- English and Spanish Settings smoke with both stopped and running states;
- Electron desktop smoke, because the web build intentionally has no server;
- package/license/audit gates for the official MCP SDK dependencies.
