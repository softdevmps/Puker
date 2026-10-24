import { useState } from 'react';

import { DEFAULT_SETTINGS, type TableSettings } from '@puker/shared';

interface Props {
  savedName: string;
  savedRoom: string;
  busy: boolean;
  onCreate(name: string, settings: Partial<TableSettings>): Promise<void>;
  onJoin(code: string, name: string): Promise<void>;
  onError(message: string): void;
}

const STACK_PRESETS = [
  { label: 'Corto', stack: 1000, sb: 10, bb: 20 },
  { label: 'Normal', stack: 2000, sb: 10, bb: 20 },
  { label: 'Largo', stack: 5000, sb: 25, bb: 50 },
];

export function Lobby({ savedName, savedRoom, busy, onCreate, onJoin, onError }: Props) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(savedRoom);
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const [preset, setPreset] = useState(1);
  const [maxSeats, setMaxSeats] = useState(DEFAULT_SETTINGS.maxSeats);
  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_SETTINGS.turnTimeSec);
  const [allowRebuy, setAllowRebuy] = useState(true);

  const trimmedName = name.trim();
  const nameOk = trimmedName.length >= 2;

  const handleCreate = async () => {
    if (!nameOk) return onError('Poné tu nombre (mínimo 2 letras)');
    const chosen = STACK_PRESETS[preset] ?? STACK_PRESETS[1]!;
    try {
      await onCreate(trimmedName, {
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
    if (!nameOk) return onError('Poné tu nombre (mínimo 2 letras)');
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length < 4) return onError('El código tiene 4 caracteres');
    try {
      await onJoin(trimmedCode, trimmedName);
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
          <p className="lobby__subtitle">Texas Hold'em para jugar con amigos. Fichas de juguete, orgullo real.</p>
        </header>

        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input
            className="field__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Cómo te ven en la mesa"
            maxLength={16}
            autoComplete="nickname"
          />
        </label>

        {mode === 'menu' ? (
          <div className="lobby__actions">
            <button type="button" className="btn btn--primary btn--wide" onClick={() => setMode('create')}>
              Crear una mesa
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={() => setMode('join')}>
              Entrar con código
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
                inputMode="text"
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
          Creá una mesa, pasale el código a tus amigos y listo. No hay plata real ni cuentas: solo fichas.
        </footer>
      </div>
    </div>
  );
}
