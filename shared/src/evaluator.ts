/**
 * Evaluador de manos de Texas Hold'em.
 *
 * Toma de 5 a 7 cartas y devuelve la mejor mano de 5, con un `score` entero
 * comparable: mayor score = mano mejor. Scores iguales = empate exacto (split).
 */

import { type Card, rankName, rankOf, rankPlural, suitOf } from './cards.js';

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export interface HandValue {
  /** Entero comparable. Codifica categoría + desempates. */
  score: number;
  category: HandCategory;
  /** Rangos de desempate, de más a menos significativo. */
  ranks: number[];
  /** Las 5 cartas que forman la mano. */
  cards: Card[];
  /** Texto para la UI: "Full de Reyes con Treses". */
  label: string;
}

/** Combina categoría + hasta 5 rangos en un entero monótono. */
function makeScore(category: HandCategory, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (ranks[i] ?? 0);
  }
  return score;
}

function describe(category: HandCategory, ranks: number[]): string {
  const r = (i: number) => rankName(ranks[i] ?? 0);
  const p = (i: number) => rankPlural(ranks[i] ?? 0);
  switch (category) {
    case HandCategory.StraightFlush:
      return ranks[0] === 14 ? 'Escalera real' : `Escalera de color al ${r(0)}`;
    case HandCategory.Quads:
      return `Póker de ${p(0)}`;
    case HandCategory.FullHouse:
      return `Full de ${p(0)} con ${p(1)}`;
    case HandCategory.Flush:
      return `Color al ${r(0)}`;
    case HandCategory.Straight:
      return ranks[0] === 5 ? 'Escalera al 5' : `Escalera al ${r(0)}`;
    case HandCategory.Trips:
      return `Trío de ${p(0)}`;
    case HandCategory.TwoPair:
      return `Doble pareja: ${p(0)} y ${p(1)}`;
    case HandCategory.Pair:
      return `Pareja de ${p(0)}`;
    default:
      return `Carta alta: ${r(0)}`;
  }
}

/**
 * Evalúa exactamente 5 cartas.
 */
export function evaluate5(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error(`evaluate5 espera 5 cartas, recibió ${cards.length}`);

  const ranksDesc = cards.map(rankOf).sort((a, b) => b - a);

  // Agrupar por rango: [rango, cantidad] ordenado por cantidad desc, luego rango desc.
  const countByRank = new Map<number, number>();
  for (const r of ranksDesc) countByRank.set(r, (countByRank.get(r) ?? 0) + 1);
  const groups = [...countByRank.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const firstSuit = suitOf(cards[0]!);
  const isFlush = cards.every((c) => suitOf(c) === firstSuit);

  // Escalera: necesita 5 rangos distintos consecutivos. A-2-3-4-5 es la "rueda" (el As vale 1).
  let straightHigh = 0;
  if (countByRank.size === 5) {
    const hi = ranksDesc[0]!;
    const lo = ranksDesc[4]!;
    if (hi - lo === 4) straightHigh = hi;
    else if (hi === 14 && ranksDesc[1] === 5) straightHigh = 5;
  }

  // Ordena las cartas igual que los grupos, para que `cards` se lea bien en la UI
  // (primero el trío, después los kickers, etc.).
  const byGroupOrder = (): Card[] => {
    const order = groups.map((g) => g[0]);
    return cards.slice().sort((a, b) => {
      const ia = order.indexOf(rankOf(a));
      const ib = order.indexOf(rankOf(b));
      return ia - ib || rankOf(b) - rankOf(a);
    });
  };

  const straightCards = (): Card[] => {
    // Para la rueda el As va al final (vale 1).
    if (straightHigh === 5) {
      const wheelOrder = [5, 4, 3, 2, 14];
      return cards.slice().sort((a, b) => wheelOrder.indexOf(rankOf(a)) - wheelOrder.indexOf(rankOf(b)));
    }
    return cards.slice().sort((a, b) => rankOf(b) - rankOf(a));
  };

  let category: HandCategory;
  let ranks: number[];
  let ordered: Card[];

  if (isFlush && straightHigh) {
    category = HandCategory.StraightFlush;
    ranks = [straightHigh];
    ordered = straightCards();
  } else if (groups[0]![1] === 4) {
    category = HandCategory.Quads;
    ranks = [groups[0]![0], groups[1]![0]];
    ordered = byGroupOrder();
  } else if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    category = HandCategory.FullHouse;
    ranks = [groups[0]![0], groups[1]![0]];
    ordered = byGroupOrder();
  } else if (isFlush) {
    category = HandCategory.Flush;
    ranks = ranksDesc;
    ordered = cards.slice().sort((a, b) => rankOf(b) - rankOf(a));
  } else if (straightHigh) {
    category = HandCategory.Straight;
    ranks = [straightHigh];
    ordered = straightCards();
  } else if (groups[0]![1] === 3) {
    category = HandCategory.Trips;
    ranks = [groups[0]![0], groups[1]![0], groups[2]![0]];
    ordered = byGroupOrder();
  } else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    category = HandCategory.TwoPair;
    ranks = [groups[0]![0], groups[1]![0], groups[2]![0]];
    ordered = byGroupOrder();
  } else if (groups[0]![1] === 2) {
    category = HandCategory.Pair;
    ranks = [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]];
    ordered = byGroupOrder();
  } else {
    category = HandCategory.HighCard;
    ranks = ranksDesc;
    ordered = cards.slice().sort((a, b) => rankOf(b) - rankOf(a));
  }

  return {
    score: makeScore(category, ranks),
    category,
    ranks,
    cards: ordered,
    label: describe(category, ranks),
  };
}

/** Las 21 combinaciones de 5 cartas sobre 7 (y las de 6 sobre 5). */
function combinations5(n: number): number[][] {
  const result: number[][] = [];
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) result.push([a, b, c, d, e]);
  return result;
}

const COMBO_CACHE = new Map<number, number[][]>();
function combosFor(n: number): number[][] {
  let combos = COMBO_CACHE.get(n);
  if (!combos) {
    combos = combinations5(n);
    COMBO_CACHE.set(n, combos);
  }
  return combos;
}

/**
 * Mejor mano de 5 entre 5, 6 o 7 cartas (típicamente 2 propias + 5 del board).
 */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error(`Se necesitan al menos 5 cartas, hay ${cards.length}`);
  if (cards.length === 5) return evaluate5(cards);

  let best: HandValue | null = null;
  for (const combo of combosFor(cards.length)) {
    const hand = evaluate5(combo.map((i) => cards[i]!));
    if (!best || hand.score > best.score) best = hand;
  }
  return best!;
}

/** > 0 si `a` gana, < 0 si gana `b`, 0 si empatan. */
export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}
