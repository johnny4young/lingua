/**
 * Shim for the design-system sync.
 *
 * `chrome.tsx` and `ModalShell.tsx` both export a `Kbd`. Star-exporting both
 * makes the name ambiguous in ESM, so it silently drops off window.Lingua
 * (validate reports it as [BUNDLE_EXPORT]). ModalShell's is the canonical one
 * — its own JSDoc notes that chrome's variant carries the legacy `.kbd-shell`
 * class with the old rounded-lg styling. So chrome's Kbd is omitted here and
 * ModalShell's ships.
 */
export {
  Tooltip,
  IconButton,
  OverlayBackdrop,
  OverlayCard,
} from '../../../src/renderer/components/ui/chrome';
