/**
 * Fichas tal como se leen en la mesa: exacto mientras entre en pantalla.
 *
 * En poker el tamaño exacto del stack importa para decidir, así que solo se
 * abrevia cuando los números se vuelven demasiado largos.
 */
export function formatStack(amount: number): string {
  const n = Math.round(amount);
  if (Math.abs(n) < 100_000) return n.toLocaleString('es-AR');
  return formatChips(n);
}

/** Formatea fichas de forma compacta: 1500 -> "1.5K", 2000000 -> "2M". */
export function formatChips(amount: number): string {
  const n = Math.round(amount);
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) {
    const k = n / 1000;
    return `${trim(k)}K`;
  }
  return `${trim(n / 1_000_000)}M`;
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Nombre sin espacios raros ni caracteres de control, acotado en largo. */
export function sanitizeName(raw: string): string {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return clean;
}

export function sanitizeChat(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 240);
}
