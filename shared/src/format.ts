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

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;

/** El nombre de usuario se guarda siempre en minúsculas: `Marcos` == `marcos`. */
export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Reglas del nombre de usuario. Se valida igual en cliente y servidor: en el
 * cliente para avisar rápido, en el servidor porque es el único que decide.
 */
export function checkUsername(raw: string): { ok: boolean; error?: string } {
  const username = normalizeUsername(raw);
  if (username.length < USERNAME_MIN) {
    return { ok: false, error: `El usuario necesita al menos ${USERNAME_MIN} caracteres` };
  }
  if (username.length > USERNAME_MAX) {
    return { ok: false, error: `El usuario no puede pasar de ${USERNAME_MAX} caracteres` };
  }
  if (!/^[a-z][a-z0-9._-]*$/.test(username)) {
    return {
      ok: false,
      error: 'Empezá con una letra y usá solo letras, números, puntos, guiones o guión bajo',
    };
  }
  return { ok: true };
}

export function sanitizeChat(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (clean.length <= 240) return clean;
  // Cortar justo en 240 puede partir un emoji al medio y dejar media letra
  // suelta, que se ve como un rombo con un signo de pregunta.
  const cut = clean.slice(0, 240);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
