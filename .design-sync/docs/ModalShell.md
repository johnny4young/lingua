---
category: surfaces
---

# ModalShell

The standard overlay frame: scrim, focus trap, Esc-to-close, header rail and an optional footer legend. Every modal surface in the product is built from this — do not hand-roll a dialog.

## Props

```ts
export interface ModalShellProps {
  /** Called on Escape, scrim click, and the Esc keycap / x button (caller wires it). */
  onClose: () => void;
  /** Optional leading glyph rendered in a muted slot in the header. */
  icon?: React.ReactNode;
  /** Header content — typically a search input or a placeholder row. */
  header: React.ReactNode;
  /** Footer-left legend. Defaults to the standard kbd navigation rail. */
  footerLegend?: React.ReactNode;
  /** Footer-right slot — e.g. a result count. */
  trailing?: React.ReactNode;
  /** The scrollable body region. */
  children: React.ReactNode;
  /** Width clamp class for the container. Defaults to `max-w-[620px]`. */
  size?: string;
  /** id of the element labelling the dialog (wired to aria-labelledby). */
  labelledById?: string;
  /** Overrides the default body padding (`px-3 py-[10px]`). Master-detail overlays (snippets, utilities) pass their own grid  */
  bodyClassName?: string;
  /** `button` renders the lucide `x` close button used by the TITLE-header overlays (snippets, utilities, recipes, capsules,  */
  headerClose?: "button" | "esc" | "none";
  /** Translated aria-label for the `x` close button. Required. */
  closeLabel?: string;
}
```

## Usage

```jsx
<ModalShell
  header="Keyboard shortcuts"
  onClose={close}
  footerLegend={<ModalFooterLegend navigate close />}
>
  {rows}
</ModalShell>
```

Rendered from `window.Lingua.ModalShell` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
