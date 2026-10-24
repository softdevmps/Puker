/**
 * Representación de cartas.
 *
 * Una carta es un string de 2 caracteres: rango + palo. Ej: "As", "Td", "2c".
 * Es compacto para mandar por websocket y fácil de leer en los logs.
 */

export const RANKS = '23456789TJQKA';
export const SUITS = ['c', 'd', 'h', 's'] as const;

export type Suit = (typeof SUITS)[number];
export type Card = string;

/** Palos en español, para la UI. */
export const SUIT_SYMBOL: Record<Suit, string> = {
  c: '♣', // trébol
  d: '♦', // diamante
  h: '♥', // corazón
  s: '♠', // pica
};

export const SUIT_COLOR: Record<Suit, 'red' | 'black'> = {
  c: 'black',
  d: 'red',
  h: 'red',
  s: 'black',
};

/** Valor numérico del rango: 2..14 (el As vale 14). */
export function rankOf(card: Card): number {
  const i = RANKS.indexOf(card[0]!);
  if (i < 0) throw new Error(`Carta inválida: ${card}`);
  return i + 2;
}

export function suitOf(card: Card): Suit {
  const s = card[1] as Suit;
  if (!SUITS.includes(s)) throw new Error(`Carta inválida: ${card}`);
  return s;
}

/** "As" -> "A♠" */
export function cardLabel(card: Card): string {
  return `${card[0]}${SUIT_SYMBOL[suitOf(card)]}`;
}

/** Nombre del rango para textos: "A", "K", "10", "7"... */
export function rankName(rank: number): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  if (rank === 10) return '10';
  return String(rank);
}

/** Plural del rango para textos: "Ases", "Reyes", "Sietes"... */
export function rankPlural(rank: number): string {
  switch (rank) {
    case 14:
      return 'Ases';
    case 13:
      return 'Reyes';
    case 12:
      return 'Reinas';
    case 11:
      return 'Jotas';
    case 10:
      return 'Dieces';
    case 9:
      return 'Nueves';
    case 8:
      return 'Ochos';
    case 7:
      return 'Sietes';
    case 6:
      return 'Seises';
    case 5:
      return 'Cincos';
    case 4:
      return 'Cuatros';
    case 3:
      return 'Treses';
    default:
      return 'Doses';
  }
}

/** Mazo de 52 cartas ordenado. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

export type RandomSource = () => number;

/**
 * Fisher-Yates. `rng` debe devolver un float en [0, 1).
 * El servidor le pasa una fuente criptográfica; el default es solo para tests.
 */
export function shuffle<T>(items: readonly T[], rng: RandomSource = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
