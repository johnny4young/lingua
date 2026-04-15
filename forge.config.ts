import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// ---------------------------------------------------------------------------
// Code-signing helpers — only active when environment variables are present
// ---------------------------------------------------------------------------

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const appCategoryType = 'public.app-category.developer-tools';
const desktopProtocol = {
  name: 'Lingua',
  schemes: ['lingua'],
} as const;

/** macOS notarization requires APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID */
const osxNotarize =
  isMac && process.env.APPLE_ID
    ? {
        tool: 'notarytool' as const,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD!,
        teamId: process.env.APPLE_TEAM_ID!,
      }
    : undefined;

/** macOS signing identity from keychain, e.g. "Developer ID Application: ..." */
const osxSign =
  isMac && process.env.APPLE_SIGNING_IDENTITY
    ? { identity: process.env.APPLE_SIGNING_IDENTITY, hardened: true }
    : undefined;

/** Windows Authenticode cert — requires WIN_CERT_FILE + WIN_CERT_PASSWORD */
const winCert =
  isWin && process.env.WIN_CERT_FILE
    ? {
        certificateFile: process.env.WIN_CERT_FILE,
        certificatePassword: process.env.WIN_CERT_PASSWORD,
      }
    : {};

// ---------------------------------------------------------------------------

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    overwrite: true,
    name: 'Lingua',
    executableName: 'lingua',
    appBundleId: 'com.lingua.app',
    appCategoryType,
    appVersion: process.env.npm_package_version ?? '0.1.0',
    appCopyright: `Copyright © ${new Date().getFullYear()} Lingua contributors`,
    // Icon (without extension — Forge picks .icns/.ico/.png per platform)
    icon: './assets/icon',
    // Packaging metadata only; runtime deep-link handling is tracked separately in RL-040.
    protocols: [desktopProtocol],
    // macOS: Universal binary (arm64 + x64 merged via lipo)
    ...(isMac
      ? {
          arch: ['arm64', 'x64'],
          ...(osxSign ? { osxSign } : {}),
          ...(osxNotarize ? { osxNotarize } : {}),
        }
      : {}),
    // Windows metadata shown in Add/Remove Programs
    ...(isWin
      ? {
          win32metadata: {
            CompanyName: 'Lingua',
            ProductName: 'Lingua',
            FileDescription: 'Multi-language code runner with WASM support',
          },
        }
      : {}),
  },

  rebuildConfig: {},

  makers: [
    // Windows: Squirrel (auto-update aware, no UAC elevation required)
    new MakerSquirrel({
      ...winCert,
      name: 'Lingua',
      setupExe: 'LinguaSetup.exe',
      setupIcon: './assets/icon.ico',
    }),

    // macOS release / CI artifact
    new MakerZIP({}, ['darwin']),

    // Linux
    new MakerDeb({
      options: {
        name: 'lingua',
        productName: 'Lingua',
        description: 'Multi-language code runner with WASM support',
        categories: ['Development'],
        icon: './assets/icon.png',
      },
    }),
    new MakerRpm({
      options: {
        name: 'lingua',
        productName: 'Lingua',
        description: 'Multi-language code runner with WASM support',
        categories: ['Development'],
        icon: './assets/icon.png',
      },
    }),
  ],

  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],

  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: process.env.GITHUB_REPOSITORY_OWNER ?? 'johnny4young',
          name: 'lingua',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
};

export default config;
