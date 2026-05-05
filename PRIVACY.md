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

## Web App Updates

The web build may poll `updates.linguacode.dev` for the latest published version
so it can show an update banner. The response is version metadata, not user
project data.

## User Controls

Users can change telemetry and crash-reporting consent in Settings. Removing a
license clears local license state and asks the license service to remove the
current device when the server is reachable.
