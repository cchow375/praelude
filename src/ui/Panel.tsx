import type { ReactNode } from "react";
import "./ui.css";

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * A flat surface on `--bg-raised` bounded by a single 1px hairline — no glow,
 * no drop shadow, no decorative frame. Groups related rows; nothing more.
 */
export function Panel({ title, actions, children, className }: PanelProps) {
  const hasHead = title != null || actions != null;
  return (
    <section className={`ck-panel${className ? ` ${className}` : ""}`}>
      {hasHead && (
        <header className="ck-panel-head">
          {title != null ? (
            <h2 className="ck-panel-title">{title}</h2>
          ) : (
            <span />
          )}
          {actions != null ? (
            <div className="ck-panel-actions">{actions}</div>
          ) : null}
        </header>
      )}
      <div className="ck-panel-body">{children}</div>
    </section>
  );
}
