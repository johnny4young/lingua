# Release Checklist

This repository uses a draft-first release process.

## Preconditions

- CI is green on `main`
- Release tag will be a stable tag in the form `vX.Y.Z`
- GitHub Actions secrets are configured:
  - macOS:
    - `APPLE_ID`
    - `APPLE_ID_PASSWORD`
    - `APPLE_TEAM_ID`
    - `APPLE_SIGNING_IDENTITY`
    - `APPLE_CERT_P12_BASE64`
    - `APPLE_CERT_PASSWORD`
  - Windows:
    - `WIN_CERT_FILE`
    - `WIN_CERT_PASSWORD`
- Apple Developer signing and notarization credentials are still valid
- Windows code-signing certificate is still valid

## Release steps

1. Update versioned product changes in the repository as needed.
2. Commit and merge the release-ready state into `main`.
3. Create a stable tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. Wait for the `Release` GitHub Actions workflow to complete.
5. Inspect the workflow summary:
   - macOS signing verification
   - Windows signing verification
   - generated checksums
6. Open the draft GitHub Release created by the workflow.
7. Verify attached artifacts and `SHA256SUMS.txt`.
8. Verify release notes and artifact naming.
9. Promote the draft release manually when validation is complete.

## Validation checklist

- macOS build completed
- Windows build completed
- Linux build completed
- macOS signing verification passed
- Windows signing verification passed
- `SHA256SUMS.txt` is attached or present in the release payload
- Release remains draft until human review is complete

## Current policy

- Stable channel only
- Draft-first publishing
- macOS artifacts are ZIP-only in the active path
