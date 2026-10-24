/**
 * Sesiones por cookie httpOnly.
 *
 * El token va en una cookie que JavaScript no puede leer (httpOnly). Eso lo
 * hace inmune al robo por XSS, a diferencia de guardarlo en localStorage.
 * En la base solo se guarda el hash del token: si alguien lee la tabla, no
 * puede hacerse pasar por nadie.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

import { config } from '../config.js';
import type { Store, UserRow } from '../db/store.js';

export const SESSION_COOKIE = 'puker_session';
export const OAUTH_STATE_COOKIE = 'puker_oauth_state';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parser mínimo de cookies: alcanza y evita una dependencia más. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function startSession(res: Response, store: Store, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const maxAgeMs = config.sessionDays * 24 * 60 * 60 * 1000;
  store.createSession(hashToken(token), userId, Date.now() + maxAgeMs);
  res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
  return token;
}

export function endSession(req: Request, res: Response, store: Store): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) store.deleteSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function setOAuthState(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions(10 * 60 * 1000));
}

export function clearOAuthState(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
}

/** Usuario detrás de una request, o null si no hay sesión válida. */
export function userFromRequest(req: Request, store: Store): UserRow | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return store.findUserBySessionToken(hashToken(token));
}

/** Usuario detrás del handshake de un socket (mismas cookies del navegador). */
export function userFromCookieHeader(cookieHeader: string | undefined, store: Store): UserRow | null {
  if (!cookieHeader) return null;
  const fake = { headers: { cookie: cookieHeader } } as Request;
  const token = readCookie(fake, SESSION_COOKIE);
  if (!token) return null;
  return store.findUserBySessionToken(hashToken(token));
}
