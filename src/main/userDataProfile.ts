import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which `userData` profile this process owns. Release builds keep the
 * installed app's folder; dev launchers and locally packaged builds get a
 * sibling folder so an older keyring or a dev-minted key can never rewrite
 * the installed app's license, consent, or approvals.
 */
export type UserDataProfile = 'release' | 'dev' | 'local';

/** `package.json` key that local packaging scripts set through `-c.extraMetadata`. */
export const BUILD_CHANNEL_METADATA_KEY = 'linguaBuildChannel';
export const LOCAL_BUILD_CHANNEL = 'local';

const PROFILE_SUFFIX: Record<Exclude<UserDataProfile, 'release'>, string> = {
  dev: ' Dev',
  local: ' Local',
};

export function readBuildChannel(appPath: string): string | null {
  try {
    const raw = readFileSync(path.join(appPath, 'package.json'), 'utf-8');
    const channel = (JSON.parse(raw) as Record<string, unknown>)[BUILD_CHANNEL_METADATA_KEY];
    return typeof channel === 'string' ? channel : null;
  } catch {
    return null;
  }
}

export function resolveUserDataProfile(input: {
  isPackaged: boolean;
  buildChannel: string | null;
}): UserDataProfile {
  if (!input.isPackaged) return 'dev';
  return input.buildChannel === LOCAL_BUILD_CHANNEL ? 'local' : 'release';
}

/**
 * Returns the directory to pass to `app.setPath('userData', …)`, or null to
 * keep Electron's default. An explicit smoke directory always wins.
 */
export function resolveUserDataOverride(input: {
  profile: UserDataProfile;
  defaultUserDataDir: string;
  smokeUserDataDir?: string;
}): string | null {
  const smoke = input.smokeUserDataDir?.trim();
  if (smoke) return smoke;
  if (input.profile === 'release') return null;
  return `${input.defaultUserDataDir}${PROFILE_SUFFIX[input.profile]}`;
}

/** Only release builds claim `lingua://`, unless a developer opts in. */
export function shouldRegisterProtocolClient(profile: UserDataProfile, devOptIn: boolean): boolean {
  return profile === 'release' || devOptIn;
}
