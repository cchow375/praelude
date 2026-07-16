import type { ButtonHTMLAttributes } from "react";
import "./ui.css";

/**
 * The ONLY two button shapes in v3. There is no "outlined"/"bordered" variant —
 * primary is a solid inverted fill, text is a borderless label. Adding a third
 * variant here is a design regression (see Global Constraints: no outlined
 * buttons); the Button.test.tsx compile guard enforces it.
 */
export type ButtonVariant = "primary" | "text";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "text",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = `ck-btn ck-btn-${variant}${className ? ` ${className}` : ""}`;
  return <button type={type} className={cls} {...rest} />;
}
