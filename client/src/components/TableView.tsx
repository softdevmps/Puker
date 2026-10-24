import { useMemo } from 'react';

import { formatChips, formatStack, type GameState } from '@puker/shared';

import { betPosition, displayIndexOf, seatPosition } from '../lib/layout';
import { useCountdown } from '../lib/useCountdown';
import { CardSlot, PlayingCard } from './PlayingCard';
import { EmptySeat, Seat } from './Seat';

interface Props {
  state: GameState;
  turnDeadline: number | null;
  onSit(seat: number): void;
}

export function TableView({ state, turnDeadline, onSit }: Props) {
  const total = state.settings.maxSeats;
  const countdown = useCountdown(turnDeadline, state.settings.turnTimeSec * 1000);
  const showingResult = state.phase === 'handover' && state.lastResult !== null;

  /** Cartas de la mejor mano de cada jugador, para resaltarlas en el showdown. */
  const bestBySeat = useMemo(() => {
    const map = new Map<number, string[]>();
    if (!showingResult || !state.lastResult) return map;
    for (const entry of state.lastResult.shown) {
      if (entry.best.length) map.set(entry.seat, entry.best);
    }
    return map;
  }, [showingResult, state.lastResult]);

  /** Cartas del board que usó el ganador principal. */
  const winningBoard = useMemo(() => {
    if (!showingResult || !state.lastResult) return new Set<string>();
    const top = [...state.lastResult.payouts].sort((a, b) => b.amount - a.amount)[0];
    if (!top) return new Set<string>();
    const entry = state.lastResult.shown.find((s) => s.seat === top.seat);
    return new Set(entry?.best ?? []);
  }, [showingResult, state.lastResult]);

  const bySeat = new Map(state.players.map((player) => [player.seat, player]));
  const isSpectator = state.youSeat === null;
  const seatsFree = state.players.length < total;

  return (
    <div className="table">
      <div className="felt">
        <div className="felt__inner" />
      </div>

      <div className="center">
        <div className="center__pot">
          <span className="center__pot-label">Bote</span>
          <strong>{state.totalPot.toLocaleString('es-AR')}</strong>
        </div>

        <div className="board">
          {Array.from({ length: 5 }, (_, index) => {
            const card = state.board[index];
            return card ? (
              <PlayingCard
                key={`board-${index}-${card}`}
                card={card}
                size="lg"
                highlight={winningBoard.has(card)}
              />
            ) : (
              <CardSlot key={`slot-${index}`} size="lg" />
            );
          })}
        </div>

        {state.pots.length > 1 ? (
          <div className="center__sidepots">
            {state.pots.map((pot, index) => (
              <span key={`${pot.label}-${index}`} className="center__sidepot">
                {pot.label}: {formatChips(pot.amount)}
              </span>
            ))}
          </div>
        ) : null}

        {showingResult && state.lastResult ? (
          <div className="center__result">{state.lastResult.summary}</div>
        ) : null}

        {state.phase === 'waiting' && state.pausedReason ? (
          <div className="center__waiting">{state.pausedReason}</div>
        ) : null}
      </div>

      {Array.from({ length: total }, (_, seat) => {
        const displayIndex = displayIndexOf(seat, state.youSeat, total);
        const position = seatPosition(displayIndex, total);
        const player = bySeat.get(seat);

        return (
          <div className="seat-slot" key={`seat-${seat}`} style={position}>
            {player ? (
              <Seat
                player={player}
                isHero={player.seat === state.youSeat}
                isHost={player.id === state.hostId}
                timeFraction={player.isTurn ? countdown.fraction : 0}
                timeSeconds={player.isTurn ? countdown.seconds : 0}
                bestCards={bestBySeat.get(seat) ?? []}
              />
            ) : (
              <EmptySeat seat={seat} canSit={isSpectator && seatsFree} onSit={onSit} />
            )}
          </div>
        );
      })}

      {state.players
        .filter((player) => player.bet > 0)
        .map((player) => {
          const displayIndex = displayIndexOf(player.seat, state.youSeat, total);
          return (
            <div className="bet-chip" key={`bet-${player.seat}`} style={betPosition(displayIndex, total)}>
              <span className="bet-chip__dot" />
              {formatStack(player.bet)}
            </div>
          );
        })}
    </div>
  );
}
