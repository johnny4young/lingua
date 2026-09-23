import {
  computeContentHash,
  parseRunCapsule,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import { prepareRunCapsuleExport, trackCapsuleExport } from './exportCapsule';
import { saveOrDownloadTextFile } from './saveTextFileToDisk';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';

/** The suggested filename is intentionally independent of source or tab names. */
export const CAPSULE_CLI_FILENAME = 'lingua-run.capsule.json';
const CAPSULE_JSON_MIME = 'application/json;charset=utf-8';

export const CAPSULE_VALIDATE_COMMAND =
  `lingua capsule validate "${CAPSULE_CLI_FILENAME}" --json`;
export const CAPSULE_REPLAY_COMMAND =
  `lingua capsule replay "${CAPSULE_CLI_FILENAME}" --json`;

/** Save the same sanitized RunCapsuleV1 consumed by import and CLI validation. */
export async function exportCapsuleJsonToFile(
  capsule: RunCapsuleV1,
  handlers: { onOk: () => void; onError: () => void }
): Promise<void> {
  const { sanitised, json, sizeBucket } = prepareRunCapsuleExport(capsule);
  // A CLI handoff must not offer a JSON file that the shared parser rejects
  // (including the serialized 4 MiB cap) or that replay refuses by hash.
  const parsed = parseRunCapsule(json);
  let valid = false;
  try {
    valid = parsed.ok &&
      await computeContentHash(sanitised.source.content) === sanitised.source.contentHash;
  } catch {
    // An unavailable digest API is a failed export, not an unhandled click.
  }
  if (!valid) {
    handlers.onError();
    return;
  }
  trackCapsuleExport('settings-export-file', sizeBucket);
  await saveOrDownloadTextFile(json, CAPSULE_CLI_FILENAME, CAPSULE_JSON_MIME, {
    onOk: () => {
      recordTrustEventBestEffort({
        feature: 'capsule-export',
        action: 'exported',
        sensitivity: 'medium',
        summary: `${sanitised.tab.language} capsule exported as JSON (${sizeBucket})`,
      });
      handlers.onOk();
    },
    onError: handlers.onError,
  });
}
