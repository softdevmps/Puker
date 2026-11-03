import { useState } from 'react';

import { CHIP_DENOMINATIONS, chipBreakdown, formatStack, type GameState, type PlayerAction } from '@puker/shared';

interface Props {
  state: GameState;
  onAct(action: PlayerAction): Promise<void>;
}

export function ActionBar({ state, onAct }: Props) {
  if (!state.legal) return <WaitingBar state={state} />;
  const turnKey = `${state.roomCode}:${state.handNumber}:${state.phase}:${state.turnSeat}:${state.turnEndsAt}`;
  return <ChipBetting key={turnKey} state={state} onAct={onAct} />;
}

function ChipBetting({ state, onAct }: Props) {
  const [selection, setSelection] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const legal = state.legal!;
  const you = state.players.find((player) => player.seat === state.youSeat)!;
  const selected = selection.reduce((sum, value) => sum + value, 0);
  const target = you.bet + selected;
  const canRaise = legal.canBet || legal.canRaise;
  const limit = canRaise ? you.chips : legal.callAmount;
  const isCall = legal.canCall && selected === legal.callAmount;
  const validRaise = canRaise && target >= legal.minRaiseTo && target <= legal.maxRaiseTo;
  const canConfirm = selected > 0 && (isCall || validRaise);
  const allIn = selected === you.chips;
  const selectAmount = (amount: number) => setSelection(
    chipBreakdown(amount).flatMap((chip) => Array<number>(chip.count).fill(chip.value)),
  );

  const play = async (action: PlayerAction) => {
    if (pending) return;
    setPending(true);
    try {
      await onAct(action);
      setSelection([]);
    } catch {
      // useGame muestra el error; conservamos la selección para poder corregirla.
    } finally {
      setPending(false);
    }
  };

  const confirm = () => {
    if (!canConfirm) return;
    void play(isCall ? { type: 'call' } : allIn ? { type: 'allin' } : {
      type: legal.canBet ? 'bet' : 'raise', amount: target,
    });
  };

  let hint = canRaise
    ? `Mínimo para ${legal.canBet ? 'apostar' : 'subir'}: $${formatStack(legal.minRaiseTo)} en total`
    : 'En este turno solo podés igualar o retirarte';
  // Subir pide igualar el tamaño de la última apuesta. A quien no le alcanza se
  // le permite subir corto igual, así que conviene decirle desde cuánto puede:
  // si no, pone fichas, Confirmar no se enciende y parece que está roto.
  const shortRaise = canRaise && legal.fullRaiseTo > legal.maxRaiseTo;
  if (canRaise && legal.raiseIsAllIn) {
    hint = `Para subir solo te queda ir con todo: $${formatStack(legal.maxRaiseTo)}`;
  } else if (shortRaise) {
    hint = `No te alcanza para subir a $${formatStack(legal.fullRaiseTo)}, así que subís lo que quieras desde $${formatStack(legal.minRaiseTo)}`;
  }
  if (isCall) hint = `Vas a igualar con $${formatStack(selected)}${allIn ? ' (all-in)' : ''}`;
  else if (validRaise && selected > 0) hint = `Tu apuesta total será $${formatStack(target)}${allIn ? ' (all-in)' : ''}`;
  else if (selected > 0 && target < state.currentBet) hint = `Faltan $${formatStack(legal.callAmount - selected)} para igualar`;
  else if (selected > 0 && canRaise) hint = `Con eso no subís: hay que llegar a $${formatStack(legal.minRaiseTo)} en total`;

  return (
    <div className="actions actions--chips" aria-label="Tus acciones de juego">
      <div className="chip-betting">
        <div className="chip-betting__heading">
          <div><span className="chip-betting__eyebrow">Tu turno · elegí tus fichas</span><strong>Al centro: ${formatStack(selected)}</strong></div>
          <span className="chip-betting__balance">Disponibles<br /><strong>${formatStack(you.chips - selected)}</strong></span>
        </div>

        <div className="chip-betting__tray" aria-label="Fichas para armar la apuesta">
          {CHIP_DENOMINATIONS.map((chip) => {
            const count = selection.filter((value) => value === chip.value).length;
            return (
              <button
                key={chip.value}
                type="button"
                className={`chip-betting__pick${count ? ' chip-betting__pick--selected' : ''}`}
                disabled={pending || selected + chip.value > limit}
                aria-label={`Agregar ficha ${chip.label.toLowerCase()} de $${chip.value}`}
                onClick={() => setSelection((prev) => [...prev, chip.value])}
              >
                <span className={`poker-chip poker-chip--${chip.color}`} aria-hidden="true">{formatStack(chip.value)}</span>
                <span className="chip-betting__count">{count ? `×${count}` : `+${formatStack(chip.value)}`}</span>
              </button>
            );
          })}
        </div>

        <div className="chip-betting__tools">
          <button type="button" disabled={pending || !selection.length} onClick={() => setSelection((prev) => prev.slice(0, -1))}>Deshacer</button>
          <button type="button" disabled={pending || !selection.length} onClick={() => setSelection([])}>Limpiar</button>
          {canRaise ? <button type="button" disabled={pending} onClick={() => selectAmount(legal.minRaiseTo - you.bet)}>Mínimo</button> : null}
          {canRaise || legal.callAmount === you.chips ? <button type="button" disabled={pending} onClick={() => selectAmount(you.chips)}>Todo</button> : null}
        </div>
        <p className="chip-betting__hint" aria-live="polite">{hint}</p>

        <div className="actions__row">
          <button type="button" className="btn btn--fold" disabled={pending} onClick={() => void play({ type: 'fold' })}>Retirarse</button>
          <button type="button" className={`btn ${legal.canCheck ? 'btn--check' : 'btn--call'}`} disabled={pending} onClick={() => void play({ type: legal.canCheck ? 'check' : 'call' })}>
            {legal.canCheck ? 'Pasar' : <>Igualar<small>${formatStack(legal.callAmount)}</small></>}
          </button>
          <button type="button" className="btn btn--raise" disabled={pending || !canConfirm} onClick={confirm}>
            {pending ? 'Enviando…' : allIn && canConfirm ? 'Confirmar all-in' : 'Confirmar'}
            <small>${formatStack(selected)}</small>
          </button>
        </div>
      </div>
    </div>
  );
}

function WaitingBar({ state }: { state: GameState }) {
  const you = state.players.find((player) => player.seat === state.youSeat);

  let message = 'Esperando a los demás...';
  if (state.tournament?.status === 'finished') message = 'Partida terminada. El reparto está disponible arriba.';
  else if (state.tournament?.status === 'awaiting-rebuy') message = 'Partida en espera: falta decidir una recompra.';
  else if (state.youSeat === null) message = 'Estás mirando la partida';
  else if (!state.running) message = state.pausedReason ?? 'Partida en pausa';
  else if (you?.chips === 0 && you.rebuyUsed) message = 'Sin fichas. Ya usaste tu única recarga de esta partida.';
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
