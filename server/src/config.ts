/**
 * Configuración por variables de entorno.
 *
 * Todo tiene un default razonable para desarrollo: `npm run dev` funciona sin
 * crear ningún archivo .env. Lo único que hay que configurar sí o sí en
 * producción es SESSION_SECRET y, si querés login con Google, sus credenciales.
 */

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

function env(name: string): string | undefined;
function env(name: string, fallback: string): string;
function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

const isProduction = env('NODE_ENV') === 'production';

/** URL pública del sitio. Google la necesita para volver después del login. */
const publicUrl = (env('PUBLIC_URL') ?? 'http://localhost:5173').replace(/\/$/, '');

const googleClientId = env('GOOGLE_CLIENT_ID');
const googleClientSecret = env('GOOGLE_CLIENT_SECRET');

export const config = {
  isProduction,
  port: Number(env('PORT', '3001')),
  host: env('HOST', '0.0.0.0'),
  publicUrl,

  /** Archivo de la base. `:memory:` en los tests. */
  databaseFile: resolve(env('DATABASE_FILE', './data/puker.db')),

  /**
   * Clave para firmar cosas. En producción es obligatoria: si cambia, se
   * invalidan todas las sesiones abiertas.
   */
  sessionSecret: (() => {
    const secret = env('SESSION_SECRET');
    if (secret) return secret;
    if (isProduction) {
      throw new Error(
        'Falta SESSION_SECRET. Generá una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    // En desarrollo se genera una al vuelo; reiniciar cierra las sesiones.
    return randomBytes(32).toString('hex');
  })(),

  sessionDays: Number(env('SESSION_DAYS', '30')),

  google: {
    enabled: Boolean(googleClientId && googleClientSecret),
    clientId: googleClientId ?? '',
    clientSecret: googleClientSecret ?? '',
    redirectUri: `${publicUrl}/api/auth/google/callback`,
  },

  /** Servidores ICE para la voz. */
  voice: {
    stunUrls: (env('STUN_URLS', 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'))
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    /** Host del TURN propio, ej: turn:poker.midominio.com:3478 */
    turnUrls: (env('TURN_URLS', ''))
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    /**
     * Secreto compartido con coturn (`use-auth-secret`). El servidor genera
     * credenciales temporales con HMAC en vez de usuarios fijos.
     */
    turnSecret: env('TURN_SECRET', ''),
    /** Validez de las credenciales TURN, en segundos. */
    turnTtlSec: Number(env('TURN_TTL_SEC', '14400')),
  },
} as const;

export type Config = typeof config;
