/** Existing per-pipe capture budget (UTF-16 units, as used by native capture). */
export const PROJECT_TEST_MAX_OUTPUT_BYTES = 256 * 1024;
export const PROJECT_TEST_OUTPUT_TRUNCATION_MARKER = '\n[project test output truncated]';

export interface ProjectTestTranscript {
  text: string;
  truncated: boolean;
}

/** Preserve callback order within the sum of the existing pipe budgets. */
export function appendProjectTestOutput(
  previous: ProjectTestTranscript | undefined,
  chunk: string
): ProjectTestTranscript {
  if (previous?.truncated) return previous;
  const limit = 2 * PROJECT_TEST_MAX_OUTPUT_BYTES;
  const text = (previous?.text ?? '') + chunk;
  if (text.length <= limit) return { text, truncated: false };
  let end = limit - PROJECT_TEST_OUTPUT_TRUNCATION_MARKER.length;
  // Do not leave half a surrogate pair at the truncation boundary.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return { text: text.slice(0, end) + PROJECT_TEST_OUTPUT_TRUNCATION_MARKER, truncated: true };
}
