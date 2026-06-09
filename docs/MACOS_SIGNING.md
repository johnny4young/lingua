# macOS signing and notarization

This guide covers direct-distribution macOS builds for Lingua. It does not
change the repository license; it prepares the signed desktop artifacts that
the release workflow needs before a public macOS launch.

> For how these signed artifacts fit the end-to-end update signature chain
> (manifest → installer → on-disk binary) and the release-time gates that
> enforce it, see
> [`RELEASE_SECURITY.md` § Signature chain](./RELEASE_SECURITY.md#signature-chain).

## Prerequisites

- Apple Developer Program membership for the release owner.
- Account Holder access for the Apple Developer team.
- Xcode installed on the Mac used to create or inspect certificates.
- Lingua's current bundle id from `forge.config.ts`: `com.lingua.app`.
- A GitHub environment where release secrets can be stored.

Apple's Developer ID documentation says Developer ID lets Gatekeeper verify
apps distributed outside the Mac App Store, and Electron's auto-updater docs
require a signed app for macOS automatic updates. Electron Forge signs through
`@electron/osx-sign` and notarizes as the second distribution step.

Official references:

- [Apple Developer ID distribution](https://developer.apple.com/developer-id/)
- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron Forge macOS signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)

## Create the certificate

1. Open Apple Developer → Certificates, Identifiers & Profiles.
2. Create a new certificate.
3. Under Software, choose **Developer ID Application**.
4. Complete the certificate request flow and install the certificate in
   Keychain Access.
5. Confirm the identity is visible locally:

   ```bash
   security find-identity -v -p codesigning
   ```

The signing identity should look like:

```text
Developer ID Application: Your Name or Company (TEAMID)
```

Set that exact string as `APPLE_SIGNING_IDENTITY`.

## Export the `.p12`

1. Open Keychain Access.
2. Select the Developer ID Application certificate and its private key.
3. Export as Personal Information Exchange (`.p12`).
4. Use a strong export password. This becomes `APPLE_CERT_PASSWORD`.
5. Base64 encode the file for GitHub Actions:

   ```bash
   base64 -i LinguaDeveloperID.p12 | pbcopy
   ```

Never commit the `.p12`, the base64 output, or the export password.

## Configure GitHub Actions secrets

Set these repository or environment secrets before enabling public macOS
release jobs:

| Secret | Purpose |
|--------|---------|
| `APPLE_ID` | Apple ID used for notarization. |
| `APPLE_ID_PASSWORD` | App-specific password for the Apple ID. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity string. |
| `APPLE_CERT_P12_BASE64` | Base64-encoded `.p12` export. |
| `APPLE_CERT_PASSWORD` | Password used when exporting the `.p12`. |

The release workflow imports the certificate into a temporary keychain,
validates that `APPLE_SIGNING_IDENTITY` is present in that keychain, runs
`pnpm run make:desktop:mac`, verifies the app signature, and then runs the
packaged desktop smoke gate. Forge is configured with
`osxSign.continueOnError: false` so codesign failures fail at the build step
with the original stderr instead of surfacing later as a missing ZIP.

## Local dry run

If the certificate is installed in your login keychain, run:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
pnpm run make:desktop:mac
```

For notarization in CI, the release workflow also needs `APPLE_ID`,
`APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID`. Do not put those values in `.env`.

## Verification commands

After a local or CI build, verify the app bundle:

```bash
codesign --verify --deep --strict --verbose=2 out/Lingua-darwin-*/Lingua.app
spctl --assess --type execute --verbose out/Lingua-darwin-*/Lingua.app
```

If the workflow notarizes and staples a ticket, validate the stapled result:

```bash
xcrun stapler validate out/Lingua-darwin-*/Lingua.app
```

Then run the packaged smoke:

```bash
pnpm run smoke:desktop:packaged
```

## Troubleshooting

- **Identity not found**: Re-check `security find-identity -v -p codesigning`
  and confirm `APPLE_SIGNING_IDENTITY` exactly matches the Developer ID
  Application identity.
- **Notarization rejected**: Open the notarization log and fix the first
  signing or entitlement error before retrying.
- **Gatekeeper still warns**: Confirm notarization completed and the ticket was
  stapled or that the ZIP contains the notarized app bundle.
- **Auto-update fails on macOS**: Confirm the shipped app is signed; Electron's
  `autoUpdater` requires signing on macOS.

## Rotation

If the `.p12`, base64 value, password, Apple ID password, or Team ID workflow
secrets are exposed:

1. Revoke or replace the affected credential in Apple Developer.
2. Generate a fresh certificate or app-specific password.
3. Replace the GitHub Actions secret.
4. Re-run the release workflow and verify signing before promoting a draft
   release.
