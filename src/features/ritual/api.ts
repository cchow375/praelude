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

/** The next-launch rollover prompt (Task A3): the LOCAL day a midnight
 * auto-close skipped the ritual for, or null once it has been offered. */
export function dayPhotoPrompt(): Promise<string | null> {
  return invoke<string | null>("day_photo_prompt");
}
