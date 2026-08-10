/**
 * Re-export of the shared cron phrase engine. The implementation moved to
 * `src/shared/utilities/cronPhrase.ts` so the CLI's `cron-phrase` utility
 * adapter and the pipeline engine consume the same grammar as this panel —
 * the established pattern for shared utility logic (uuid, loremIpsum,
 * stringInspect). Renderer code keeps importing from here unchanged.
 */
export { phraseToCron } from '../../shared/utilities/cronPhrase';
export type { CronPhraseNote, CronPhraseResult } from '../../shared/utilities/cronPhrase';
