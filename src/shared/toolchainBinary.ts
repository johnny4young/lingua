/** Folders checked besides PATH, home-relative; set when a Go or Rust binary is missing. */
export interface ToolchainSearchedPlaces {
  searched?: string[];
}

/** Outcome of picking a Go or Rust binary through the native dialog in main. */
export type ToolchainChooseResult =
  | { status: 'canceled' }
  | { status: 'saved'; version: string }
  | { status: 'invalid'; reason: 'not-executable' | 'wrong-name' | 'blocked' | 'check-failed' };
