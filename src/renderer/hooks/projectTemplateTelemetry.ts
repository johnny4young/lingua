// SPDX-License-Identifier: MIT
/**
 * implementation note — Project template telemetry helper.
 *
 * Fires `template_project_applied` once per successful multi-file
 * scaffold. Closed-enum payload `{ templateId, language }` validated
 * on both the renderer redactor and the update-server worker. No
 * destination path, no file paths, no content — the templateId is
 * already a fixed enum and the language is the language-pack id.
 *
 * No throttle: the event only ever fires on the user-initiated
 * scaffold action after `openProject` resolves and the entry file
 * opens, so a burst is structurally impossible.
 */

import { trackEvent } from '../utils/telemetry';

export function trackTemplateProjectApplied(payload: {
  templateId: string;
  language: string;
}): void {
  void trackEvent('template_project_applied', {
    templateId: payload.templateId,
    language: payload.language,
  });
}
