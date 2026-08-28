import { MonoBadge } from 'lingua';

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <MonoBadge tone="neutral">v1.3.0</MonoBadge>
    <MonoBadge tone="accent">pyodide-0.26</MonoBadge>
    <MonoBadge tone="success">exit 0</MonoBadge>
    <MonoBadge tone="warning">412ms</MonoBadge>
    <MonoBadge tone="error">exit 137</MonoBadge>
  </div>
);

export const RuntimeIds = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <MonoBadge>node-24.1.0</MonoBadge>
    <MonoBadge>rustc-1.83</MonoBadge>
  </div>
);
