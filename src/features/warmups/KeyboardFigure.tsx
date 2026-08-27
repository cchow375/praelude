import { useId } from "react";
import type { KeyboardFigureSpec } from "./types";

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11] as const;
const BLACK_KEYS = [
  { pitch: 1, x: 10 },
  { pitch: 3, x: 24 },
  { pitch: 6, x: 52 },
  { pitch: 8, x: 66 },
  { pitch: 10, x: 80 },
] as const;
const PITCH_NAMES = [
  "C",
  "C sharp",
  "D",
  "E flat",
  "E",
  "F",
  "F sharp",
  "G",
  "A flat",
  "A",
  "B flat",
  "B",
] as const;

export function KeyboardFigure({
  spec,
  label,
}: {
  spec: KeyboardFigureSpec;
  label: string;
}) {
  const titleId = useId();
  const active = new Set(
    spec.pitchClasses.map((pitch) => ((pitch % 12) + 12) % 12),
  );
  const activeNames = [...active]
    .sort((left, right) => left - right)
    .map((pitch) => PITCH_NAMES[pitch])
    .join(", ");
  return (
    <figure className="warmup-keyboard">
      <svg
        className="warmup-keyboard-keys"
        viewBox="0 0 98 48"
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="none"
      >
        <title id={titleId}>
          {label} pitch-class keyboard. Highlighted: {activeNames}.
        </title>
        <g className="warmup-white-keys">
          {WHITE_KEYS.map((pitch, index) => (
            <rect
              key={pitch}
              x={index * 14}
              y={0}
              width={14}
              height={48}
              className={`warmup-key is-white ${active.has(pitch) ? "is-active" : ""}`}
              data-key-color="white"
              data-pitch-class={pitch}
              data-active={active.has(pitch) ? "true" : "false"}
            />
          ))}
        </g>
        <g className="warmup-black-keys">
          {BLACK_KEYS.map(({ pitch, x }) => (
            <rect
              key={pitch}
              x={x}
              y={0}
              width={8}
              height={29}
              rx={1}
              className={`warmup-key is-black ${active.has(pitch) ? "is-active" : ""}`}
              data-key-color="black"
              data-pitch-class={pitch}
              data-active={active.has(pitch) ? "true" : "false"}
            />
          ))}
        </g>
      </svg>
      {spec.motion && <figcaption>{spec.motion}</figcaption>}
    </figure>
  );
}
