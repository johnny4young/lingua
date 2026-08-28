---
category: surfaces
---

# SettingsSection

Eyebrow-titled section wrapper that groups one or more SpecCards under a heading and optional description.

## Props

```ts
export interface SettingsSectionProps {
  /** Uppercase mono section label (rendered as-is; CSS does not case it). */
  eyebrow: React.ReactNode;
  /** Optional intro paragraph under the eyebrow. */
  description?: React.ReactNode;
  children: React.ReactNode;
}
```

## Usage

```jsx
<SettingsSection eyebrow="Privacy" description="What leaves this machine.">
  <SpecCard>{rows}</SpecCard>
</SettingsSection>
```

Rendered from `window.Lingua.SettingsSection` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
