/**
 * Hash de contraseñas con scrypt (viene en Node, no hace falta instalar nada).
 *
 * scrypt es una función "memory-hard": obliga a usar mucha RAM por intento, lo
 * que encarece muchísimo un ataque de fuerza bruta con GPUs. Está entre las
 * recomendadas por OWASP junto con Argon2id y bcrypt.
 *
 * Importante: se usa la versión ASÍNCRONA. La sincrónica bloquea el event loop
 * ~100ms por hash, y eso congelaría la partida de todos los jugadores mientras
 * alguien hace login.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** N=2^16 con r=8 pide unos 64 MB por hash. */
const PARAMS = { N: 65536, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 8;

/** Formato: scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: PARAMS.maxmem,
  });

  // Comparación de tiempo constante: comparar con === filtra información
  // sobre cuántos bytes coincidieron.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface PasswordProblem {
  ok: boolean;
  error?: string;
}

export function checkPasswordStrength(password: string): PasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres` };
  }
  if (password.length > 200) {
    return { ok: false, error: 'La contraseña es demasiado larga' };
  }
  // Un filtro mínimo de las más obvias; no pretende ser una lista completa.
  const comunes = ['12345678', 'password', 'contrasena', 'qwertyui', '11111111', 'password1'];
  if (comunes.includes(password.toLowerCase())) {
    return { ok: false, error: 'Esa contraseña es de las más usadas del mundo, elegí otra' };
  }
  return { ok: true };
}
