import { useMemo } from 'react';

import { chipBreakdown, formatChips, formatStack, type GameState } from '@puker/shared';

import { betPosition, displayIndexOf, seatPosition } from '../lib/layout';
import { useCountdown } from '../lib/useCountdown';
import { CardSlot, PlayingCard } from './PlayingCard';
import { EmptySeat, Seat } from './Seat';

interface Props {
  state: GameState;
  turnDeadline: number | null;
  /** playerIds conectados al audio. */
  voiceParticipants: Set<string>;
  /** playerIds hablando ahora mismo. */
  voiceSpeaking: Set<string>;
  onSit(seat: number): void;
}

export function TableView({
  state,
  turnDeadline,
  voiceParticipants,
  voiceSpeaking,
  onSit,
}: Props) {
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
  const hideEmptySeats = state.phase !== 'waiting' || state.tournament !== null;
  const opponents = Array.from({ length: total }, (_, seat) => seat)
    .filter((seat) => seat !== state.youSeat)
    .sort((a, b) => displayIndexOf(b, state.youSeat, total) - displayIndexOf(a, state.youSeat, total));
  const mobileCount = hideEmptySeats ? opponents.filter((seat) => bySeat.has(seat)).length : opponents.length;

  const renderSeat = (seat: number) => {
    const player = bySeat.get(seat);
    const isHero = seat === state.youSeat;
    return <div
      className={`seat-slot${isHero ? ' seat-slot--hero' : ''}${!player ? ' seat-slot--empty' : ''}`}
      key={`seat-${seat}`}
      style={seatPosition(displayIndexOf(seat, state.youSeat, total), total)}
    >
      {player ? <Seat
        player={player}
        isHero={isHero}
        isHost={player.id === state.hostId}
        timeFraction={player.isTurn ? countdown.fraction : 0}
        timeSeconds={player.isTurn ? countdown.seconds : 0}
        bestCards={bestBySeat.get(seat) ?? []}
        inVoice={voiceParticipants.has(player.id)}
        speaking={voiceSpeaking.has(player.id)}
      /> : <EmptySeat seat={seat} canSit={isSpectator && seatsFree} onSit={onSit} />}
      {player && player.bet > 0 ? <div className="seat-slot__bet" aria-label={`Apuesta de ${player.name}`}>
        <span>Apostó</span> <BetAmount amount={player.bet} />
      </div> : null}
    </div>;
  };

  return (
    <div className={`table${hideEmptySeats ? ' table--playing' : ''}`}>
      <div className="table__arena">
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

      <div className={`table__opponents table__opponents--${mobileCount <= 4 ? 2 : 3}`}>
        {opponents.map(renderSeat)}
      </div>

      {state.players
        .filter((player) => player.bet > 0)
        .map((player) => {
          const displayIndex = displayIndexOf(player.seat, state.youSeat, total);
          return (
            <div className={`bet-chip${player.seat === state.youSeat ? ' bet-chip--hero' : ''}`} key={`bet-${player.seat}`} style={betPosition(displayIndex, total)}>
              <BetAmount amount={player.bet} />
            </div>
          );
        })}
      </div>
      {state.youSeat !== null ? renderSeat(state.youSeat) : null}
    </div>
  );
}

function BetAmount({ amount }: { amount: number }) {
  return <>
    <span className="bet-chip__tokens" aria-hidden="true">
      {chipBreakdown(amount).map((chip) => (
        <span key={chip.value} className={`poker-chip poker-chip--mini poker-chip--${chip.color}`} title={`${chip.count} × $${chip.value}`} />
      ))}
    </span>
    {formatStack(amount)}
  </>;
}
