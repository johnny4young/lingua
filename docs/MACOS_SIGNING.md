# macOS signing and notarization

Lingua packages macOS arm64 and x64 with electron-builder. Each architecture
ships a dmg for installation and a zip for electron-updater. The bundle id is
`com.lingua.app` in `electron-builder.yml`.

## Credentials

The release workflow recognizes:

| Secret                  | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `APPLE_CERT_P12_BASE64` | Base64 Developer ID Application certificate + private key. |
| `APPLE_CERT_PASSWORD`   | P12 export password.                                       |
| `APPLE_ID`              | Apple ID used by notarytool.                               |
| `APPLE_ID_PASSWORD`     | App-specific password.                                     |
| `APPLE_TEAM_ID`         | Apple Developer team id.                                   |

When all exist, electron-builder imports the certificate into its temporary
keychain, signs with the hardened runtime and configured entitlements, submits
to Apple, and staples the ticket. Missing credentials produce an ad-hoc
validation build that must not be distributed as notarized.

Never commit the P12, its base64 representation, or credential values.

## Create and export the certificate

1. Create a **Developer ID Application** certificate in Apple Developer.
2. Install it with its private key in Keychain Access.
3. Export both as a password-protected `.p12`.
4. Encode it for the GitHub secret:

   ```bash
   base64 -i LinguaDeveloperID.p12 | pbcopy
   ```

## Validation

After packaging:

```bash
codesign --verify --deep --strict --verbose=2 out-builder/mac-arm64/lingua.app
codesign --verify --deep --strict --verbose=2 out-builder/mac/lingua.app
xcrun stapler validate out-builder/mac-arm64/lingua.app
xcrun stapler validate out-builder/mac/lingua.app
spctl --assess --type execute --verbose out-builder/mac-arm64/lingua.app
spctl --assess --type execute --verbose out-builder/mac/lingua.app
pnpm run smoke:desktop:packaged
```

The packaged smoke must log `out-builder/mac-arm64/lingua.app` on an Apple
Silicon runner. Launching `out-builder/mac/lingua.app` there means the smoke is
testing Intel through Rosetta and is not valid arm64 evidence.

Official references:

- [Apple Developer ID distribution](https://developer.apple.com/developer-id/)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder macOS signing](https://www.electron.build/code-signing-mac.html)

## Rotation

If a signing credential is exposed, revoke or replace it with Apple, update the
GitHub secrets, rebuild both architectures, and repeat codesign, stapler,
Gatekeeper, and packaged-smoke validation before promotion.
