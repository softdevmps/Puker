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
  const [error, setError] = useState('');

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
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    // Lee también valores completados por el navegador sin eventos de React.
    const fields = new FormData(event.currentTarget);
    const submittedUsername = normalizeUsername(String(fields.get('username') ?? ''));
    const submittedPassword = String(fields.get('password') ?? '');
    const submittedName = String(fields.get('displayName') ?? '').trim();
    setError('');
    if (!submittedUsername) { setError('Completá tu usuario.'); return; }
    if (!submittedPassword) { setError('Completá tu contraseña.'); return; }
    if (mode === 'register') {
      const check = checkUsername(submittedUsername);
      if (!check.ok) { setError(check.error ?? 'Revisá el usuario.'); return; }
      if (submittedPassword.length < 8) {
        setError('La contraseña necesita al menos 8 caracteres.'); return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await auth.login(submittedUsername, submittedPassword);
      } else {
        await auth.register(submittedUsername, submittedName || submittedUsername, submittedPassword);
        onNotify('success', '¡Cuenta creada! Ya podés armar una mesa.');
      }
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo entrar');
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

        <form onSubmit={submit} onChange={() => setError('')}>
          <label className="field">
            <span className="field__label">Usuario</span>
            <input
              className="field__input"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
            />
            {/* Las reglas aparecen recién si algo no cierra: de entrada son ruido. */}
            {mode === 'register' && username.length > 0 && !usernameCheck.ok ? (
              <span className="field__hint field__hint--bad">{usernameCheck.error}</span>
            ) : null}
          </label>

          {mode === 'register' ? (
            <label className="field">
              <span className="field__label">Nombre en la mesa (opcional)</span>
              <input
                className="field__input"
                name="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
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
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : ''}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              maxLength={200}
            />
          </label>

          {error ? <p className="field__hint field__hint--bad" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? 'Un segundo...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <button
          type="button"
          className="linkish"
          disabled={busy}
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
        >
          {mode === 'login' ? '¿No tenés cuenta? Creá una' : '¿Ya tenés cuenta? Entrá'}
        </button>

        <footer className="lobby__footer">
          Poker entre amigos, con fichas virtuales y cuentas claras.
        </footer>
      </div>
    </div>
  );
}
