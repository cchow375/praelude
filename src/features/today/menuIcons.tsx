import type { ReactNode, SVGProps } from "react";

/**
 * The Today menu's icon set: inline monochrome SVG, one consistent 1.5px stroke,
 * `currentColor` so each icon inherits its entry's ink. They are decorative —
 * every menu entry is labelled in text, so the glyphs are aria-hidden and the
 * button text is the accessible name. No emoji, no icon-font dependency.
 */
function Glyph({
  children,
  ...props
}: { children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
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

/** The CodaKiller app mark: the musical coda sign (a circle crossed through). */
export function CodaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2.5" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="21.5" y2="12" />
    </Glyph>
  );
}

/** Today's Practice: a lined day sheet. */
export function SheetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </Glyph>
  );
}

/** Score: a beamed pair of notes. */
export function NoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M9 17V5l11-2v12" />
      <circle cx="6" cy="17" r="3" />
      <circle cx="17" cy="15" r="3" />
    </Glyph>
  );
}

/** Brain (assistant): a four-point spark. */
export function SparkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
    </Glyph>
  );
}

/** Ledger: a bulleted record list. */
export function ListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </Glyph>
  );
}

/** Universe: a body and its orbit. */
export function OrbitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-24 12 12)" />
    </Glyph>
  );
}

/** Settings: two labelled sliders. */
export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2" />
      <circle cx="15" cy="16" r="2" />
    </Glyph>
  );
}

/** The panel close affordance. */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Glyph>
  );
}
