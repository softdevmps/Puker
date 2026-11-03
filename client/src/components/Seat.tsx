import { formatChips, formatStack, type PublicPlayer } from '@puker/shared';

import { PlayingCard } from './PlayingCard';
import { Avatar } from './Avatar';

interface Props {
  player: PublicPlayer;
  isHero: boolean;
  isHost: boolean;
  /** Fracción de 0 a 1 del tiempo que le queda, si le toca actuar. */
  timeFraction: number;
  timeSeconds: number;
  /** Cartas que forman su mejor mano, para resaltarlas en el showdown. */
  bestCards: string[];
  /** Está conectado al audio de la mesa. */
  inVoice: boolean;
  /** Está hablando en este momento. */
  speaking: boolean;
}

export function Seat({
  player,
  isHero,
  isHost,
  timeFraction,
  timeSeconds,
  bestCards,
  inVoice,
  speaking,
}: Props) {
  const classes = ['seat'];
  if (isHero) classes.push('seat--hero');
  if (player.isTurn) classes.push('seat--turn');
  if (player.status === 'folded') classes.push('seat--folded');
  if (player.status === 'sitting-out') classes.push('seat--out');
  if (!player.connected) classes.push('seat--offline');
  if (player.wonLast > 0) classes.push('seat--winner');
  if (speaking) classes.push('seat--speaking');

  // Las cartas propias se muestran más grandes: son las que mirás todo el tiempo.
  const cardSize = isHero ? 'lg' : 'sm';
  const showBest = bestCards.length > 0;

  return (
    <div className={classes.join(' ')}>
      <div className="seat__cards">
        {player.cards.length === 0
          ? null
          : player.cards.map((card, index) => (
              <PlayingCard
                key={`${player.seat}-${index}-${card ?? 'x'}`}
                card={card}
                size={cardSize}
                highlight={showBest && card !== null && bestCards.includes(card)}
                dim={player.status === 'folded'}
              />
            ))}
      </div>

      <div className="seat__body">
        <div className="seat__head">
          <Avatar src={player.avatarUrl} name={player.name} />
          {inVoice ? (
            <span
              className={`seat__mic${speaking ? ' seat__mic--on' : ''}`}
              title={speaking ? 'Hablando' : 'Conectado al audio'}
              aria-label={speaking ? 'Hablando' : 'Conectado al audio'}
            >
              🎤
            </span>
          ) : null}
          <span className="seat__name" title={player.name}>
            {player.name}
            {isHost ? <span className="seat__host" title="Anfitrión">★</span> : null}
          </span>
          {player.isDealer ? <span className="seat__dealer" title="Reparte">D</span> : null}
        </div>

        <div className="seat__chips">${formatStack(player.chips)}</div>

        {player.handLabel ? <div className="seat__hand">{player.handLabel}</div> : null}

        <div className="seat__status">{statusText(player)}</div>

        {player.isTurn ? (
          <div className="seat__timer" role="timer" aria-label={`${timeSeconds} segundos`}>
            <div
              className={`seat__timer-bar${timeFraction < 0.3 ? ' seat__timer-bar--urgent' : ''}`}
              style={{ width: `${Math.round(timeFraction * 100)}%` }}
            />
            <span className="seat__timer-text">{timeSeconds}s</span>
          </div>
        ) : null}
      </div>

      {player.wonLast > 0 ? (
        <div className="seat__won">+{formatChips(player.wonLast)}</div>
      ) : null}
    </div>
  );
}

function statusText(player: PublicPlayer): string {
  if (!player.connected) return 'Desconectado';
  if (player.status === 'sitting-out') return player.chips <= 0 ? 'Sin fichas' : 'De descanso';
  if (player.status === 'folded') return 'Se retiró';
  if (player.status === 'allin') return 'ALL-IN';
  if (player.status === 'waiting') return 'Esperando mano';
  return player.lastAction ?? '';
}

interface EmptyProps {
  seat: number;
  canSit: boolean;
  onSit(seat: number): void;
}

export function EmptySeat({ seat, canSit, onSit }: EmptyProps) {
  if (!canSit) {
    return (
      <div className="seat seat--empty">
        <span className="seat__empty-label">Libre</span>
      </div>
    );
  }

  return (
    <button type="button" className="seat seat--empty seat--clickable" onClick={() => onSit(seat)}>
      <span className="seat__empty-label">Sentarse</span>
    </button>
  );
}
