import { FileDropZone } from 'lingua';

const noop = async () => {};

export const Idle = () => (
  <FileDropZone
    hint="Drop a .lingua capsule here, or click to browse"
    acceptAttr=".lingua"
    onFile={noop}
  />
);

export const Rejected = () => (
  <FileDropZone
    hint="Drop a .lingua capsule here, or click to browse"
    acceptAttr=".lingua"
    errorMessage="That file is not a Lingua capsule."
    onFile={noop}
  />
);

export const WithSummary = () => (
  <FileDropZone
    hint="Drop a .lingua capsule here, or click to browse"
    acceptAttr=".lingua"
    summary="scratchpad.lingua · 24 KB · python 3.12"
    onFile={noop}
  />
);
