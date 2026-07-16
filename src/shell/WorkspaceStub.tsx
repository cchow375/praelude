import "./shell.css";

/**
 * Placeholder for a workspace not yet rebuilt in the v3 rework. Keeps the app
 * runnable at every phase: each later phase (3–7) swaps its stub for the real
 * workspace. Deliberately plain — no decorative frame, one quiet line.
 */
export function WorkspaceStub({ id, name }: { id: string; name: string }) {
  return (
    <section
      className="workspace-stub"
      data-testid={`workspace-${id}`}
      aria-label={`${name} workspace`}
    >
      <h1 className="workspace-stub-title">{name}</h1>
      <p className="workspace-stub-note">
        This workspace arrives in a later phase.
      </p>
    </section>
  );
}
