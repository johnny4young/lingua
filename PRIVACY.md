# Privacy

Lingua is designed around local-first code execution. User code, local file
contents, project paths, environment variables, snippets, and console output are
not telemetry payloads.

## What Stays Local

- code typed into the editor
- local project files and paths
- snippets, keyboard shortcuts, themes, and layout preferences
- execution history snapshots
- environment variables configured for runners
- console output and runtime errors from user code
- hosts the network policy blocked or the user allowed, with the runtime and the host only

## Telemetry

Telemetry is opt-in. If the user does not consent, telemetry stays disabled.
Build-time kill switches can also disable telemetry regardless of user choice.

When enabled, telemetry is limited to allow-listed product events such as
feature usage and runner status. Payloads pass through a redaction layer before
leaving the app and must not include user code, file paths, environment values,
license tokens, or arbitrary exception payloads.

## Crash Reporting

Crash reporting is opt-in and disabled when no crash endpoint is configured.
Crash reports are intended for app stability diagnostics and must not be used as
a channel for code, file content, or license-token collection.

## License And Device Checks

Paid-tier activation uses signed license tokens. Tokens are verified locally and
may be checked against `licenses.linguacode.dev` for activation, status refresh,
device-limit enforcement, recovery, trials, and education access.

The license service tracks device identifiers and coarse device metadata needed
to enforce license limits and show removable devices in Settings. License tokens
are sent in authorization headers, not URL query strings.

## AI Features

Explain error, Explain selection, Edit with AI, Ask AI in SQL and the cron
phrase composer are off until you set a model in Settings. Lingua ships no
remote endpoint or key, and sends nothing until you choose Send after seeing
the exact payload. That payload is what the feature needs: the error, the code
of the tab and the runtime values only if you include them, the selected code
or the whole file (with your question, and the tab's last run only if you
include it, for a question asked from the command palette),
the file with the span to edit marked (only the lines around it for a large
file), the SQL schema (table and column names and types, never rows), or the
cron phrase.
Secret-looking values are redacted before the preview.

- **Local** starts at Ollama's address on `localhost` and only accepts
  `localhost` or `127.0.0.1`. Nothing leaves the device, and no key is used.
- **My endpoint** sends to the provider you configure, under your account and
  its terms. On desktop the request goes through Lingua's network proxy, which
  refuses private-network hosts and drops the key on a redirect to another
  host.

On desktop the key is kept in the system keychain when one is available, and
in local storage otherwise; on the web it stays in the browser's local
storage. Conversations stay in memory and are never saved. Each send is listed
in Settings › Privacy without its content, and a Helpful / Not helpful vote
keeps only the error's kind. Telemetry never carries prompts, answers,
endpoints or keys.

## Desktop Updates

Packaged desktop builds check GitHub Releases shortly after launch and then
hourly, download any update, and install it on quit. No setting turns this off.

## Web App Updates

The web build may poll `updates.linguacode.dev` for the latest published version
so it can show an update banner. The response is version metadata, not user
project data.

## SQL Engine

The SQL workspace runs DuckDB inside the app. Lingua ships the DuckDB extensions
it uses (JSON, ICU and Parquet) and turns off DuckDB's download of the others from
`extensions.duckdb.org`, so typing or running a query does not contact that host.
A query that needs another extension fails and names it. SQL still reaches any
host it names itself, such as a URL passed to `read_csv` or a repository set with
`SET custom_extension_repository`.

Instant SQL runs a sample of the statement under the cursor as you type, on Local and
on the device. It never runs a write or a statement that names a remote URL on its own,
and its rows are not saved. Settings › Editor › SQL workspace turns it off.

## Database Connections

A database connection goes from the device to the server the user sets up. Lingua
runs no service in between. Turso, Neon and Cloudflare D1 go over HTTPS to those
providers.

On desktop, passwords, tokens and key passphrases are encrypted with the system
keychain, or stay in memory until the app quits for a connection that asks each
session, and always where no keychain is available. They are never written in plain
text or logged, and the interface cannot read a saved one back. The list of saved
connections has no secrets. It holds names, hosts, users and databases in a file only
the user can read on macOS and Linux. In the browser, Turso and Neon connections last
for the tab and their tokens stay in memory.

Results and driver errors from a connection stay in the session and leave run
capsules. A query on a connection reaches disk with its secret literals masked.
Telemetry carries the engine and the step that failed, never a host, user, query or
row. Crash reports are opt-in, and a report's minidump can hold what was in memory,
such as a password in use or rows.

For an SSH tunnel, Lingua reads `~/.ssh/known_hosts` and `~/.ssh/config` and does not
write them. It opens a private key from `~/.ssh` only when the user picks it, the ssh
config names it, or the user saves a connection imported with it. A saved connection
keeps the key's path, not its content. Host keys the user trusts are kept in a file of
Lingua's own, and with the SSH agent the agent holds the key.

Importing connections reads the file the user picks, the file beside it that completes
it, or the `.env` files at the open project's root, and drops every password. An export has no secrets.

## Code The User Runs

Code the user runs can reach the network. Settings › Privacy › Network from
running code sets Allow, the default, Ask or Block for the Worker, Pyodide and
Ruby WASM runtimes. It is a best-effort guard, not a sandbox. Node, Deno, Bun,
Go, Rust and system Ruby are outside it.

## Clipboard

Apply from clipboard on panel focus is off until the user turns it on, and needs
Pro. With it on, Utilities reads the clipboard when it opens and when the window
regains focus, and classifies the value on the device. Only the kind of value
stays; the text is not stored, logged or sent. There is no background polling.

## User Controls

Users can change telemetry and crash-reporting consent in Settings, the network
policy for running code, clipboard reads, and whether runs keep code copies for replay and
Compare (Capture code for replay). Removing a
license clears local license state and asks the license service to remove the
current device when the server is reachable.
