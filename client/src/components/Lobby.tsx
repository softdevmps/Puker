import { useState } from 'react';

import { DEFAULT_SETTINGS, type AuthUser, type TableSettings } from '@puker/shared';
import { ChipSet } from './ChipSet';
import { Avatar } from './Avatar';

interface Props {
  user: AuthUser;
  savedRoom: string;
  busy: boolean;
  connected: boolean;
  onCreate(settings: Partial<TableSettings>): Promise<void>;
  onJoin(code: string): Promise<void>;
  onError(message: string): void;
  onShowRanking(): void;
  onShowHistory(): void;
  onShowProfile(): void;
  onLogout(): void;
}

export function Lobby({
  user,
  savedRoom,
  busy,
  connected,
  onCreate,
  onJoin,
  onError,
  onShowRanking,
  onShowHistory,
  onShowProfile,
  onLogout,
}: Props) {
  const [code, setCode] = useState(savedRoom);
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const [maxSeats, setMaxSeats] = useState(DEFAULT_SETTINGS.maxSeats);
  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_SETTINGS.turnTimeSec);
  const [allowRebuy, setAllowRebuy] = useState(true);
  const [entryFee, setEntryFee] = useState(DEFAULT_SETTINGS.entryFee);
  const [rebuyFee, setRebuyFee] = useState(DEFAULT_SETTINGS.rebuyFee);

  const handleCreate = async () => {
    try {
      await onCreate({
        ...DEFAULT_SETTINGS,
        maxSeats,
        turnTimeSec,
        allowRebuy,
        entryFee,
        rebuyFee,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo crear la mesa');
    }
  };

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return onError('El código tiene 4 caracteres');
    try {
      await onJoin(trimmed);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo entrar a la mesa');
    }
  };

  return (
    <div className="lobby">
      <div className="lobby__card">
        <header className="lobby__header">
          <h1 className="lobby__title">
            Puker <span className="lobby__suits">♠ ♥ ♦ ♣</span>
          </h1>
          <button type="button" className="lobby__profile" onClick={onShowProfile}><Avatar src={user.avatarUrl} name={user.displayName} /><span>Mi perfil</span></button>
          <p className="lobby__subtitle">
            Hola, <strong>{user.displayName}</strong>. ¿Armamos una mesa?
          </p>
          {!connected ? <p className="lobby__offline">Conectando con el servidor...</p> : null}
        </header>

        {mode === 'menu' ? (
          <div className="lobby__actions">
            <button
              type="button"
              className="btn btn--primary btn--wide"
              disabled={!connected}
              onClick={() => setMode('create')}
            >
              Crear una mesa
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--wide"
              disabled={!connected}
              onClick={() => setMode('join')}
            >
              Entrar con código
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={onShowRanking}>
              Ver el ranking
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={onShowHistory}>Mis partidas y repartos</button>
          </div>
        ) : null}

        {mode === 'join' ? (
          <div className="lobby__panel">
            <label className="field">
              <span className="field__label">Código de la mesa</span>
              <input
                className="field__input field__input--code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABCD"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <div className="lobby__actions">
              <button
                type="button"
                className="btn btn--primary btn--wide"
                disabled={busy}
                onClick={handleJoin}
              >
                {busy ? 'Entrando...' : 'Entrar'}
              </button>
              <button type="button" className="btn btn--ghost btn--wide" onClick={() => setMode('menu')}>
                Volver
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'create' ? (
          <div className="lobby__panel">
            <div className="field">
              <span className="field__label">Cada uno arranca con 29.000 en fichas</span>
              <ChipSet />
              <span className="field__hint">Ciegas: $50 y $100. Se duplican cada vez que el reparto da la vuelta a la mesa.</span>
            </div>

            <div className="tournament-fees">
              <label className="field"><span className="field__label">Entrada (pesos)</span><input className="field__input" type="number" min={1} max={1000000} step={1} value={entryFee} onChange={(event) => setEntryFee(Number(event.target.value))} /></label>
              <label className="field"><span className="field__label">Recompra (pesos)</span><input className="field__input" type="number" min={1} max={1000000} step={1} value={rebuyFee} disabled={!allowRebuy} onChange={(event) => setRebuyFee(Number(event.target.value))} /></label>
            </div>
            <p className="field__hint">Hacen falta 3 jugadores para empezar. Cuando queden dos, el pozo se reparte entre ellos según las fichas que tenga cada uno.</p>

            <div className="field">
              <span className="field__label">Lugares en la mesa: {maxSeats}</span>
              <input
                type="range"
                min={3}
                max={9}
                value={maxSeats}
                onChange={(event) => setMaxSeats(Number(event.target.value))}
              />
              {maxSeats > 8 ? (
                <span className="field__hint">Con tantos jugadores la voz puede entrecortarse.</span>
              ) : null}
            </div>

            <div className="field">
              <span className="field__label">Segundos por turno: {turnTimeSec}</span>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={turnTimeSec}
                onChange={(event) => setTurnTimeSec(Number(event.target.value))}
              />
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={allowRebuy}
                onChange={(event) => setAllowRebuy(event.target.checked)}
              />
              <span>Dejar recomprar una vez a quien se quede sin fichas</span>
            </label>

            <div className="lobby__actions">
              <button
                type="button"
                className="btn btn--primary btn--wide"
                disabled={busy || !Number.isInteger(entryFee) || entryFee < 1 || entryFee > 1000000 || (allowRebuy && (!Number.isInteger(rebuyFee) || rebuyFee < 1 || rebuyFee > 1000000))}
                onClick={handleCreate}
              >
                {busy ? 'Creando...' : 'Crear mesa'}
              </button>
              <button type="button" className="btn btn--ghost btn--wide" onClick={() => setMode('menu')}>
                Volver
              </button>
            </div>
          </div>
        ) : null}

        <footer className="lobby__footer">
          Entraste como <strong>@{user.username}</strong>.{' '}
          <button type="button" className="linkish linkish--inline" onClick={onLogout}>
            Cerrar sesión
          </button>
        </footer>
      </div>
    </div>
  );
}
