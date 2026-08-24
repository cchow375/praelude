/**
 * Frame -> base64 JPEG, entirely on the frontend (Task A3).
 *
 * The Rust backend never touches an image codec: the webview already has a
 * hardware-accelerated canvas resampler, so both the full frame and its
 * <=320px thumbnail are produced here and handed to `day_photo_save` in one
 * call.
 */

/** Longest edge of a stored thumbnail, in px. */
export const THUMB_MAX_EDGE = 320;

interface Size {
  width: number;
  height: number;
}

/** Pure sizing step, exercised directly by tests since jsdom has no canvas
 * backend. Never upscales a source already under `maxEdge`. */
export function thumbnailSize(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): Size {
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= maxEdge) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  };
}

function sourceDimensions(source: HTMLVideoElement | HTMLImageElement): Size {
  const width =
    "videoWidth" in source ? source.videoWidth : source.naturalWidth;
  const height =
    "videoHeight" in source ? source.videoHeight : source.naturalHeight;
  return { width, height };
}

function encode(
  source: HTMLVideoElement | HTMLImageElement,
  size: Size,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no 2d canvas context"));
  ctx.drawImage(source, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Promise.resolve(base64);
}

/** Draw `source` into a <=320px canvas and return base64 JPEG (no data: prefix). */
export function toThumbnailBase64(
  source: HTMLVideoElement | HTMLImageElement,
  maxEdge: number = THUMB_MAX_EDGE,
): Promise<string> {
  const { width, height } = sourceDimensions(source);
  if (width === 0 || height === 0) {
    return Promise.reject(new Error("source has no frame to capture"));
  }
  return encode(source, thumbnailSize(width, height, maxEdge));
}

/** Full-size frame as base64 JPEG (no data: prefix). */
export function toFullBase64(
  source: HTMLVideoElement | HTMLImageElement,
): Promise<string> {
  const { width, height } = sourceDimensions(source);
  if (width === 0 || height === 0) {
    return Promise.reject(new Error("source has no frame to capture"));
  }
  return encode(source, { width, height });
}
