import type { ReactNode } from "react";
import "./ui.css";

export interface DisclosureProps {
  summary: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * The density primitive. Secondary content lives behind this so no screen is a
 * wall of controls. Native <details>/<summary> for free keyboard + a11y.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: DisclosureProps) {
  return (
    <details
      className={`ck-disclosure${className ? ` ${className}` : ""}`}
      open={defaultOpen}
    >
      <summary className="ck-disclosure-summary">{summary}</summary>
      <div className="ck-disclosure-body">{children}</div>
    </details>
  );
}
