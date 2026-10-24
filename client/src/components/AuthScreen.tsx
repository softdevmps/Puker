import { useEffect, useState } from 'react';

import { checkUsername, normalizeUsername } from '@puker/shared';

import type { AuthApi } from '../useAuth';

interface Props {
  auth: AuthApi;
  onNotify(kind: 'info' | 'error' | 'success', text: string): void;
}

export function AuthScreen({ auth, onNotify }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // El callback de Google vuelve con ?error=... si algo salió mal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      onNotify('error', error);
      params.delete('error');
      const query = params.toString();
      window.history.replaceState({}, '', query ? `/?${query}` : '/');
    }
  }, [onNotify]);

  const usernameCheck = checkUsername(username);
  const canSubmit =
    username.length > 0 && password.length >= 8 && (mode === 'login' || usernameCheck.ok);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        await auth.login(normalizeUsername(username), password);
      } else {
        await auth.register(normalizeUsername(username), displayName.trim() || username, password);
        onNotify('success', '¡Cuenta creada! Ya podés armar una mesa.');
      }
      setPassword('');
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'No se pudo entrar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby__card">
        <header className="lobby__header">
          <h1 className="lobby__title">
            Puker <span className="lobby__suits">♠ ♥ ♦ ♣</span>
          </h1>
          <p className="lobby__subtitle">
            {mode === 'login' ? 'Entrá para jugar con tus amigos' : 'Creá tu cuenta y sumate a la mesa'}
          </p>
        </header>

        {auth.googleEnabled ? (
          <>
            <a className="btn btn--google btn--wide" href="/api/auth/google">
              <span className="btn--google__mark" aria-hidden="true">
                G
              </span>
              Continuar con Google
            </a>
            <div className="divider">
              <span>o</span>
            </div>
          </>
        ) : null}

        <form onSubmit={submit}>
          <label className="field">
            <span className="field__label">Usuario</span>
            <input
              className="field__input"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              placeholder="marcos"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
            />
            {mode === 'register' && username.length > 0 && !usernameCheck.ok ? (
              <span className="field__hint field__hint--bad">{usernameCheck.error}</span>
            ) : null}
          </label>

          {mode === 'register' ? (
            <label className="field">
              <span className="field__label">Nombre en la mesa (opcional)</span>
              <input
                className="field__input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Cómo te ven los demás"
                maxLength={16}
                autoComplete="nickname"
              />
            </label>
          ) : null}

          <label className="field">
            <span className="field__label">Contraseña</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : ''}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              maxLength={200}
            />
            {mode === 'register' ? (
              <span className="field__hint">
                No uses la misma que en otros sitios: esto es un proyecto casero entre amigos.
              </span>
            ) : null}
          </label>

          <button type="submit" className="btn btn--primary btn--wide" disabled={!canSubmit || busy}>
            {busy ? 'Un segundo...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <button
          type="button"
          className="linkish"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? '¿No tenés cuenta? Creá una' : '¿Ya tenés cuenta? Entrá'}
        </button>

        <footer className="lobby__footer">
          Fichas de juguete, orgullo real. No hay plata de verdad en ningún lado.
        </footer>
      </div>
    </div>
  );
}
