import { InlineMarker } from 'lingua';

export const Values = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
    <InlineMarker value="42" type="number" />
    <InlineMarker value="&quot;lingua&quot;" type="string" />
    <InlineMarker value="[1, 2, 3]" type="array" />
    <InlineMarker value="null" type="null" />
  </div>
);

export const Watched = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
    <InlineMarker value="0.0421" type="number" watch />
    <InlineMarker value="{ rows: 128 }" type="object" watch />
  </div>
);
