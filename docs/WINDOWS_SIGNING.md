# Windows distribution and signing

Lingua packages Windows x64 with electron-builder as a one-click, per-user NSIS
installer. The Release workflow builds the `.exe` on `windows-latest`, validates
the unpacked application and updater metadata, and builds the native Lingua CLI
before uploading both surfaces to GitHub Releases.

## Current support level

- `electron-builder.yml` target: `nsis`.
- Installer: `Lingua-<version>-win-x64.exe` plus blockmap.
- Auto-update: `electron-updater` reads `latest.yml` and the installer from the
  public `johnny4young/lingua` GitHub Release.
- Unsigned installers are allowed as an explicitly labeled preview while no
  certificate is configured. Windows SmartScreen may warn users.
- When signing secrets are configured, an invalid signature fails the release.
- The same credential signs the standalone `lingua.exe` after Node's SEA blob
  is injected. Signing before injection would invalidate the signature.

This provisional path provides an installable Windows build without representing
an unsigned preview as fully trusted distribution.

## Packaging validation

`scripts/validate-windows-package.mjs` checks before upload:

- exactly one top-level NSIS `.exe`;
- matching `.exe.blockmap`;
- `latest.yml` references that installer;
- `win-unpacked/lingua.exe` and `resources/app.asar` exist;
- `resources/app-update.yml` targets the GitHub provider at
  `johnny4young/lingua`.

`pnpm run package:cli -- --binary-only --expect-target windows-x64` separately
builds and smokes the standalone CLI. The workflow then requires
`Get-AuthenticodeSignature` to report the same configured/valid state for both
the NSIS installer and `out-cli/.staging/windows-x64/release/lingua.exe`.

Run it on Windows after packaging:

```powershell
pnpm run make:desktop:win
node scripts/validate-windows-package.mjs --root out-builder
```

## Optional Authenticode signing

The workflow recognizes:

| Secret              | Purpose                         |
| ------------------- | ------------------------------- |
| `WIN_CERT_FILE`     | Base64-encoded PFX certificate. |
| `WIN_CERT_PASSWORD` | PFX password.                   |

When both exist, electron-builder signs the installer and the workflow requires:

```powershell
Get-AuthenticodeSignature .\out-builder\Lingua-*-win-x64.exe
```

to report `Status: Valid`. If signing was configured but the result is anything
else, the job fails. Never commit the PFX, its base64 encoding, or password.

Configure both secrets from the CLI without putting the password on a command
line:

```bash
base64 -i /secure/path/lingua-code-signing.pfx | gh secret set WIN_CERT_FILE
gh secret set WIN_CERT_PASSWORD
```

The second command prompts securely. After configuration, dispatch a draft
release and confirm both summary lines before publishing:

```text
Windows installer: Authenticode signature valid
Windows CLI: Authenticode signature valid
```

Certificates that cannot be exported from hardware/HSM providers need a future
provider-specific signing hook; do not copy those private keys into repository
secrets.

Azure Artifact Signing is not a universal fallback: Public Trust eligibility
depends on the publisher's region and identity type. Verify eligibility before
designing around it. An exportable CA-issued PFX works with the current pipeline;
an HSM/cloud provider should use a provider-specific SignTool hook rather than
exporting private key material.

## Promotion policy

- An unsigned `.exe` can be published as preview-quality Windows support when
  the workflow summary says `unsigned preview build`.
- A release must not claim Authenticode trust unless the workflow reports a
  valid signature.
- Before broader Windows promotion, test install, launch, update, uninstall,
  and SmartScreen behavior on a clean Windows 11 VM.

## Rotation or compromise

If signing material is exposed, revoke it with the provider, replace the GitHub
secrets, rebuild the installer, and verify the new Authenticode chain before
publishing another Windows artifact.
