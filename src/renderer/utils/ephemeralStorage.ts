/** True when the boot script replaced a blocked localStorage with its in-memory stand-in. */
export function isStorageEphemeral(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.storage === 'memory';
}
