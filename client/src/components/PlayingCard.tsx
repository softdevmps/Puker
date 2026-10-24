import { SUIT_COLOR, SUIT_SYMBOL, type Card, type Suit } from '@puker/shared';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  /** `null` dibuja el dorso. */
  card: Card | null;
  size?: CardSize;
  /** Atenuada: no participa de la mejor mano. */
  dim?: boolean;
  /** Resaltada: forma parte de la mano ganadora. */
  highlight?: boolean;
}

export function PlayingCard({ card, size = 'md', dim = false, highlight = false }: Props) {
  const classes = ['card', `card--${size}`];
  if (dim) classes.push('card--dim');
  if (highlight) classes.push('card--highlight');

  if (!card) {
    return <div className={[...classes, 'card--back'].join(' ')} aria-label="Carta tapada" />;
  }

  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1] as Suit;
  const symbol = SUIT_SYMBOL[suit] ?? '?';

  return (
    <div
      className={[...classes, `card--${SUIT_COLOR[suit] ?? 'black'}`].join(' ')}
      aria-label={`${rank} de ${suitName(suit)}`}
    >
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{symbol}</span>
    </div>
  );
}

function suitName(suit: Suit): string {
  switch (suit) {
    case 'c':
      return 'tréboles';
    case 'd':
      return 'diamantes';
    case 'h':
      return 'corazones';
    default:
      return 'picas';
  }
}

/** Hueco del mismo tamaño que una carta, para que el board no salte. */
export function CardSlot({ size = 'md' }: { size?: CardSize }) {
  return <div className={`card card--${size} card--slot`} aria-hidden="true" />;
}
