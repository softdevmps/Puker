import { useCallback, useEffect, useState } from 'react';

import type { AuthInfo, AuthUser } from '@puker/shared';

/**
 * Estado de la cuenta.
 *
 * La sesión vive en una cookie httpOnly que el navegador manda sola: acá no se
 * guarda ningún token, así que un XSS no puede robarla.
 */
export interface AuthApi {
  loading: boolean;
  user: AuthUser | null;
  googleEnabled: boolean;
  login(username: string, password: string): Promise<void>;
  register(username: string, displayName: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateDisplayName(displayName: string): Promise<void>;
  refresh(): Promise<void>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Error del servidor (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export function useAuth(): AuthApi {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const info = await api<AuthInfo>('/api/auth/me');
      setUser(info.user);
      setGoogleEnabled(info.googleEnabled);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(result.user);
  }, []);

  const register = useCallback(
    async (username: string, displayName: string, password: string) => {
      const result = await api<{ user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password }),
      });
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const result = await api<{ user: AuthUser }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    });
    setUser(result.user);
  }, []);

  return { loading, user, googleEnabled, login, register, logout, updateDisplayName, refresh };
}
