/**
 * Armado de botes y botes laterales (side pots).
 *
 * Cuando alguien va all-in por menos de lo que apuestan los demás, el bote se
 * parte: el all-in solo puede ganar la parte que cubrió. Esto se calcula por
 * "niveles" de fichas comprometidas.
 */

export interface PotContributor {
  seat: number;
  /** Fichas que puso en toda la mano. */
  committed: number;
  /** Si se retiró, su dinero queda en el bote pero no puede ganarlo. */
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Asientos con derecho a ganarlo. */
  eligible: number[];
}

/**
 * Devuelve el bote principal y los laterales, en orden (el principal primero).
 *
 * Pensado para llamarse al cierre de la mano, después de devolver la apuesta
 * no igualada (ver `uncalledBet`).
 */
export function buildPots(players: readonly PotContributor[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.committed > 0).map((p) => p.committed))].sort(
    (a, b) => a - b,
  );

  const pots: Pot[] = [];
  let previous = 0;
  /**
   * Fichas de un nivel que nadie puede ganar (lo puso solo gente retirada).
   * No se pueden descartar: se suman al bote más cercano con jugadores vivos.
   */
  let orphaned = 0;

  for (const level of levels) {
    const slice = level - previous;
    previous = level;

    const contributors = players.filter((p) => p.committed >= level);
    const amount = slice * contributors.length;
    if (amount <= 0) continue;

    const eligible = contributors.filter((p) => !p.folded).map((p) => p.seat).sort((a, b) => a - b);
    if (eligible.length === 0) {
      orphaned += amount;
      continue;
    }

    const last = pots[pots.length - 1];
    // Si el nivel no cambió quién puede ganar, es el mismo bote.
    if (last && sameSeats(last.eligible, eligible)) {
      last.amount += amount + orphaned;
    } else {
      pots.push({ amount: amount + orphaned, eligible });
    }
    orphaned = 0;
  }

  // Sobrante del final: el caso típico es un retirado que apostó más que todos.
  if (orphaned > 0 && pots.length > 0) {
    pots[pots.length - 1]!.amount += orphaned;
  }

  return pots;
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((seat, i) => seat === b[i]);
}

/**
 * Parte de la apuesta que nadie igualó y hay que devolver.
 *
 * Caso típico: subís a 500, todos se van, y solo 200 estaban igualados. Los
 * 300 de diferencia vuelven a tu stack antes de armar el bote.
 */
export function uncalledBet(
  players: readonly PotContributor[],
): { seat: number; amount: number } | null {
  const committed = players.map((p) => p.committed).sort((a, b) => b - a);
  if (committed.length < 2) {
    const only = players[0];
    return only && only.committed > 0 ? { seat: only.seat, amount: only.committed } : null;
  }

  const top = committed[0]!;
  const second = committed[1]!;
  if (top <= second) return null;

  const leader = players.find((p) => p.committed === top);
  if (!leader) return null;
  return { seat: leader.seat, amount: top - second };
}
