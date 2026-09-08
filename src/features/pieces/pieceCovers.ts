/** User artwork is copied into a bounded thumbnail; the source file stays untouched. */
export const COVER_EDGE = 480;
export const COVER_MAX_DATA_LENGTH = 245_760;

export function coverCrop(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("This image has no readable dimensions.");
  }
  const edge = Math.min(width, height);
  return { x: (width - edge) / 2, y: (height - edge) / 2, edge, output: Math.min(edge, COVER_EDGE) };
}

export async function preparePieceCover(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 15 * 1024 * 1024) throw new Error("Choose an image smaller than 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image could not be opened. Try another image."));
      image.src = url;
    });
    const crop = coverCrop(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = crop.output;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable. Please try again.");
    context.fillStyle = "#20232b";
    context.fillRect(0, 0, crop.output, crop.output);
    context.drawImage(image, crop.x, crop.y, crop.edge, crop.edge, 0, 0, crop.output, crop.output);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (!dataUrl.startsWith("data:image/jpeg;base64,") || dataUrl.length > COVER_MAX_DATA_LENGTH) {
      throw new Error("This image could not be reduced to a cover. Try a simpler image.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Stable, code-native artwork gives every score an identity without bundled images. */
export function coverPalette(title: string, composer: string | null): number {
  let hash = 0;
  for (const character of `${composer ?? ""}:${title}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
}

export function normalizePieceSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}
