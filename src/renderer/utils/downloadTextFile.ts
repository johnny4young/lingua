/**
 * RL-043 Slice E — shared text-file download helper.
 *
 * Extracted from `NotebookView` so the notebook toolbar AND the
 * command-palette "Export notebook as .linguanb" action (fold E) share
 * one Blob → object-URL → anchor-click download path instead of
 * duplicating it. Web-only (no IPC); the desktop capability-IPC save
 * (fold A) uses a separate native dialog path.
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revoke so the click has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
