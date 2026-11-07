const MIME_BY_MAGIC: [number[], string][] = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'], // RIFF…WEBP
];

export function sniffImageType(bytes: Uint8Array): string | null {
  for (const [magic, mime] of MIME_BY_MAGIC) if (magic.every((b, i) => bytes[i] === b)) return mime;
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'image/avif';
  return null;
}

/**
 * Validate a picked cover image and shrink very large ones so the library
 * (and backups) stay small. Returns JPEG/WebP when resized, the original otherwise.
 */
export async function prepareCover(bytes: Uint8Array, maxHeight = 1400): Promise<{ mime: string; data: Uint8Array }> {
  const mime = sniffImageType(bytes);
  if (!mime) throw new Error('Choose a JPEG, PNG, GIF, WebP or AVIF image.');
  if (bytes.length > 25 * 1024 * 1024) throw new Error('That image is larger than 25 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as unknown as ArrayBuffer], { type: mime }));
  } catch {
    throw new Error("That image couldn't be read. It may be damaged.");
  }
  if (bitmap.height <= maxHeight && bytes.length < 1.5 * 1024 * 1024) {
    bitmap.close();
    return { mime, data: bytes };
  }
  const scale = Math.min(1, maxHeight / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not resize the image.'))), 'image/jpeg', 0.86));
  return { mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) };
}
