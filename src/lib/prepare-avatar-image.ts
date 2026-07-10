import { AVATAR_ALLOWED_MIMES } from './account-profile-provider';

const AVATAR_EDGE = 480;

/**
 * Crop an avatar image to a centred square (capped at 480×480) before
 * upload, mirroring the App (Rust FFI) and H5 pipelines. Native Canvas,
 * no third-party dependency.
 *
 * png / jpeg / webp only. gif is rejected up front by `file.type` — the
 * browser happily decodes a gif's first frame, so a decode failure alone
 * would not stop an animated avatar from slipping through.
 */
export async function prepareAvatarImage(file: File): Promise<File> {
  if (!AVATAR_ALLOWED_MIMES.includes(file.type)) {
    throw new Error('avatar: unsupported format');
  }
  const bitmap = await decodeOriented(file);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    if (w === 0 || h === 0) throw new Error('avatar: empty image');
    // Centre-crop to a square, then cap the edge at 480 (never upscale).
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const edge = Math.min(side, AVATAR_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('avatar: canvas unavailable');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (blob === null) throw new Error('avatar: encode failed');
    return new File([blob], 'avatar.png', { type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/** Decode with EXIF orientation applied; fall back for browsers that
 *  reject the options argument. */
async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}
