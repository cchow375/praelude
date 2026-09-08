import { useEffect, useState, type CSSProperties } from "react";
import { Dialog } from "../../ui/Dialog";
import type { PracticePieceContext } from "../universe/types";
import { PracticeRoom } from "./PracticeRoom";
import { RankEmblem, RANK_COLORS } from "./RankEmblem";
import { useStudio } from "./StudioProvider";
import { StudioShop } from "./StudioShop";
import { StudioJourney } from "./StudioJourney";
import { StudioRecord } from "./StudioRecord";
import { StudioMutationError } from "./StudioMutationError";
import { studioEquip, studioProfileSave, studioPurchase } from "./studioApi";
import "./studio.css";

export function StudioWorkspace({
  onOpenPractice,
  onOpenLedger,
  streak,
}: {
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  onOpenLedger?: (piece: PracticePieceContext) => void;
  streak?: { current_days: number } | null;
}) {
  const { snapshot, error, loading, busy, message, earned, refresh, mutate } =
    useStudio();
  const [tab, setTab] = useState<"room" | "journey" | "record">("room");
  const [profile, setProfile] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const progress = snapshot?.progress;
  const color =
    RANK_COLORS[Math.min(9, Math.max(0, (progress?.rank_index ?? 1) - 1))];
  return (
    <main
      className="studio-workspace"
      data-testid="studio-workspace"
      style={{ "--rank-color": color } as CSSProperties}
    >
      <header className="studio-header">
        <div>
          <p className="studio-eyebrow">
            A little space for a lifelong practice
          </p>
          <h1>Studio</h1>
        </div>
        <div className="studio-header-actions">
          <button
            type="button"
            className="studio-profile"
            disabled={!snapshot}
            onClick={() => {
              setName(snapshot?.profile.display_name ?? "");
              setProfile(true);
            }}
          >
            <span aria-hidden="true">
              {(snapshot?.profile.display_name ?? "P")
                .slice(0, 1)
                .toLocaleUpperCase()}
            </span>
            {snapshot?.profile.display_name ?? "Your profile"}
          </button>
          <button
            type="button"
            className="studio-primary"
            onClick={() => onOpenPractice(null)}
          >
            Back to practice <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>
      {error && (
        <div className="studio-error" role="alert">
          <span>{error}</span>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            Refresh studio
          </button>
        </div>
      )}
      {loading && !snapshot && (
        <div className="studio-loading" role="status">
          <div />
          <p>Opening your studio…</p>
        </div>
      )}
      {snapshot && progress && (
        <>
          <div className="studio-hero">
            <section
              className="studio-room-stage"
              aria-label="Your furnished practice room"
            >
              <div className="studio-room-topline">
                <span>
                  {snapshot.catalog.find((i) => i.id === snapshot.equipped.room)
                    ?.name ?? "Your room"}
                </span>
                <span className="studio-room-private">
                  Private · On this Mac
                </span>
              </div>
              <PracticeRoom
                equipped={snapshot.equipped}
                label={`${snapshot.profile.display_name}'s practice room with ${Object.entries(
                  snapshot.equipped,
                )
                  .filter(([slot]) => slot !== "theme")
                  .map(
                    ([, id]) =>
                      snapshot.catalog.find((i) => i.id === id)?.name ?? id,
                  )
                  .join(", ")}`}
              />
              <div className="studio-room-caption">
                <div>
                  <strong>{snapshot.profile.display_name}’s studio</strong>
                  <span>
                    {progress.total_xp === 0
                      ? "Every great practice starts somewhere."
                      : "Built one practice at a time."}
                  </span>
                </div>
                <button
                  type="button"
                  className="studio-room-edit"
                  onClick={() => {
                    setTab("room");
                    document
                      .getElementById("studio-panel")
                      ?.scrollIntoView({ block: "start", behavior: "auto" });
                  }}
                >
                  Furnish room <span aria-hidden="true">↓</span>
                </button>
              </div>
            </section>
            <section
              className="studio-rank-card"
              aria-label="Your practice rank"
            >
              <p className="studio-eyebrow">
                Practice rank {progress.rank_index}
              </p>
              <RankEmblem rank={progress.rank_index} />
              <h2>
                {progress.rank_name} <span>{progress.division}</span>
              </h2>
              <p className="studio-rank-subtitle">
                Division {progress.division} of 10
              </p>
              <div className="studio-rank-meter">
                <div>
                  <strong>
                    {progress.division_xp}{" "}
                    <span>/ {progress.division_xp_required} XP</span>
                  </strong>
                  <span>
                    {Math.round(
                      (progress.division_xp / progress.division_xp_required) *
                        100,
                    )}
                    %
                  </span>
                </div>
                <progress
                  value={progress.division_xp}
                  max={progress.division_xp_required}
                  aria-label="Progress to next division"
                />
                <p>
                  {progress.division_xp_required - progress.division_xp} XP to
                  your next division <span>+25 coins</span>
                </p>
              </div>
              <div className="studio-rank-bottom">
                <span>
                  <strong>{snapshot.wallet.balance.toLocaleString()}</strong>{" "}
                  coins
                </span>
                <span>
                  <strong>{progress.total_xp.toLocaleString()}</strong> total XP
                </span>
              </div>
              <button
                type="button"
                className="studio-text-button"
                onClick={() => {
                  setTab("journey");
                  document
                    .getElementById("studio-panel")
                    ?.scrollIntoView({ block: "start", behavior: "auto" });
                }}
              >
                Explore your path →
              </button>
            </section>
          </div>
          <div className="studio-momentum">
            <div>
              <span className="studio-momentum-spark" aria-hidden="true">
                ✦
              </span>
              <p>
                <strong>
                  {earned ??
                    (progress.current_session_sets > 0
                      ? `${progress.current_session_sets} sets completed this session`
                      : "A room that grows with you.")}
                </strong>
                <span>
                  {progress.current_session_sets > 0
                    ? progress.next_set_milestone
                      ? `${progress.next_set_milestone - progress.current_session_sets} more to your next session milestone.`
                      : "All four session milestones earned. Keep going if it serves the music."
                    : "Focus, finish sets, and make this space your own."}
                </span>
              </p>
            </div>
            {streak && streak.current_days > 0 && (
              <span className="studio-pill">
                {streak.current_days} day streak
              </span>
            )}
          </div>
          <div className="studio-tabs" role="tablist" aria-label="Studio views">
            {(
              [
                ["room", "Furnish"],
                ["journey", "Rank path"],
                ["record", "Practice record"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                id={`studio-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="studio-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(e) => {
                  if (
                    !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const ids = ["room", "journey", "record"] as const;
                  const index = ids.indexOf(id);
                  const next =
                    ids[
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 2
                          : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3
                    ];
                  setTab(next);
                  document.getElementById(`studio-tab-${next}`)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="studio-status" role="status" aria-live="polite">
            {message}
          </div>
          <div
            id="studio-panel"
            role="tabpanel"
            aria-labelledby={`studio-tab-${tab}`}
          >
            {tab === "room" && (
              <StudioShop
                snapshot={snapshot}
                busy={busy}
                onBuy={(item) =>
                  mutate(
                    (revision) => studioPurchase(item.id, revision),
                    `${item.name} is now in your room.`,
                  )
                }
                onEquip={(item) =>
                  mutate(
                    (revision) => studioEquip(item.id, revision),
                    `${item.name} equipped.`,
                  )
                }
              />
            )}
            {tab === "journey" && <StudioJourney progress={progress} />}
            {tab === "record" && (
              <StudioRecord
                progress={progress}
                onOpenPractice={onOpenPractice}
                onOpenLedger={onOpenLedger}
              />
            )}
          </div>
        </>
      )}
      <Dialog
        open={profile}
        onClose={() => {
          if (!busy) setProfile(false);
        }}
        label="Your local profile"
        className="studio-dialog"
      >
        <StudioMutationError />
        <h2>Your corner of Praelude.</h2>
        <p>A name for your studio. Saved privately on this device.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              (revision) => studioProfileSave(name, revision),
              "Your profile is saved.",
            ).then((ok) => {
              if (ok) setProfile(false);
            });
          }}
        >
          <label className="studio-profile-field">
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="nickname"
              required
            />
          </label>
          <p className="studio-footnote">
            Email accounts, sync and friends are not connected yet. Your
            practice and room work fully offline.
          </p>
          <div className="studio-dialog-actions">
            <button
              type="button"
              className="studio-secondary"
              disabled={busy}
              onClick={() => setProfile(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="studio-primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}
