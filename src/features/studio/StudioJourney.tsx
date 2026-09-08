import type { CSSProperties } from "react";
import { RankEmblem, RANK_COLORS, STUDIO_RANKS } from "./RankEmblem";
import type { StudioProgress } from "./studioApi";

export function StudioJourney({ progress }: { progress: StudioProgress }) {
  return (
    <section className="studio-journey" aria-labelledby="studio-journey-title">
      <div className="studio-section-heading">
        <div>
          <h2 id="studio-journey-title">A path worth returning to.</h2>
          <p>Ten divisions in every rank. Every step builds your room.</p>
        </div>
        <span className="studio-pill">
          {progress.divisions_completed} divisions earned
        </span>
      </div>
      <div className="studio-rank-path">
        {STUDIO_RANKS.map((name, i) => {
          const rank = i + 1,
            done = progress.rank_index > rank,
            active = progress.rank_index === rank;
          return (
            <article
              key={name}
              className={`studio-rank-stop${active ? " is-current" : ""}${done ? " is-earned" : ""}`}
              style={{ "--rank-color": RANK_COLORS[i] } as CSSProperties}
              aria-current={active ? "step" : undefined}
            >
              <span className="studio-rank-number">
                {String(rank).padStart(2, "0")}
              </span>
              <RankEmblem rank={rank} small />
              <h3>{name}</h3>
              <p>
                {done
                  ? "All ten divisions earned"
                  : active
                    ? `Division ${progress.division} of 10`
                    : `${100 + i * 50} XP per division`}
              </p>
              <div className="studio-division-marks" aria-hidden="true">
                {Array.from({ length: 10 }, (_, d) => (
                  <i
                    key={d}
                    className={
                      done || (active && d < progress.division - 1)
                        ? "is-filled"
                        : active && d === progress.division - 1
                          ? "is-current"
                          : ""
                    }
                  />
                ))}
              </div>
              <span>
                {done
                  ? "Complete"
                  : active
                    ? "Your current rank"
                    : `${1000 * i + 250 * i * (i - 1)} XP to enter`}
              </span>
            </article>
          );
        })}
      </div>
      <div className="studio-encore">
        <span aria-hidden="true">∞</span>
        <div>
          <h3>The music keeps going.</h3>
          <p>
            After Opus, Encore ranks continue with ten divisions each and the
            same increasing XP curve.
          </p>
        </div>
      </div>
      <details className="studio-rules">
        <summary>How progress is earned</summary>
        <div>
          <p>
            <strong>Focused time:</strong> 1 XP for each ten completed minutes
            in your retained practice record. Idle gaps are excluded by the
            practice timer’s event-based estimate.
          </p>
          <p>
            <strong>Session momentum:</strong> completed-set milestones earn a
            cumulative bonus of 1 XP at 3 sets, 2 at 5, 4 at 7 and 6 at 10
            within one session. These are milestone totals, not a new award on
            every refresh. An unfinished or paused set does not count as
            completed.
          </p>
          <p>
            <strong>Your path:</strong> ten divisions per rank, each costing 100
            XP in Prelude, 150 in Etude, then 50 more per rank. Every completed
            division earns 25 coins.
          </p>
          <p>
            <strong>Your record stays yours:</strong> past practice counts under
            this new system. Resting pieces retains their contribution.
            Corrections can revise XP; owned items stay yours, and new spending
            waits if a correction reduces the earned balance.
          </p>
          <p>
            Ranks celebrate commitment. They do not measure musical ability, and
            your Clean, Sloppy and Again verdicts are always yours to give.
          </p>
        </div>
      </details>
    </section>
  );
}
