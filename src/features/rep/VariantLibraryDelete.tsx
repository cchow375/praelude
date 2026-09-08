import { useState } from "react";

/** In-flow confirmation stays inside the scrolling Variants dialog. */
export function VariantLibraryDelete({ name, label, busy, onDelete }: {
  name: string;
  label: string;
  busy: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button type="button" className="ck-row-remove" aria-label={name}
      disabled={busy} onClick={() => setConfirming(true)}>×</button>;
  }
  return <div className="variant-library-delete" role="group" aria-label={name}>
    <small>{label}</small>
    <button type="button" className="ck-chip" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    <button type="button" className="ck-chip" disabled={busy} onClick={async () => {
      if (await onDelete()) setConfirming(false);
    }}>Confirm delete</button>
  </div>;
}
