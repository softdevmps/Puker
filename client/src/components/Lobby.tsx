import { useState } from 'react';

import { DEFAULT_SETTINGS, type AuthUser, type TableSettings } from '@puker/shared';

interface Props {
  user: AuthUser;
  savedRoom: string;
  busy: boolean;
  connected: boolean;
  onCreate(settings: Partial<TableSettings>): Promise<void>;
  onJoin(code: string): Promise<void>;
  onError(message: string): void;
  onShowRanking(): void;
  onLogout(): void;
}

const STACK_PRESETS = [
  { label: 'Corto', stack: 1000, sb: 10, bb: 20 },
  { label: 'Normal', stack: 2000, sb: 10, bb: 20 },
  { label: 'Largo', stack: 5000, sb: 25, bb: 50 },
];

export function Lobby({
  user,
  savedRoom,
  busy,
  connected,
  onCreate,
  onJoin,
  onError,
  onShowRanking,
  onLogout,
}: Props) {
  const [code, setCode] = useState(savedRoom);
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const [preset, setPreset] = useState(1);
  const [maxSeats, setMaxSeats] = useState(DEFAULT_SETTINGS.maxSeats);
  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_SETTINGS.turnTimeSec);
  const [allowRebuy, setAllowRebuy] = useState(true);

  const handleCreate = async () => {
    const chosen = STACK_PRESETS[preset] ?? STACK_PRESETS[1]!;
    try {
      await onCreate({
        smallBlind: chosen.sb,
        bigBlind: chosen.bb,
        startingStack: chosen.stack,
        maxSeats,
        turnTimeSec,
        allowRebuy,
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
              <span className="field__label">Fichas y ciegas</span>
              <div className="segmented">
                {STACK_PRESETS.map((option, index) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`segmented__option${preset === index ? ' segmented__option--on' : ''}`}
                    onClick={() => setPreset(index)}
                  >
                    <strong>{option.label}</strong>
                    <small>
                      {option.stack} · {option.sb}/{option.bb}
                    </small>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label">Lugares en la mesa: {maxSeats}</span>
              <input
                type="range"
                min={2}
                max={9}
                value={maxSeats}
                onChange={(event) => setMaxSeats(Number(event.target.value))}
              />
              {maxSeats > 8 ? (
                <span className="field__hint">
                  Con más de 8 el audio en malla empieza a exigir mucho a cada conexión.
                </span>
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
              <span>Permitir recargar fichas al quedarse sin nada</span>
            </label>

            <div className="lobby__actions">
              <button
                type="button"
                className="btn btn--primary btn--wide"
                disabled={busy}
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
