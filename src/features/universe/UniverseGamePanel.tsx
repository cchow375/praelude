import { useId, type CSSProperties, type ReactNode } from "react";
import {
  deriveUniverseGame,
  type BadgeTrack,
  type UniverseGameEvidence,
} from "./game";
import "./universeGamePanel.css";

export interface UniverseGamePanelProps {
  /**
   * Canonical all-history evidence from the current practice database. The
   * game model sanitizes it and remains the only XP/level/badge projection.
   */
  evidence: UniverseGameEvidence;
}

interface TrackPresentation {
  label: string;
  shortLabel: string;
}

const TRACK_PRESENTATION: Record<BadgeTrack, TrackPresentation> = {
  active_days: { label: "Active days", shortLabel: "Days" },
  streak: { label: "Best streak", shortLabel: "Streak" },
  focused_hours: { label: "Focused hours", shortLabel: "Hours" },
  revisits: { label: "Targets revisited", shortLabel: "Revisits" },
  mastery: { label: "Verified mastery", shortLabel: "Mastery" },
  recovery: { label: "Honest recovery", shortLabel: "Recovery" },
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

function number(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function remainingCopy(track: BadgeTrack, remaining: number): string {
  const plural = remaining === 1 ? "" : "s";
  switch (track) {
    case "active_days":
      return `${number(remaining)} more active day${plural}`;
    case "streak":
      return `${number(remaining)} more best-streak day${plural}`;
    case "focused_hours":
      return `${number(remaining)} more completed focused hour${plural}`;
    case "revisits":
      return `${number(remaining)} more revisited target${plural}`;
    case "mastery":
      return `${number(remaining)} more verified ${remaining === 1 ? "mastery" : "masteries"}`;
    case "recovery":
      return `${number(remaining)} more honest ${remaining === 1 ? "recovery" : "recoveries"}`;
  }
}

function TrackIcon({ track }: { track: BadgeTrack }) {
  let paths: ReactNode;
  switch (track) {
    case "active_days":
      paths = (
        <>
          <rect x="4" y="5.5" width="16" height="14" rx="2" />
          <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h2M13 13h3" />
        </>
      );
      break;
    case "streak":
      paths = (
        <>
          <path d="M5 16.5V19M9.5 13v6M14 9.5V19M18.5 5v14" />
          <path d="m5 12 4.5-3.5L14 6l4.5-3" />
        </>
      );
      break;
    case "focused_hours":
      paths = (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      );
      break;
    case "revisits":
      paths = (
        <>
          <path d="M7 7h8.5a4.5 4.5 0 0 1 0 9H9" />
          <path d="m10 12-4 4 4 4" />
        </>
      );
      break;
    case "mastery":
      paths = (
        <>
          <path d="M12 3.5 19 7v5c0 4.2-2.8 7-7 8.5C7.8 19 5 16.2 5 12V7l7-3.5Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </>
      );
      break;
    case "recovery":
      paths = (
        <>
          <path d="M4.5 15.5a7.8 7.8 0 1 0 1-8.5" />
          <path d="M5.5 3v4h4M8.5 15.5l3-3 2.5 2 3.5-4" />
        </>
      );
      break;
  }

  return (
    <svg
      className="universe-game-track-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

/**
 * The motivational layer for Practice Universe. It visualizes only the state
 * derived by game.ts: no UI gesture, animation, or decorative element can
 * award progress.
 */
export function UniverseGamePanel({ evidence }: UniverseGamePanelProps) {
  const titleId = useId();
  const cabinetTitleId = useId();
  const nextTitleId = useId();
  const game = deriveUniverseGame(evidence);
  const { level } = game;
  const levelSpan = level.nextXp - level.startXp;
  const levelStyle = {
    "--universe-game-level-progress": `${level.percent}%`,
  } as CSSProperties;

  return (
    <section
      className="universe-game-panel"
      aria-labelledby={titleId}
      data-testid="universe-game-panel"
    >
      <header className="universe-game-level">
        <div className="universe-game-level-copy">
          <p className="universe-game-kicker">Practice level</p>
          <h2 id={titleId}>Level {number(level.level)}</h2>
          <div className="universe-game-xp-line">
            <strong data-testid="universe-game-xp">
              {number(game.practiceXp)} XP
            </strong>
            <span>in this practice record</span>
          </div>
          <p className="universe-game-rule">
            <strong>1 XP</strong> = 1 completed focused minute. Quality and
            verdicts never add or remove XP.
          </p>
        </div>

        <div
          className="universe-game-level-ring"
          style={levelStyle}
          aria-hidden="true"
        >
          <span>{level.percent}%</span>
          <small>this level</small>
        </div>

        <div className="universe-game-level-progress">
          <div className="universe-game-level-progress-copy">
            <span>
              <strong>{number(level.xpIntoLevel)}</strong> / {number(levelSpan)}
              {" XP in this level"}
            </span>
            <span>
              {number(level.xpToNext)} XP to Level {number(level.level + 1)}
            </span>
          </div>
          <div
            className="universe-game-progress-track is-level"
            role="progressbar"
            aria-label={`Level ${level.level} progress`}
            aria-valuemin={level.startXp}
            aria-valuemax={level.nextXp}
            aria-valuenow={game.practiceXp}
            aria-valuetext={`${level.xpIntoLevel} of ${levelSpan} XP in Level ${level.level}; ${level.xpToNext} XP to Level ${level.level + 1}`}
          >
            <span style={{ width: `${level.percent}%` }} />
          </div>
          {game.practiceXp === 0 && (
            <p className="universe-game-first-step">
              Complete one focused minute to put the first mark on this bar.
            </p>
          )}
        </div>
      </header>

      <section
        className="universe-game-cabinet"
        aria-labelledby={cabinetTitleId}
      >
        <header className="universe-game-section-head">
          <div>
            <p className="universe-game-kicker">Current record milestones</p>
            <h3 id={cabinetTitleId}>Badge cabinet</h3>
          </div>
          <strong className="universe-game-count">
            {number(game.earnedBadges.length)} earned
          </strong>
        </header>

        {game.earnedBadges.length === 0 ? (
          <div className="universe-game-cabinet-empty" role="status">
            <span className="universe-game-empty-medal" aria-hidden="true" />
            <div>
              <strong>Your first badge is still ahead.</strong>
              <p>
                Badges appear only after the practice record proves them. The
                six exact first milestones are shown below.
              </p>
            </div>
          </div>
        ) : (
          <ul
            className="universe-game-earned-list"
            aria-label={`${game.earnedBadges.length} earned badges`}
          >
            {game.earnedBadges.map((badge) => {
              const track = TRACK_PRESENTATION[badge.track];
              return (
                <li
                  key={badge.id}
                  className="universe-game-earned-badge"
                  data-track={badge.track}
                  title={badge.detail}
                  aria-label={`${badge.title}. ${badge.detail}`}
                >
                  <span className="universe-game-badge-mark">
                    <TrackIcon track={badge.track} />
                  </span>
                  <span className="universe-game-earned-copy">
                    <strong>{badge.title}</strong>
                    <small>{track.shortLabel}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="universe-game-next" aria-labelledby={nextTitleId}>
        <header className="universe-game-section-head">
          <div>
            <p className="universe-game-kicker">What is within reach</p>
            <h3 id={nextTitleId}>Next badges</h3>
          </div>
          <p>One honest milestone per evidence track.</p>
        </header>

        {game.nextBadges.length === 0 ? (
          <div className="universe-game-all-earned" role="status">
            <strong>Every published badge is in your cabinet.</strong>
            <span>
              Your practice record has reached all six track ceilings.
            </span>
          </div>
        ) : (
          <ol
            className="universe-game-next-grid"
            aria-label="Next badge in each evidence track"
          >
            {game.nextBadges.map(
              ({ badge, evidence: count, remaining, percent }) => {
                const track = TRACK_PRESENTATION[badge.track];
                return (
                  <li
                    key={badge.id}
                    className="universe-game-next-card"
                    data-track={badge.track}
                  >
                    <div className="universe-game-next-heading">
                      <span className="universe-game-next-icon">
                        <TrackIcon track={badge.track} />
                      </span>
                      <div>
                        <small>{track.label}</small>
                        <strong>{badge.title}</strong>
                      </div>
                    </div>
                    <p className="universe-game-next-detail">{badge.detail}</p>
                    <div
                      className="universe-game-progress-track"
                      role="progressbar"
                      aria-label={`${track.label}: ${count} of ${badge.threshold} toward ${badge.title}`}
                      aria-valuemin={0}
                      aria-valuemax={badge.threshold}
                      aria-valuenow={count}
                      aria-valuetext={`${count} of ${badge.threshold}; ${remainingCopy(badge.track, remaining)}`}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <div className="universe-game-next-numbers">
                      <span>
                        <strong>{number(count)}</strong> /{" "}
                        {number(badge.threshold)}
                      </span>
                      <span>{remainingCopy(badge.track, remaining)}</span>
                    </div>
                  </li>
                );
              },
            )}
          </ol>
        )}
      </section>
    </section>
  );
}
