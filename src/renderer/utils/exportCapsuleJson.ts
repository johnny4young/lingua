import {
  computeContentHash,
  parseRunCapsule,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import { prepareRunCapsuleExport, trackCapsuleExport } from './exportCapsule';
import { saveOrDownloadTextFile } from './saveTextFileToDisk';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';

/** The suggested filename is intentionally independent of source or tab names. */
const CAPSULE_CLI_FILENAME = 'lingua-run.capsule.json';
const CAPSULE_JSON_MIME = 'application/json;charset=utf-8';

// Only names that need no shell escaping are echoed into a copyable command.
const SHELL_SAFE_FILENAME = /^[\w][\w .()-]*\.json$/u;

export function capsuleCliCommands(fileName: string = CAPSULE_CLI_FILENAME) {
  const name = SHELL_SAFE_FILENAME.test(fileName) ? fileName : CAPSULE_CLI_FILENAME;
  return {
    fileName: name,
    validate: `lingua capsule validate "${name}" --json`,
    replay: `lingua capsule replay "${name}" --json`,
  };
}

/** Save the same sanitized RunCapsuleV1 consumed by import and CLI validation. */
export async function exportCapsuleJsonToFile(
  capsule: RunCapsuleV1,
  handlers: { onOk: (savedName?: string) => void; onError: () => void }
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
    onOk: savedName => {
      recordTrustEventBestEffort({
        feature: 'capsule-export',
        action: 'exported',
        sensitivity: 'medium',
        summary: `${sanitised.tab.language} capsule exported as JSON (${sizeBucket})`,
      });
      handlers.onOk(savedName);
    },
    onError: handlers.onError,
  });
}
