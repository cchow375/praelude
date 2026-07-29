import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Settings section icons — the same monochrome idiom as the metronome set: one
// 1.5px stroke, `currentColor`, no emoji, no icon font. Each glyph is
// decorative; the section's text label carries the accessible meaning.
// ---------------------------------------------------------------------------

interface IconProps {
  size?: number;
}

function Glyph({ size = 16, children }: IconProps & { children: ReactNode }) {
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
    >
      {children}
    </svg>
  );
}

/** How-to / guide: an open book. */
export function GuideIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 6.5C10.5 5 8 4.5 4 5v13c4-.5 6.5 0 8 1.5" />
      <path d="M12 6.5C13.5 5 16 4.5 20 5v13c-4-.5-6.5 0-8 1.5z" />
    </Glyph>
  );
}

/** Assistant (Brain): a four-point spark. */
export function AssistantIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3c.6 3.8 1.4 4.6 5.2 5.2-3.8.6-4.6 1.4-5.2 5.2-.6-3.8-1.4-4.6-5.2-5.2C10.6 7.6 11.4 6.8 12 3z" />
      <path d="M18 14c.3 1.7.7 2.1 2.4 2.4-1.7.3-2.1.7-2.4 2.4-.3-1.7-.7-2.1-2.4-2.4 1.7-.3 2.1-.7 2.4-2.4z" />
    </Glyph>
  );
}

/** Voice & wake-word: a microphone. */
export function VoiceIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
    </Glyph>
  );
}

/** Metronome: the instrument. */
export function MetronomeSectionIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 3h6l3 18H6z" />
      <path d="M12 18 15 8" />
      <path d="M6 21h12" />
    </Glyph>
  );
}

/** Ladder defaults: ascending steps. */
export function LadderIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20h4v-5H4zM10 20h4v-9h-4zM16 20h4V6h-4z" />
    </Glyph>
  );
}

/** Calendar capacity: a calendar grid. */
export function CalendarIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </Glyph>
  );
}

/** Vault directory: a folder. */
export function FolderIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    </Glyph>
  );
}

/** Verdict aliases: a tag. */
export function TagIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8z" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Books: a small stack of volumes. */
export function BooksIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 4h5a1 1 0 0 1 1 1v14a1 1 0 0 0-1-1H5z" />
      <path d="M19 4h-5a1 1 0 0 0-1 1v14a1 1 0 0 1 1-1h5z" />
    </Glyph>
  );
}

/** Appearance: a light/dark contrast disc. */
export function AppearanceIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}
