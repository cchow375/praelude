import { invoke } from "@tauri-apps/api/core";

/** Thin, injectable IPC boundary over the A3 day_photo_* commands. */
export function dayPhotoSave(
  day: string,
  jpegBase64: string,
  thumbBase64: string,
): Promise<void> {
  return invoke<void>("day_photo_save", { day, jpegBase64, thumbBase64 });
}

export interface DayPhotoThumb {
  day: string;
  thumb_base64: string;
}

export function dayPhotoThumbs(
  from: string,
  to: string,
): Promise<DayPhotoThumb[]> {
  return invoke<DayPhotoThumb[]>("day_photo_thumbs", { from, to });
}

export function dayPhotoRead(day: string): Promise<string> {
  return invoke<string>("day_photo_read", { day });
}

export function dayPhotoDelete(day: string): Promise<void> {
  return invoke<void>("day_photo_delete", { day });
}

/** The next-launch rollover prompt (Task A3): the oldest LOCAL day a
 * midnight auto-close skipped the ritual for that has not yet been
 * photographed, or null. F4 fix wave: a non-destructive PEEK — call it as
 * often as you like (including a React StrictMode double mount) with zero
 * risk of losing a day. Pair with `dayPhotoPromptDismiss` once the user has
 * actually acted on the day it returns. */
export function dayPhotoPrompt(): Promise<string | null> {
  return invoke<string | null>("day_photo_prompt");
}

/** Consume exactly one pending rollover day — call once the user has
 * actually acted on it (photographed or skipped). Idempotent: dismissing a
 * day that was never pending (the common case — a live, same-day
 * end-of-session photo) is a harmless no-op. */
export function dayPhotoPromptDismiss(day: string): Promise<void> {
  return invoke<void>("day_photo_prompt_dismiss", { day });
}
