import { randomUUID } from 'node:crypto';
import { settleTournament, type TournamentParticipant, type TournamentView, type TableSettings } from '@puker/shared';

export interface TournamentEntrant {
  playerId: string;
  userId: number | null;
  name: string;
  chips: number;
}

export interface TournamentRecord extends TournamentView {
  roomCode: string;
  startedAt: number;
  userIds: number[];
  entryFee: number;
  rebuyFee: number;
}

export class Tournament {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly entries = new Map<string, TournamentParticipant>();
  private readonly userIds: number[];
  status: TournamentView['status'] = 'playing';
  result: TournamentView['result'] = null;

  constructor(readonly roomCode: string, readonly settings: TableSettings, entrants: TournamentEntrant[]) {
    this.userIds = entrants.flatMap((p) => p.userId === null ? [] : [p.userId]);
    for (const p of entrants) this.entries.set(p.playerId, {
      id: p.playerId, name: p.name, chips: p.chips, investedCents: settings.entryFee * 100,
      rebuyUsed: false, status: 'active',
    });
  }

  canParticipate(id: string): boolean {
    const player = this.entries.get(id);
    return !this.result && !!player && (player.status === 'active' || player.status === 'rebuy');
  }

  rebuy(id: string, chips: number): void {
    const player = this.entries.get(id);
    if (!player || player.status !== 'rebuy' || player.rebuyUsed || this.result) throw new Error('No tenés una recompra disponible');
    player.rebuyUsed = true;
    player.investedCents += this.settings.rebuyFee * 100;
    player.chips = chips;
    player.status = 'active';
  }

  withdraw(id: string): void {
    const player = this.entries.get(id);
    if (!player || this.result) return;
    player.status = 'withdrawn';
  }

  /** Solo se llama entre manos: primero se resuelven todas las recompras. */
  reconcile(players: TournamentEntrant[]): void {
    if (this.result) return;
    for (const seat of players) {
      const player = this.entries.get(seat.playerId);
      if (player) { player.chips = seat.chips; player.name = seat.name; }
    }
    for (const player of this.entries.values()) {
      if (player.status === 'withdrawn' || player.status === 'eliminated') continue;
      player.status = player.chips > 0 ? 'active' : this.settings.allowRebuy && !player.rebuyUsed ? 'rebuy' : 'eliminated';
    }
    const playersInMatch = [...this.entries.values()];
    if (playersInMatch.some((p) => p.status === 'rebuy')) {
      this.status = 'awaiting-rebuy';
      return;
    }
    if (playersInMatch.filter((p) => p.status === 'active' && p.chips > 0).length <= 2) {
      this.result = settleTournament(this.id, this.roomCode, playersInMatch, Date.now());
      this.status = 'finished';
      for (const p of this.result.players) this.entries.set(p.id, { ...p });
    } else this.status = 'playing';
  }

  view(players: TournamentEntrant[]): TournamentView {
    const participants = [...this.entries.values()].map((p) => {
      const seat = players.find((s) => s.playerId === p.id);
      return { ...p, chips: this.result ? p.chips : seat?.chips ?? p.chips };
    });
    return {
      id: this.id, status: this.status, participants, result: this.result,
      potCents: participants.reduce((sum, p) => sum + p.investedCents, 0),
    };
  }

  record(players: TournamentEntrant[]): TournamentRecord {
    return { ...this.view(players), roomCode: this.roomCode, startedAt: this.startedAt, userIds: this.userIds, entryFee: this.settings.entryFee, rebuyFee: this.settings.rebuyFee };
  }
}
