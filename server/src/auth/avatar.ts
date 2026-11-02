const MAX_AVATAR_BYTES = 200_000;

/** Solo acepta JPEG pequeños. Nunca se sirven SVG, HTML o el MIME del cliente. */
export function decodeAvatar(raw: unknown): Buffer {
  if (typeof raw !== 'string' || raw.length > 270_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error('La foto debe ser una imagen JPEG válida de hasta 200 KB');
  }
  const bytes = Buffer.from(raw.slice('data:image/jpeg;base64,'.length), 'base64');
  if (bytes.length < 12 || bytes.length > MAX_AVATAR_BYTES || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error('La foto no es un JPEG válido');
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ((marker === 0xc0 || marker === 0xc2) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width < 1 || height < 1 || width > 512 || height > 512) throw new Error('La foto debe medir como máximo 512 × 512 píxeles');
      return bytes;
    }
    offset += length;
  }
  throw new Error('No se pudo reconocer la imagen. Elegí otra foto.');
}
