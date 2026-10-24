import { randomBytes, randomInt } from 'node:crypto';

/** 2^47: el techo de `randomInt` es 2^48-1, así que esto entra con margen. */
const SCALE = 2 ** 47;

/**
 * Fuente aleatoria criptográfica para mezclar el mazo.
 *
 * `Math.random` no sirve acá: su estado es predecible y, en teoría, alguien
 * podría anticipar el mazo. `randomInt` usa el CSPRNG del sistema.
 *
 * Devuelve un float en [0, 1): 47 bits de entropía, sesgo despreciable para
 * barajar 52 cartas.
 */
export const secureRandom = (): number => randomInt(0, SCALE) / SCALE;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

/** Código de sala corto y fácil de dictar por voz. */
export function makeRoomCode(length = 4): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export function makeToken(): string {
  return randomBytes(24).toString('base64url');
}
