export interface TournamentParticipant {
  id: string;
  name: string;
  avatarUrl?: string | null;
  transferAlias?: string | null;
  chips: number;
  investedCents: number;
  rebuyUsed: boolean;
  status: 'active' | 'rebuy' | 'eliminated' | 'withdrawn' | 'finalist';
}

export interface TournamentPayout extends TournamentParticipant {
  share: number;
  payoutCents: number;
  netCents: number;
}

export interface TournamentResult {
  id: string;
  roomCode: string;
  finishedAt: number;
  kind: 'completed' | 'cancelled';
  potCents: number;
  players: TournamentPayout[];
}

export interface TournamentView {
  id: string;
  status: 'playing' | 'awaiting-rebuy' | 'finished';
  potCents: number;
  participants: TournamentParticipant[];
  result: TournamentResult | null;
}

/** Reparte el pozo completo. El aporte se descuenta solo para calcular el neto. */
export function settleTournament(
  id: string, roomCode: string, participants: readonly TournamentParticipant[], finishedAt: number,
): TournamentResult {
  const potCents = participants.reduce((sum, player) => sum + player.investedCents, 0);
  if (!Number.isSafeInteger(potCents) || potCents < 0 || participants.some((p) =>
    !Number.isSafeInteger(p.chips) || p.chips < 0 || !Number.isSafeInteger(p.investedCents) || p.investedCents < 0,
  )) throw new Error('Importes o fichas inválidos para el reparto');
  if (participants.some((p) => p.status === 'rebuy')) throw new Error('Falta decidir una recompra');
  const finalists = participants.filter((p) => p.status === 'active' && p.chips > 0);
  if (finalists.length > 2) throw new Error('Todavía quedan más de dos jugadores');
  const totalChips = finalists.reduce((sum, p) => sum + p.chips, 0);
  if (!Number.isSafeInteger(totalChips)) throw new Error('Cantidad de fichas inválida');
  const awards = new Map<string, number>();
  if (totalChips > 0) {
    const portions = finalists.map((p, index) => {
      const numerator = BigInt(potCents) * BigInt(p.chips);
      return { id: p.id, index, cents: Number(numerator / BigInt(totalChips)), remainder: numerator % BigInt(totalChips) };
    });
    let remaining = potCents - portions.reduce((sum, p) => sum + p.cents, 0);
    portions.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
    for (const portion of portions) {
      if (remaining > 0) { portion.cents++; remaining--; }
      awards.set(portion.id, portion.cents);
    }
  }
  return {
    id, roomCode, finishedAt, kind: totalChips > 0 ? 'completed' : 'cancelled', potCents,
    players: participants.map((player) => {
      const finalist = awards.has(player.id);
      const payoutCents = totalChips > 0 ? awards.get(player.id) ?? 0 : player.investedCents;
      return {
        ...player, status: finalist ? 'finalist' : player.status,
        share: finalist ? player.chips / totalChips : 0,
        payoutCents, netCents: payoutCents - player.investedCents,
      };
    }),
  };
}

export function formatPesos(cents: number): string {
  return (cents / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}
