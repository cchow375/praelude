import type { ReactNode, SVGProps } from "react";

/** Every glyph accepts the standard SVG props plus a pixel `size` (default 16). */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * The day sheet's icon set: inline monochrome SVG, one consistent 1.5px stroke,
 * `currentColor` so each glyph inherits its row's ink (design law: no emoji, no
 * icon-font dependency). Every glyph is decorative — its control carries a text
 * label or aria-label — so the glyphs are aria-hidden.
 */
function Glyph({
  children,
  size = 16,
  ...props
}: { children: ReactNode; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* The two checkbox glyphs are deliberately NOT geometric: on paper a checkbox is
   a box someone drew, so the square is a slightly uneven closed curve and the tick
   is one pen sweep that overshoots the top-right corner the way a real one does.
   The tick carries its own class so the stylesheet can ink it in --accent (the
   pen) while the box stays in the row's ink. */

/** An empty plan-item checkbox — a hand-drawn square. */
export function BoxIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.3 5.9c2.9-.8 10.6-1 13.6-.4.7 3 .6 10.4 0 13.2-3.2.7-10.7.6-13.5-.1-.7-3.1-.6-9.9-.1-12.7z" />
    </Glyph>
  );
}

/** A checked plan-item checkbox — the same square, ticked in one stroke. */
export function BoxCheckedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.3 5.9c2.9-.8 10.6-1 13.6-.4.7 3 .6 10.4 0 13.2-3.2.7-10.7.6-13.5-.1-.7-3.1-.6-9.9-.1-12.7z" />
      <path
        className="ck-ns-tick"
        strokeWidth="2"
        d="M6.6 12.2c1.7 1.2 3 3.2 4.2 5.6C13.1 12.4 16.9 7.2 21.4 3.4"
      />
    </Glyph>
  );
}

/** A piece heading: a single note. */
export function PieceIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 18V6l9-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="15.5" cy="16" r="2.5" />
    </Glyph>
  );
}

/** A timed block: a clock. */
export function ClockIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Glyph>
  );
}

/** Goal promotion: a flag. */
export function FlagIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 21V4" />
      <path d="M6 4.5h11l-2 3.5 2 3.5H6" />
    </Glyph>
  );
}

/** A quiet add affordance. */
export function PlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Glyph>
  );
}

/** A fold's disclosure chevron (points right when closed; CSS rotates it open). */
export function ChevronIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 6l6 6-6 6" />
    </Glyph>
  );
}

/** A quiet remove/unlink affordance. */
export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Glyph>
  );
}

/** Lesson notes: a folded-corner page. */
export function NotesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </Glyph>
  );
}
