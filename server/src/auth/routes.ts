/**
 * Rutas HTTP de cuentas: registro, login, logout, perfil y Google.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

import {
  type AuthInfo,
  type AuthUser,
  checkUsername,
  normalizeUsername,
  sanitizeName,
} from '@puker/shared';

import { config } from '../config.js';
import type { Store, UserRow } from '../db/store.js';
import { buildAuthUrl, exchangeCodeForProfile } from './google.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from './passwords.js';
import { decodeAvatar } from './avatar.js';
import {
  OAUTH_STATE_COOKIE,
  clearOAuthState,
  endSession,
  readCookie,
  setOAuthState,
  startSession,
  userFromRequest,
} from './sessions.js';

/** Hash falso para gastar el mismo tiempo cuando el usuario no existe. */
const DUMMY_HASH =
  'scrypt$65536$8$1$YWFhYWFhYWFhYWFhYWFhYQ==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    transferAlias: user.transfer_alias,
    createdAt: user.created_at,
    hasPassword: Boolean(user.password_hash),
    hasGoogle: Boolean(user.google_sub),
  };
}

/**
 * Limitador de intentos en memoria. No reemplaza a un WAF, pero frena el
 * caso real: alguien probando contraseñas contra la cuenta de un amigo.
 */
class AttemptLimiter {
  private readonly attempts = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): { allowed: boolean; retryInSec: number } {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) {
      return { allowed: true, retryInSec: 0 };
    }
    if (entry.count < this.max) return { allowed: true, retryInSec: 0 };
    return {
      allowed: false,
      retryInSec: Math.ceil((entry.firstAt + this.windowMs - now) / 1000),
    };
  }

  /** Suma un intento a la ventana actual. */
  record(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAt: now });
      return;
    }
    entry.count++;
  }

  /** Un acierto limpia el contador. */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.firstAt > this.windowMs) this.attempts.delete(key);
    }
  }
}

export function createAuthRouter(store: Store, onProfileChanged: (user: UserRow) => void = () => {}): Router {
  const router = Router();
  const loginLimiter = new AttemptLimiter(8, 10 * 60 * 1000);
  /**
   * El límite de registros es por IP, y los amigos de una misma casa salen
   * todos por la misma. 20 por hora frena el spam sin dejar afuera a un grupo
   * que se está anotando junto desde el mismo wifi.
   */
  const registerLimiter = new AttemptLimiter(20, 60 * 60 * 1000);
  setInterval(() => {
    loginLimiter.prune();
    registerLimiter.prune();
  }, 5 * 60 * 1000).unref?.();

  const clientIp = (req: { ip?: string }): string => req.ip ?? 'desconocido';

  router.get('/me', (req, res) => {
    const user = userFromRequest(req, store);
    const info: AuthInfo = {
      user: user ? toAuthUser(user) : null,
      googleEnabled: config.google.enabled,
    };
    res.json(info);
  });

  router.post('/register', async (req, res) => {
    try {
      const limit = registerLimiter.check(clientIp(req));
      if (!limit.allowed) {
        res.status(429).json({ error: `Demasiadas cuentas creadas. Probá en ${limit.retryInSec}s.` });
        return;
      }

      const body = req.body as { username?: string; displayName?: string; password?: string };
      const username = normalizeUsername(String(body.username ?? ''));
      const password = String(body.password ?? '');

      const usernameCheck = checkUsername(username);
      if (!usernameCheck.ok) {
        res.status(400).json({ error: usernameCheck.error });
        return;
      }

      const passwordCheck = checkPasswordStrength(password);
      if (!passwordCheck.ok) {
        res.status(400).json({ error: passwordCheck.error });
        return;
      }

      const displayName = sanitizeName(String(body.displayName ?? '')) || username;
      if (store.findUserByUsername(username)) {
        res.status(409).json({ error: 'Ese usuario ya está tomado' });
        return;
      }

      const user = store.createUser({
        username,
        displayName,
        passwordHash: await hashPassword(password),
      });

      registerLimiter.record(clientIp(req));
      startSession(res, store, user.id);
      res.status(201).json({ user: toAuthUser(user) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const body = req.body as { username?: string; password?: string };
      const username = normalizeUsername(String(body.username ?? ''));
      const password = String(body.password ?? '');
      const key = `${clientIp(req)}:${username}`;

      const limit = loginLimiter.check(key);
      if (!limit.allowed) {
        res
          .status(429)
          .json({ error: `Demasiados intentos fallidos. Esperá ${limit.retryInSec}s.` });
        return;
      }

      const user = store.findUserByUsername(username);
      // Se verifica siempre contra algo, exista o no el usuario: si no, el
      // tiempo de respuesta delataría qué usuarios existen.
      const stored = user?.password_hash ?? DUMMY_HASH;
      const valid = await verifyPassword(password, stored);

      if (!user || !user.password_hash || !valid) {
        loginLimiter.record(key);
        res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        return;
      }

      loginLimiter.clear(key);
      store.touchUser(user.id);
      startSession(res, store, user.id);
      res.json({ user: toAuthUser(user) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/logout', (req, res) => {
    endSession(req, res, store);
    res.json({ ok: true });
  });

  router.patch('/profile', (req, res) => {
    const user = userFromRequest(req, store);
    if (!user) {
      res.status(401).json({ error: 'No estás conectado' });
      return;
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Perfil inválido' }); return;
    }
    for (const field of ['displayName', 'bio', 'transferAlias']) {
      if (body[field] !== undefined && typeof body[field] !== 'string') {
        res.status(400).json({ error: 'Los campos del perfil deben ser texto' }); return;
      }
    }
    const displayName = body.displayName === undefined ? user.display_name : sanitizeName(body.displayName as string);
    if (displayName.length < 2) {
      res.status(400).json({ error: 'El nombre necesita al menos 2 caracteres' });
      return;
    }
    const bio = body.bio === undefined ? user.bio : (body.bio as string).trim();
    const transferAlias = body.transferAlias === undefined ? user.transfer_alias : (body.transferAlias as string).trim() || null;
    if (bio.length > 160) { res.status(400).json({ error: 'La descripción admite hasta 160 caracteres' }); return; }
    if (transferAlias && !/^[a-zA-Z0-9.-]{1,100}$/.test(transferAlias)) {
      res.status(400).json({ error: 'El alias admite letras, números, puntos y guiones, sin espacios (hasta 100 caracteres)' }); return;
    }
    let avatar: Buffer | null | undefined;
    try {
      if (body.avatarDataUrl !== undefined) avatar = body.avatarDataUrl === null ? null : decodeAvatar(body.avatarDataUrl);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const updated = store.updateProfile(user.id, { displayName, bio, transferAlias, avatar });
    onProfileChanged(updated);
    res.json({ user: toAuthUser(updated) });
  });

  router.get('/avatar/:id/:revision', (req, res) => {
    if (!userFromRequest(req, store)) { res.sendStatus(401); return; }
    const id = Number(req.params.id);
    const revision = req.params.revision;
    if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{24}$/.test(revision)) { res.sendStatus(404); return; }
    const image = store.avatarFor(id, revision);
    if (!image) { res.sendStatus(404); return; }
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type('image/jpeg').send(Buffer.from(image));
  });

  /** Permite a una cuenta de Google agregarse contraseña, y cambiarla. */
  router.post('/password', async (req, res) => {
    try {
      const user = userFromRequest(req, store);
      if (!user) {
        res.status(401).json({ error: 'No estás conectado' });
        return;
      }

      const body = req.body as { currentPassword?: string; newPassword?: string };
      const newPassword = String(body.newPassword ?? '');

      if (user.password_hash) {
        const current = String(body.currentPassword ?? '');
        if (!(await verifyPassword(current, user.password_hash))) {
          res.status(401).json({ error: 'La contraseña actual no coincide' });
          return;
        }
      }

      const check = checkPasswordStrength(newPassword);
      if (!check.ok) {
        res.status(400).json({ error: check.error });
        return;
      }

      store.setPasswordHash(user.id, await hashPassword(newPassword));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ------------------------------------------------------------- Google

  router.get('/google', (req, res) => {
    if (!config.google.enabled) {
      res.status(503).type('text/plain').send('El login con Google no está configurado en este servidor');
      return;
    }
    const state = randomBytes(24).toString('base64url');
    setOAuthState(res, state);
    res.redirect(
      buildAuthUrl({
        clientId: config.google.clientId,
        redirectUri: config.google.redirectUri,
        state,
      }),
    );
    void req;
  });

  router.get('/google/callback', async (req, res) => {
    const fail = (message: string) => {
      clearOAuthState(res);
      res.redirect(`/?error=${encodeURIComponent(message)}`);
    };

    try {
      if (!config.google.enabled) return fail('Google no está configurado');

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const expected = readCookie(req, OAUTH_STATE_COOKIE) ?? '';

      if (typeof req.query.error === 'string') return fail('Cancelaste el acceso con Google');
      if (!code) return fail('Google no devolvió el código');

      // Comparación de tiempo constante del state (anti-CSRF).
      const a = Buffer.from(state);
      const b = Buffer.from(expected);
      if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
        return fail('La sesión de Google expiró, probá de nuevo');
      }

      const profile = await exchangeCodeForProfile({
        code,
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: config.google.redirectUri,
      });

      let user = store.findUserByGoogleSub(profile.sub);

      if (!user) {
        // Si ya hay una cuenta con ese usuario derivado del mail, se vincula
        // en vez de crear una cuenta duplicada.
        const base = deriveUsername(profile);
        const existing = store.findUserByUsername(base);
        if (existing && !existing.google_sub) {
          store.linkGoogle(existing.id, profile.sub, profile.picture);
          user = store.findUserById(existing.id);
        } else {
          user = store.createUser({
            username: existing ? uniqueUsername(store, base) : base,
            displayName: sanitizeName(profile.name ?? base) || base,
            googleSub: profile.sub,
            avatarUrl: profile.picture,
          });
        }
      }

      if (!user) return fail('No se pudo crear la cuenta');

      clearOAuthState(res);
      store.touchUser(user.id);
      startSession(res, store, user.id);
      res.redirect('/');
    } catch (error) {
      fail((error as Error).message.slice(0, 120));
    }
  });

  return router;
}

/** Usuario a partir del mail de Google, respetando las reglas de nombre. */
function deriveUsername(profile: { email: string | null; sub: string }): string {
  const local = (profile.email ?? '').split('@')[0] ?? '';
  let candidate = normalizeUsername(local).replace(/[^a-z0-9._-]/g, '');
  if (!/^[a-z]/.test(candidate)) candidate = `g${candidate}`;
  candidate = candidate.slice(0, 16);
  return checkUsername(candidate).ok ? candidate : `g${profile.sub.slice(0, 10)}`;
}

function uniqueUsername(store: Store, base: string): string {
  for (let i = 2; i < 500; i++) {
    const candidate = `${base.slice(0, 13)}${i}`;
    if (!store.findUserByUsername(candidate)) return candidate;
  }
  return `${base.slice(0, 9)}${randomBytes(3).toString('hex')}`;
}
