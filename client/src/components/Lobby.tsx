import { useState } from 'react';

import { DEFAULT_SETTINGS, type AuthUser, type BlindMode, type TableSettings } from '@puker/shared';
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
  const [blindMode, setBlindMode] = useState<BlindMode>(DEFAULT_SETTINGS.blindMode);
  // Dos números aparte: cambiar de modo no te pisa lo que elegiste en el otro.
  const [blindOrbits, setBlindOrbits] = useState(1);
  const [blindMinutes, setBlindMinutes] = useState(10);

  const handleCreate = async () => {
    try {
      await onCreate({
        ...DEFAULT_SETTINGS,
        maxSeats,
        turnTimeSec,
        allowRebuy,
        entryFee,
        rebuyFee,
        blindMode,
        blindEvery: blindMode === 'time' ? blindMinutes : blindOrbits,
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
              <span className="field__hint">Ciegas: $50 y $100.</span>
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
              <span className="field__label">Las ciegas suben</span>
              <div className="segmented">
                <button
                  type="button"
                  className={`segmented__option${blindMode === 'orbit' ? ' segmented__option--on' : ''}`}
                  onClick={() => setBlindMode('orbit')}
                >
                  Por vuelta
                  <small>cuando el reparto da la vuelta</small>
                </button>
                <button
                  type="button"
                  className={`segmented__option${blindMode === 'time' ? ' segmented__option--on' : ''}`}
                  onClick={() => setBlindMode('time')}
                >
                  Por tiempo
                  <small>con reloj, como en un torneo</small>
                </button>
              </div>
            </div>

            <div className="field">
              {blindMode === 'orbit' ? (
                <>
                  <span className="field__label">
                    Cada {blindOrbits === 1 ? 'vuelta' : `${blindOrbits} vueltas`} de la mesa
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={blindOrbits}
                    onChange={(event) => setBlindOrbits(Number(event.target.value))}
                  />
                  <span className="field__hint">
                    Una vuelta es un reparto por jugador. Cada vez que suben, se duplican.
                  </span>
                </>
              ) : (
                <>
                  <span className="field__label">Cada {blindMinutes} minutos</span>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    value={blindMinutes}
                    onChange={(event) => setBlindMinutes(Number(event.target.value))}
                  />
                  <span className="field__hint">
                    El reloj se frena si pausan la partida. Cada vez que suben, se duplican.
                  </span>
                </>
              )}
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
