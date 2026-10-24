import { useEffect, useRef, useState } from 'react';

import { formatChips, type GameState, type PlayerAction } from '@puker/shared';

interface Props {
  state: GameState;
  onAct(action: PlayerAction): void;
}

export function ActionBar({ state, onAct }: Props) {
  const legal = state.legal;
  const isMyTurn = legal !== null;
  const [raiseTo, setRaiseTo] = useState<number | null>(null);
  const lastTurnKey = useRef('');

  // Cada vez que te vuelve a tocar, el panel de subida arranca cerrado.
  const turnKey = `${state.handNumber}:${state.phase}:${state.currentBet}:${isMyTurn}`;
  useEffect(() => {
    if (lastTurnKey.current !== turnKey) {
      lastTurnKey.current = turnKey;
      setRaiseTo(null);
    }
  }, [turnKey]);

  if (!isMyTurn || !legal) {
    return <WaitingBar state={state} />;
  }

  const canAggress = legal.canBet || legal.canRaise;
  const amount = clamp(raiseTo ?? legal.minRaiseTo, legal.minRaiseTo, legal.maxRaiseTo);
  const step = pickStep(state.settings.bigBlind, legal.minRaiseTo, legal.maxRaiseTo);

  // Atajos basados en el bote. Se descartan los que no cambian nada.
  const shortcuts = buildShortcuts(state, legal.minRaiseTo, legal.maxRaiseTo);

  const confirmRaise = () => {
    if (amount >= legal.maxRaiseTo) onAct({ type: 'allin' });
    else onAct({ type: legal.canBet ? 'bet' : 'raise', amount });
    setRaiseTo(null);
  };

  return (
    <div className="actions">
      {raiseTo !== null && canAggress ? (
        <div className="raise">
          <div className="raise__top">
            <button type="button" className="raise__close" onClick={() => setRaiseTo(null)}>
              Volver
            </button>
            <div className="raise__amount">
              <span className="raise__amount-label">{legal.canBet ? 'Apostar' : 'Subir a'}</span>
              <strong>{amount.toLocaleString('es-AR')}</strong>
            </div>
          </div>

          <div className="raise__shortcuts">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                className={`chip-btn${amount === shortcut.value ? ' chip-btn--on' : ''}`}
                onClick={() => setRaiseTo(shortcut.value)}
              >
                {shortcut.label}
              </button>
            ))}
          </div>

          <div className="raise__slider">
            <button
              type="button"
              className="raise__nudge"
              aria-label="Bajar"
              onClick={() => setRaiseTo(clamp(amount - step, legal.minRaiseTo, legal.maxRaiseTo))}
            >
              −
            </button>
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={step}
              value={amount}
              onChange={(event) => setRaiseTo(Number(event.target.value))}
              aria-label="Monto a apostar"
            />
            <button
              type="button"
              className="raise__nudge"
              aria-label="Subir"
              onClick={() => setRaiseTo(clamp(amount + step, legal.minRaiseTo, legal.maxRaiseTo))}
            >
              +
            </button>
          </div>

          <button type="button" className="btn btn--raise btn--wide" onClick={confirmRaise}>
            {amount >= legal.maxRaiseTo
              ? `All-in ${formatChips(amount)}`
              : `${legal.canBet ? 'Apostar' : 'Subir a'} ${formatChips(amount)}`}
          </button>
        </div>
      ) : (
        <div className="actions__row">
          <button type="button" className="btn btn--fold" onClick={() => onAct({ type: 'fold' })}>
            Retirarse
          </button>

          {legal.canCheck ? (
            <button type="button" className="btn btn--check" onClick={() => onAct({ type: 'check' })}>
              Pasar
            </button>
          ) : (
            <button type="button" className="btn btn--call" onClick={() => onAct({ type: 'call' })}>
              <span>Igualar</span>
              <small>{formatChips(legal.callAmount)}</small>
            </button>
          )}

          {canAggress ? (
            <button
              type="button"
              className="btn btn--raise"
              onClick={() => setRaiseTo(legal.minRaiseTo)}
            >
              <span>{legal.canBet ? 'Apostar' : 'Subir'}</span>
              {legal.raiseIsAllIn ? <small>all-in</small> : <small>desde {formatChips(legal.minRaiseTo)}</small>}
            </button>
          ) : (
            <button type="button" className="btn btn--raise" onClick={() => onAct({ type: 'allin' })}>
              All-in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WaitingBar({ state }: { state: GameState }) {
  const you = state.players.find((player) => player.seat === state.youSeat);

  let message = 'Esperando a los demás...';
  if (state.youSeat === null) message = 'Estás mirando la partida';
  else if (!state.running) message = state.pausedReason ?? 'Partida en pausa';
  else if (you?.status === 'sitting-out') message = you.chips <= 0 ? 'Te quedaste sin fichas' : 'Estás de descanso';
  else if (you?.status === 'folded') message = 'Te retiraste de esta mano';
  else if (you?.status === 'waiting') message = 'Entrás en la próxima mano';
  else if (state.turnSeat !== null) {
    const turnPlayer = state.players.find((player) => player.seat === state.turnSeat);
    message = turnPlayer ? `Juega ${turnPlayer.name}...` : 'Esperando...';
  }

  return (
    <div className="actions actions--waiting">
      <span>{message}</span>
    </div>
  );
}

interface Shortcut {
  label: string;
  value: number;
}

function buildShortcuts(state: GameState, min: number, max: number): Shortcut[] {
  const pot = Math.max(state.totalPot, state.settings.bigBlind);
  const base = state.currentBet;

  const candidates: Shortcut[] = [
    { label: '½ bote', value: base + Math.round(pot / 2) },
    { label: '¾ bote', value: base + Math.round(pot * 0.75) },
    { label: 'Bote', value: base + pot },
  ];
  if (base > 0) candidates.push({ label: 'x2', value: base * 2 });
  candidates.push({ label: 'Todo', value: max });

  const seen = new Set<number>();
  const out: Shortcut[] = [];
  for (const candidate of candidates) {
    const value = clamp(candidate.value, min, max);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ label: candidate.label, value });
  }
  return out;
}

/** Paso del slider: múltiplos de la ciega grande, salvo que el rango sea chico. */
function pickStep(bigBlind: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return 1;
  if (range < bigBlind * 4) return Math.max(1, Math.round(range / 20));
  return bigBlind;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
