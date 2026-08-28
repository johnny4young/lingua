import { ConfirmDialog } from 'lingua';

const noop = () => {};

export const DiscardChanges = () => (
  <ConfirmDialog
    title="Discard changes?"
    body="This scratchpad has unsaved edits. Discarding cannot be undone."
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={noop}
    onCancel={noop}
  />
);

export const DeleteCapsule = () => (
  <ConfirmDialog
    title="Delete this capsule?"
    body="The capsule and its recorded run history are removed from this machine."
    confirmLabel="Delete"
    cancelLabel="Cancel"
    onConfirm={noop}
    onCancel={noop}
  />
);
