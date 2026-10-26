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

Explain error, Explain selection, Ask AI in SQL and the cron phrase composer
are off until you set a model in Settings. Lingua ships no remote endpoint or
key, and sends nothing until you choose Send after seeing the exact payload.
That payload is what the feature needs: the error, the code of the tab and the
runtime values only if you include them, the selected code, the SQL schema
(table and column names and types, never rows), or the cron phrase.
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

## Web App Updates

The web build may poll `updates.linguacode.dev` for the latest published version
so it can show an update banner. The response is version metadata, not user
project data.

## User Controls

Users can change telemetry and crash-reporting consent in Settings. Removing a
license clears local license state and asks the license service to remove the
current device when the server is reachable.
