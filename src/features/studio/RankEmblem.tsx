import { useId } from "react";

export const STUDIO_RANKS = [
  "Prelude",
  "Etude",
  "Arabesque",
  "Nocturne",
  "Scherzo",
  "Sonata",
  "Rhapsody",
  "Concerto",
  "Cadenza",
  "Opus",
] as const;
export const RANK_COLORS = [
  "#a4b7c7",
  "#bdad88",
  "#79b8ae",
  "#8d9ece",
  "#b3a0d1",
  "#c3a17f",
  "#8ec4d0",
  "#d1b978",
  "#cda5bc",
  "#d8ddeb",
];

export function RankEmblem({
  rank,
  small = false,
}: {
  rank: number;
  small?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const color = RANK_COLORS[Math.min(9, Math.max(0, rank - 1))];
  return (
    <svg
      className={`rank-emblem${small ? " is-small" : ""}`}
      viewBox="0 0 140 150"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-metal`} x2=".8" y2="1">
          <stop stopColor="#f2f6ff" />
          <stop offset=".4" stopColor={color} />
          <stop offset="1" stopColor="#5a697d" />
        </linearGradient>
      </defs>
      <path
        d="M70 10 118 38V94L70 133 22 94V38Z"
        fill={color}
        fillOpacity=".07"
        stroke={color}
        strokeOpacity=".3"
      />
      <path
        d="M70 22 107 44V89L70 119 33 89V44Z"
        fill="none"
        stroke={`url(#${id}-metal)`}
        strokeWidth="2.5"
      />
      <path
        d="M70 33 96 49V83L70 104 44 83V49Z"
        fill={color}
        fillOpacity=".1"
      />
      <path
        d="M61 81V54l23-5v26m-23-15 23-5"
        fill="none"
        stroke={`url(#${id}-metal)`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse
        cx="55"
        cy="83"
        rx="8"
        ry="5.5"
        transform="rotate(-22 55 83)"
        fill={color}
      />
      <ellipse
        cx="78"
        cy="77"
        rx="8"
        ry="5.5"
        transform="rotate(-22 78 77)"
        fill={color}
      />
      {rank >= 3 && (
        <path
          d="m16 49-6 13 7 32 23 24M124 49l6 13-7 32-23 24"
          fill="none"
          stroke={color}
          strokeWidth="3"
        />
      )}
      {rank >= 6 && (
        <path
          d="m18 103 18 20m-5-4 1-12m76 16 14-20m-12 16-1-12M54 14l16-9 16 9"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      )}
      {rank >= 9 && (
        <path
          d="m50 127 20 15 20-15M64 10l6-9 6 9"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
