/**
 * Login con Google (OAuth 2.0, flujo de código de autorización).
 *
 * El intercambio del código por el token ocurre servidor-a-servidor, así que el
 * client_secret nunca toca el navegador. El perfil se pide al endpoint
 * `userinfo` con el access_token recién obtenido: como el token vino directo de
 * Google por TLS, no hace falta validar firmas de JWT a mano.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export function buildAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: options.state,
    // `select_account` evita que entre siempre con la última cuenta usada.
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForProfile(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleProfile> {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text().catch(() => '');
    throw new Error(`Google rechazó el código (${tokenResponse.status}): ${detail.slice(0, 200)}`);
  }

  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error('Google no devolvió access_token');

  const profileResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) {
    throw new Error(`No se pudo leer el perfil de Google (${profileResponse.status})`);
  }

  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!profile.sub) throw new Error('Google no devolvió el identificador de la cuenta');

  return {
    sub: profile.sub,
    email: profile.email ?? null,
    emailVerified: Boolean(profile.email_verified),
    name: profile.name ?? null,
    picture: profile.picture ?? null,
  };
}
