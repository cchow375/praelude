import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Metronome icon set — pure monochrome inline SVG, one consistent 1.5px stroke,
// `currentColor`, no fills except where a shape reads best solid (play/stop,
// note head, speaker cone). No emoji, no icon-font dependency. Every glyph is
// decorative (`aria-hidden`); the accessible name always lives on the button.
// ---------------------------------------------------------------------------

export interface MetroIconProps {
  size?: number;
  className?: string;
}

function Glyph({
  size = 20,
  className,
  children,
}: MetroIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** The instrument itself: a pyramid body with a pendulum + weight. */
export function MetronomeGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 3h6l3 18H6z" />
      <path d="M12 18 15 8" />
      <path d="M6 21h12" />
    </Glyph>
  );
}

/** Transport: play (solid triangle). */
export function PlayGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </Glyph>
  );
}

/** Transport: stop (solid square). */
export function StopGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <rect
        x="6.5"
        y="6.5"
        width="11"
        height="11"
        rx="1.5"
        fill="currentColor"
      />
    </Glyph>
  );
}

/** Tap tempo: a struck dot with a rising ripple. */
export function TapGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="13.5" r="3" fill="currentColor" stroke="none" />
      <path d="M6.5 9a7 7 0 0 1 11 0" />
    </Glyph>
  );
}

/** Beats per bar: grouped beat lines, downbeat taller. */
export function BeatsGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 6v12" />
      <path d="M10 9v9" />
      <path d="M15 9v9" />
      <path d="M20 9v9" />
    </Glyph>
  );
}

/** Subdivision: a beamed group of subdivided stems. */
export function SubdivGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6h12" />
      <path d="M6 6v11" />
      <path d="M12 6v11" />
      <path d="M18 6v11" />
    </Glyph>
  );
}

/** Click sound: an eighth note. */
export function SoundGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8.5" cy="17.5" r="2.6" fill="currentColor" stroke="none" />
      <path d="M11.1 17.5V6l6 2.2" />
    </Glyph>
  );
}

/** Volume: a speaker cone with one sound wave. */
export function VolumeGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" />
      <path d="M16 9.2a5 5 0 0 1 0 5.6" />
    </Glyph>
  );
}

/** Accent first beat: a musical accent mark. */
export function AccentGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 8l12 4-12 4" />
    </Glyph>
  );
}

/** Boost: a speaker cone with a plus. */
export function BoostGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 9.5v5h3.5L11 18V6L6.5 9.5z" fill="currentColor" />
      <path d="M16.5 10v4" />
      <path d="M14.5 12h4" />
    </Glyph>
  );
}

/** Stepper minus. */
export function MinusGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 12h12" />
    </Glyph>
  );
}

/** Stepper plus. */
export function PlusGlyph(props: MetroIconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 6v12" />
      <path d="M6 12h12" />
    </Glyph>
  );
}
