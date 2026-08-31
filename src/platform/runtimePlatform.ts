/**
 * Coarse runtime platform used only to keep user-facing capability copy honest.
 * Native behavior and security decisions must stay in the Tauri/Rust layer.
 */
export type RuntimePlatform = "windows" | "other";

export function runtimePlatformFromUserAgent(
  userAgent: string,
): RuntimePlatform {
  return /\bWindows(?: NT)?\b/iu.test(userAgent) ? "windows" : "other";
}

export function runtimePlatform(): RuntimePlatform {
  return runtimePlatformFromUserAgent(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
}
