/**
 * Máquina de estados de una mesa de Texas Hold'em.
 *
 * Todo el juego vive acá: reparto, ciegas, rondas de apuestas, all-in, botes
 * laterales y showdown. El cliente nunca decide nada, solo manda intenciones.
 *
 * La clase no usa temporizadores propios: expone `tick(now)` para que quien la
 * use (el servidor de sockets) maneje el reloj. Eso la vuelve testeable.
 */

import {
  type Card,
  DEFAULT_SETTINGS,
  type GameState,
  type HandResult,
  type LegalActions,
  type LogEntry,
  MAX_SEATS,
  type Payout,
  type Phase,
  type PlayerAction,
  type Pot,
  type PotView,
  type PublicPlayer,
  type ShowdownEntry,
  type TableSettings,
  buildPots,
  cardLabel,
  evaluateBest,
  formatChips,
  makeDeck,
  shuffle,
  uncalledBet,
} from '@puker/shared';

import { secureRandom } from './rng.js';
import { Tournament, type TournamentRecord } from './tournament.js';

/** Pausa entre el final de una mano y el reparto de la siguiente. */
const HANDOVER_MS = 6000;
/** Pausa extra por cada jugador que muestra cartas en el showdown. */
const SHOWDOWN_EXTRA_MS = 1200;
/** Tiempo que se le guarda el asiento a quien se desconecta. */
export const RECONNECT_GRACE_MS = 90_000;

export interface Seat {
  playerId: string;
  /** Cuenta persistente detrás del jugador. Null para invitados. */
  userId: number | null;
  name: string;
  chips: number;

  // --- estado de la mano en curso ---
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  holeCards: Card[];
  /** Fichas apostadas en la calle actual. */
  bet: number;
  /** Fichas apostadas en toda la mano. */
  committed: number;
  /** Ya actuó desde la última agresión de esta calle. */
  hasActed: boolean;

  // --- estado de sesión ---
  sittingOut: boolean;
  /**
   * Entró o volvió del descanso con la partida en marcha. Recibe cartas y paga
   * las ciegas que le toquen, pero no puede recibir el botón hasta pagar una
   * ciega grande: si no, bastaba con pararse y volver para entrar en la mejor
   * posición de la mesa sin haber pagado nada.
   */
  awaitingBigBlind: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  lastAction: string | null;
  wonLast: number;
  /** Faltas por tiempo consecutivas; a las 2 se lo pone de descanso. */
  missedTurns: number;
}

/** Cómo le fue a un jugador en una mano. Alimenta el ranking. */
export interface HandPlayerRecord {
  playerId: string;
  userId: number | null;
  name: string;
  /** Lo ganado menos lo apostado en esta mano. La suma de todos da cero. */
  netChips: number;
  committed: number;
  won: number;
  handLabel: string | null;
}

export interface HandRecord {
  roomCode: string;
  handNumber: number;
  potSize: number;
  playedAt: number;
  players: HandPlayerRecord[];
}

export class Table {
  readonly code: string;
  settings: TableSettings;
  seats: (Seat | null)[] = new Array(MAX_SEATS).fill(null);

  phase: Phase = 'waiting';
  running = false;
  handNumber = 0;
  board: Card[] = [];
  pots: Pot[] = [];
  lastResult: HandResult | null = null;
  hostId: string | null = null;

  private deck: Card[] = [];
  private button: number | null = null;
  private turn: number | null = null;
  private currentBet = 0;
  private lastRaiseSize = 0;
  /** Asientos cuyas cartas son públicas (showdown). */
  private revealed = new Set<number>();
  private turnEndsAt: number | null = null;
  private nextHandAt: number | null = null;
  private logEntries: LogEntry[] = [];
  private logSeq = 0;
  private pendingLog: LogEntry[] = [];
  /** La partida dura lo que la mesa; pausar o cambiar de asiento no reinicia estos datos. */
  private rebuyUsed = new Set<string>();
  private departedStacks = new Map<string, number>();
  private pendingDepartures = new Set<string>();
  private match: Tournament | null = null;
  onTournamentChange: ((record: TournamentRecord) => void) | null = null;

  /** Se dispara al cerrar cada mano, para persistir el resultado. */
  onHandComplete: ((record: HandRecord) => void) | null = null;

  constructor(code: string, settings: Partial<TableSettings> = {}) {
    this.code = code;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.normalizeSettings();
  }

  // ---------------------------------------------------------------- jugadores

  findSeat(playerId: string): number | null {
    const index = this.seats.findIndex((s) => s?.playerId === playerId);
    return index === -1 ? null : index;
  }

  seatOf(playerId: string): Seat | null {
    const index = this.findSeat(playerId);
    return index === null ? null : this.seats[index]!;
  }

  get occupiedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  /** Asientos con alguien conectado ahora mismo. */
  get connectedCount(): number {
    return this.seats.filter((seat) => seat?.connected).length;
  }

  /** Primer asiento libre dentro de los habilitados, o null si está llena. */
  firstFreeSeat(): number | null {
    for (let i = 0; i < this.settings.maxSeats; i++) {
      if (!this.seats[i]) return i;
    }
    return null;
  }

  sit(playerId: string, name: string, seatIndex?: number, userId: number | null = null): number {
    const existing = this.findSeat(playerId);
    if (existing !== null) {
      const seat = this.seats[existing]!;
      seat.name = name;
      if (userId !== null) seat.userId = userId;
      seat.connected = true;
      seat.disconnectedAt = null;
      if (!this.match) this.pendingDepartures.delete(playerId);
      return existing;
    }

    if (this.match && !this.match.canParticipate(playerId)) {
      throw new Error('La inscripción está cerrada; podés mirar como espectador');
    }

    const index = seatIndex ?? this.firstFreeSeat();
    if (index === null) throw new Error('La mesa está llena');
    if (index < 0 || index >= this.settings.maxSeats) throw new Error('Asiento inválido');
    if (this.seats[index]) throw new Error('Ese asiento está ocupado');

    this.seats[index] = {
      playerId,
      userId,
      name,
      chips: this.departedStacks.get(playerId) ?? this.settings.startingStack,
      inHand: false,
      folded: false,
      allIn: false,
      holeCards: [],
      bet: 0,
      committed: 0,
      hasActed: false,
      sittingOut: false,
      awaitingBigBlind: this.handNumber > 0,
      connected: true,
      disconnectedAt: null,
      lastAction: null,
      wonLast: 0,
      missedTurns: 0,
    };

    if (!this.hostId) this.hostId = playerId;
    this.addLog(`${name} se sentó en la mesa`, 'system');
    return index;
  }

  /**
   * Levanta a un jugador de la mesa. Si está en una mano, se le hace fold
   * automático para no bloquear a los demás.
   */
  leave(playerId: string): void {
    const index = this.findSeat(playerId);
    if (index === null) return;
    const seat = this.seats[index]!;
    this.match?.withdraw(playerId);
    if (seat.inHand && this.isHandLive()) {
      // Conserva aportes y cartas hasta cerrar la mano, incluso si ya hizo fold.
      this.pendingDepartures.add(playerId);
      seat.sittingOut = true;
      if (!seat.folded && !seat.allIn) this.applyFold(index, 'se fue de la mesa');
      if (this.turn === index) this.afterAction();
      else if (this.contenders().length <= 1) this.endHand();
      this.persistTournament();
      return;
    }
    this.syncTournament();
    this.removeSeat(index);
    this.ensureEnoughPlayers();
  }

  private removeSeat(index: number): void {
    const seat = this.seats[index];
    if (!seat) return;
    this.departedStacks.set(seat.playerId, seat.chips);
    this.pendingDepartures.delete(seat.playerId);
    this.seats[index] = null;
    this.addLog(`${seat.name} dejó la mesa`, 'system');
    if (this.hostId === seat.playerId) this.reassignHost();
  }

  withdraw(playerId: string): void {
    if (!this.match || !this.match.canParticipate(playerId)) throw new Error('No estás participando de esta partida');
    this.leave(playerId);
  }

  private tournamentSeats(): Seat[] {
    return this.seats.filter((seat): seat is Seat => seat !== null);
  }

  private persistTournament(): void {
    if (!this.match || !this.onTournamentChange) return;
    this.onTournamentChange(this.match.record(this.tournamentSeats()));
  }

  private syncTournament(): void {
    if (!this.match || this.isHandLive()) return;
    const wasFinished = this.match.status === 'finished';
    this.match.reconcile(this.tournamentSeats());
    if (this.match.status !== 'playing') this.nextHandAt = null;
    if (this.match.status === 'finished') {
      this.running = false;
      if (!wasFinished) this.addLog('Partida terminada. El pozo se reparte según las fichas de los finalistas.', 'result');
    }
    this.persistTournament();
  }

  updatePlayerName(playerId: string, name: string): void {
    const seat = this.seatOf(playerId);
    if (seat) seat.name = name;
  }

  setConnected(playerId: string, connected: boolean, now = Date.now()): void {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    seat.connected = connected;
    seat.disconnectedAt = connected ? null : now;
  }

  setSittingOut(playerId: string, sitOut: boolean): void {
    if (this.match) throw new Error('La partida ya comenzó. Para abandonarla, elegí retirarte de la partida.');
    const seat = this.seatOf(playerId);
    if (!seat) throw new Error('No estás sentado en la mesa');
    seat.sittingOut = sitOut;
    seat.missedTurns = 0;
    if (!sitOut && this.handNumber > 0) seat.awaitingBigBlind = true;
    this.addLog(`${seat.name} ${sitOut ? 'se puso de descanso' : 'volvió a jugar'}`, 'system');
    if (!sitOut) this.ensureEnoughPlayers();
  }

  rebuy(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (!seat) throw new Error('No estás sentado en la mesa');
    if (!this.settings.allowRebuy) throw new Error('La recarga está desactivada en esta mesa');
    if (this.rebuyUsed.has(playerId)) throw new Error('Ya usaste tu única recarga de esta partida');
    if (seat.chips > 0) throw new Error('Todavía te quedan fichas');
    if (seat.inHand && this.isHandLive()) throw new Error('Esperá a que termine la mano');
    if (this.settings.tournament && !this.match) throw new Error('La partida todavía no empezó');
    this.match?.rebuy(playerId, this.settings.startingStack);

    this.rebuyUsed.add(playerId);
    seat.chips = this.settings.startingStack;
    seat.sittingOut = false;
    this.addLog(`${seat.name} recargó ${formatChips(seat.chips)} fichas`, 'system');
    this.syncTournament();
    this.ensureEnoughPlayers();
  }

  moveSeat(playerId: string, target: number): void {
    const from = this.findSeat(playerId);
    if (from === null) throw new Error('No estás sentado en la mesa');
    if (target < 0 || target >= this.settings.maxSeats) throw new Error('Asiento inválido');
    if (this.seats[target]) throw new Error('Ese asiento está ocupado');
    const seat = this.seats[from]!;
    if (seat.inHand && this.isHandLive()) throw new Error('No podés cambiarte en medio de una mano');

    this.seats[target] = seat;
    this.seats[from] = null;
    if (this.button === from) this.button = target;
  }

  private reassignHost(): void {
    const next = this.seats.find(Boolean);
    this.hostId = next ? next.playerId : null;
  }

  updateSettings(patch: Partial<TableSettings>): void {
    if (this.match || (this.handNumber > 0 && patch.tournament !== undefined && patch.tournament !== this.settings.tournament)) {
      throw new Error('Las reglas y los importes quedan fijos al iniciar la partida');
    }
    if (this.isHandLive()) throw new Error('No se pueden cambiar las reglas con una mano en curso');

    const previous = this.settings;
    this.settings = { ...previous, ...patch };
    this.normalizeSettings();

    // Reducir la mesa nunca echa a nadie: sacar un asiento dejaba al anfitrión
    // fuera de la mesa con `hostId` apuntándolo, y entonces nadie podía
    // empezar, pausar ni volver a cambiar las reglas.
    if (this.occupiedCount > this.settings.maxSeats) {
      const wanted = this.settings.maxSeats;
      this.settings = previous;
      throw new Error(
        `Hay ${this.occupiedCount} jugadores sentados: primero tienen que levantarse para dejar la mesa en ${wanted} lugares`,
      );
    }

    // Los que quedaron en un asiento alto se corren a uno libre. El chequeo de
    // arriba garantiza que siempre haya lugar.
    for (let i = this.settings.maxSeats; i < MAX_SEATS; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      const free = this.firstFreeSeat();
      if (free === null) break;
      this.seats[free] = seat;
      this.seats[i] = null;
      if (this.button === i) this.button = free;
    }

    this.addLog(
      `Reglas actualizadas: ciegas ${formatChips(this.settings.smallBlind)}/${formatChips(
        this.settings.bigBlind,
      )}, stack ${formatChips(this.settings.startingStack)}, ${this.settings.turnTimeSec}s por turno`,
      'system',
    );
  }

  private normalizeSettings(): void {
    const s = this.settings;
    s.tournament = Boolean(s.tournament);
    s.entryFee = clampInt(s.entryFee, 1, 1_000_000, DEFAULT_SETTINGS.entryFee);
    s.rebuyFee = clampInt(s.rebuyFee, 1, 1_000_000, DEFAULT_SETTINGS.rebuyFee);
    s.chipUnit = s.chipUnit === 1 ? 1 : DEFAULT_SETTINGS.chipUnit;
    s.smallBlind = clampInt(s.smallBlind, 1, 100_000, DEFAULT_SETTINGS.smallBlind);
    s.bigBlind = clampInt(s.bigBlind, s.smallBlind + 1, 200_000, s.smallBlind * 2);
    s.startingStack = clampInt(s.startingStack, s.bigBlind * 2, 10_000_000, DEFAULT_SETTINGS.startingStack);
    s.smallBlind = Math.ceil(s.smallBlind / s.chipUnit) * s.chipUnit;
    s.bigBlind = Math.max(s.smallBlind + s.chipUnit, Math.ceil(s.bigBlind / s.chipUnit) * s.chipUnit);
    s.startingStack = Math.max(s.bigBlind * 2, Math.ceil(s.startingStack / s.chipUnit) * s.chipUnit);
    s.turnTimeSec = clampInt(s.turnTimeSec, 5, 300, DEFAULT_SETTINGS.turnTimeSec);
    s.maxSeats = clampInt(s.maxSeats, s.tournament ? 3 : 2, MAX_SEATS, DEFAULT_SETTINGS.maxSeats);
    s.allowRebuy = Boolean(s.allowRebuy);
  }

  // ------------------------------------------------------------------ partida

  /** Jugadores que pueden entrar a la próxima mano. */
  private eligibleSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat && seat.chips > 0 && (this.match ? this.match.canParticipate(seat.playerId) : !seat.sittingOut)) out.push(i);
    }
    return out;
  }

  isHandLive(): boolean {
    return this.phase !== 'waiting' && this.phase !== 'handover';
  }

  start(playerId: string): void {
    if (this.hostId && playerId !== this.hostId) throw new Error('Solo el anfitrión puede empezar');
    if (this.running) throw new Error('La partida ya está en marcha');
    if (this.match?.status === 'finished') throw new Error('La partida terminó; creá otra mesa para volver a jugar');
    if (this.match?.status === 'awaiting-rebuy') throw new Error('Falta decidir una recompra');
    if (this.isHandLive()) {
      this.running = true;
      this.addLog('Partida reanudada; continúa la mano actual.', 'system');
      return;
    }
    if (this.settings.tournament && !this.match) {
      const entrants = this.eligibleSeats().map((index) => this.seats[index]!);
      if (entrants.length < 3) throw new Error('Hacen falta al menos 3 jugadores para terminar con 2 finalistas');
      this.match = new Tournament(this.code, { ...this.settings }, entrants);
      this.persistTournament();
    }
    if (this.eligibleSeats().length < 2) throw new Error('Hacen falta al menos 2 jugadores con fichas');

    this.running = true;
    this.addLog('¡Arranca la partida!', 'system');
    this.beginHand();
  }

  pause(playerId: string): void {
    if (this.hostId && playerId !== this.hostId) throw new Error('Solo el anfitrión puede pausar');
    if (!this.running) return;
    this.running = false;
    this.nextHandAt = null;
    this.addLog('Partida pausada. Se detiene al terminar la mano en curso.', 'system');
  }

  private ensureEnoughPlayers(): void {
    if (this.match && this.match.status !== 'playing') return;
    if (this.running && !this.isHandLive() && this.nextHandAt === null && this.eligibleSeats().length >= 2) {
      this.nextHandAt = Date.now() + 1500;
    }
  }

  private beginHand(): void {
    if (this.match && this.match.status !== 'playing') return;
    const eligible = this.eligibleSeats();
    if (eligible.length < 2) {
      this.phase = 'waiting';
      this.turn = null;
      this.turnEndsAt = null;
      this.nextHandAt = null;
      return;
    }

    this.handNumber++;
    this.board = [];
    this.pots = [];
    this.revealed.clear();
    this.currentBet = 0;
    this.lastRaiseSize = this.settings.bigBlind;
    this.nextHandAt = null;
    this.deck = shuffle(makeDeck(), secureRandom);

    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      seat.inHand = eligible.includes(i);
      seat.folded = false;
      seat.allIn = false;
      seat.holeCards = [];
      seat.bet = 0;
      seat.committed = 0;
      seat.hasActed = false;
      seat.lastAction = null;
      seat.wonLast = 0;
    }

    // El botón solo rota entre quienes ya pagaron una ciega grande acá: quien
    // recién llegó se lo saltea hasta cumplir con la suya.
    const established = eligible.filter((index) => !this.seats[index]!.awaitingBigBlind);
    this.button = this.nextOccupiedFrom(
      this.button === null ? 0 : this.button + 1,
      established.length > 0 ? established : eligible,
    );
    this.phase = 'preflop';

    const heads = eligible.length === 2;
    const sbSeat = heads ? this.button! : this.nextInHandFrom(this.button! + 1)!;
    const bbSeat = this.nextInHandFrom(sbSeat + 1)!;

    this.addLog(
      `--- Mano #${this.handNumber} --- Reparte ${this.seats[this.button!]!.name}`,
      'deal',
    );

    // Dos vueltas de una carta, como en la mesa real.
    for (let round = 0; round < 2; round++) {
      let seatIndex = sbSeat;
      for (let n = 0; n < eligible.length; n++) {
        const seat = this.seats[seatIndex]!;
        seat.holeCards.push(this.draw());
        seatIndex = this.nextInHandFrom(seatIndex + 1)!;
      }
    }

    this.postBlind(sbSeat, this.settings.smallBlind, 'ciega chica');
    this.postBlind(bbSeat, this.settings.bigBlind, 'ciega grande');
    // Cumplida la ciega grande, ya puede recibir el botón.
    this.seats[bbSeat]!.awaitingBigBlind = false;

    this.currentBet = Math.max(
      this.seats[sbSeat]!.bet,
      this.seats[bbSeat]!.bet,
      this.settings.bigBlind,
    );
    // Las ciegas son forzadas: no cuentan como "ya actuó".
    this.seats[sbSeat]!.hasActed = false;
    this.seats[bbSeat]!.hasActed = false;

    // Mano a mano abre la ciega chica; con 3 o más, el que sigue a la grande.
    // En ambos casos se busca desde ahí al primero que PUEDA actuar: si quedó
    // all-in al poner la ciega, el turno tiene que saltearlo.
    const firstToAct = this.nextActiveFrom(heads ? sbSeat : bbSeat + 1);
    this.setTurn(firstToAct);

    // Caso raro: las ciegas dejaron a todos all-in y no hay nada que decidir.
    if (this.turn === null) this.finishBettingRound();
  }

  private postBlind(seatIndex: number, amount: number, label: string): void {
    const seat = this.seats[seatIndex]!;
    const paid = Math.min(amount, seat.chips);
    seat.chips -= paid;
    seat.bet += paid;
    seat.committed += paid;
    if (seat.chips === 0) {
      seat.allIn = true;
      seat.lastAction = 'All-in (ciega)';
    } else {
      // Texto corto: el panel del asiento es angosto en el celular.
      seat.lastAction = label === 'ciega chica' ? 'Ciega chica' : 'Ciega grande';
    }
    this.addLog(`${seat.name} pone la ${label}: ${formatChips(paid)}`, 'deal');
  }

  private draw(): Card {
    const card = this.deck.pop();
    if (!card) throw new Error('El mazo se quedó sin cartas');
    return card;
  }

  // -------------------------------------------------------------- navegación

  private nextOccupiedFrom(from: number, allowed: number[]): number | null {
    for (let step = 0; step < MAX_SEATS; step++) {
      const index = mod(from + step, MAX_SEATS);
      if (allowed.includes(index)) return index;
    }
    return null;
  }

  /** Siguiente asiento que está en la mano (incluye los que ya están all-in). */
  private nextInHandFrom(from: number): number | null {
    for (let step = 0; step < MAX_SEATS; step++) {
      const index = mod(from + step, MAX_SEATS);
      const seat = this.seats[index];
      if (seat?.inHand && !seat.folded) return index;
    }
    return null;
  }

  /** Siguiente asiento que todavía puede apostar. */
  private nextActiveFrom(from: number): number | null {
    for (let step = 0; step < MAX_SEATS; step++) {
      const index = mod(from + step, MAX_SEATS);
      const seat = this.seats[index];
      if (seat?.inHand && !seat.folded && !seat.allIn && seat.chips > 0) return index;
    }
    return null;
  }

  private activeSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat?.inHand && !seat.folded && !seat.allIn && seat.chips > 0) out.push(i);
    }
    return out;
  }

  private contenders(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat?.inHand && !seat.folded) out.push(i);
    }
    return out;
  }

  private setTurn(seatIndex: number | null): void {
    this.turn = seatIndex;
    this.turnEndsAt = seatIndex === null ? null : Date.now() + this.settings.turnTimeSec * 1000;
  }

  // ----------------------------------------------------------------- acciones

  /**
   * Qué puede hacer el jugador del asiento `seatIndex` si es su turno.
   */
  legalActions(seatIndex: number): LegalActions | null {
    if (this.turn !== seatIndex) return null;
    const seat = this.seats[seatIndex];
    if (!seat || !seat.inHand || seat.folded || seat.allIn) return null;

    const toCall = Math.max(0, this.currentBet - seat.bet);
    const callAmount = Math.min(toCall, seat.chips);
    const maxRaiseTo = seat.bet + seat.chips;

    // Si ya actuó y lo enfrenta un all-in que no llegó a subida completa,
    // solo puede igualar o retirarse.
    const canAggress = !this.isLockedToCall(seatIndex) && maxRaiseTo > this.currentBet;
    const minRaiseTo = Math.min(this.fullRaiseTarget(), maxRaiseTo);

    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount,
      canBet: this.currentBet === 0 && canAggress,
      canRaise: this.currentBet > 0 && canAggress,
      minRaiseTo,
      maxRaiseTo,
      raiseIsAllIn: maxRaiseTo <= minRaiseTo,
    };
  }

  /**
   * Total al que hay que llevar la apuesta para que cuente como subida
   * completa. Sin recortar por el stack: sirve tanto para validar como para
   * distinguir un all-in corto de una subida real.
   */
  private fullRaiseTarget(): number {
    if (this.currentBet === 0) return this.settings.bigBlind;
    return this.currentBet + Math.max(this.lastRaiseSize, this.settings.bigBlind);
  }

  /**
   * Un all-in que no alcanza para subida completa no reabre la apuesta: quien
   * ya había actuado e igualado solo puede completar o retirarse.
   */
  private isLockedToCall(seatIndex: number): boolean {
    const seat = this.seats[seatIndex]!;
    return seat.hasActed && seat.bet < this.currentBet && !this.reopened;
  }

  /** Si la última agresión fue una subida completa, la apuesta queda reabierta. */
  private reopened = true;

  act(playerId: string, action: PlayerAction): void {
    const seatIndex = this.findSeat(playerId);
    if (seatIndex === null) throw new Error('No estás sentado en la mesa');
    if (this.turn !== seatIndex) throw new Error('No es tu turno');

    const legal = this.legalActions(seatIndex);
    if (!legal) throw new Error('No podés actuar ahora');

    const seat = this.seats[seatIndex]!;
    seat.missedTurns = 0;

    switch (action.type) {
      case 'fold':
        this.applyFold(seatIndex);
        break;

      case 'check':
        if (!legal.canCheck) throw new Error('No podés pasar: hay una apuesta para igualar');
        seat.hasActed = true;
        seat.lastAction = 'Pasó';
        this.addLog(`${seat.name} pasa`, 'action');
        break;

      case 'call': {
        if (!legal.canCall) throw new Error('No hay nada que igualar');
        const paid = this.commit(seatIndex, legal.callAmount);
        seat.hasActed = true;
        seat.lastAction = seat.allIn ? `All-in ${formatChips(seat.bet)}` : `Igualó ${formatChips(seat.bet)}`;
        this.addLog(
          seat.allIn
            ? `${seat.name} iguala y se va all-in con ${formatChips(paid)}`
            : `${seat.name} iguala ${formatChips(paid)}`,
          'action',
        );
        break;
      }

      case 'bet':
      case 'raise':
      case 'allin': {
        const target =
          action.type === 'allin' ? legal.maxRaiseTo : Math.floor(Number(action.amount));

        if (!Number.isFinite(target)) throw new Error('Monto inválido');
        if (target % this.settings.chipUnit !== 0) {
          throw new Error(`Las apuestas deben ser múltiplos de ${this.settings.chipUnit}`);
        }
        if ((action.type !== 'allin' || target > this.currentBet) && !legal.canBet && !legal.canRaise) {
          throw new Error('No podés subir en este momento');
        }
        if (target <= this.currentBet && target < legal.maxRaiseTo) {
          throw new Error(`Tenés que llevar la apuesta a al menos ${legal.minRaiseTo}`);
        }
        if (target > legal.maxRaiseTo) throw new Error('No tenés tantas fichas');
        // Por debajo del mínimo solo se acepta si es todo el stack (all-in corto).
        if (target < legal.minRaiseTo && target < legal.maxRaiseTo) {
          throw new Error(`La subida mínima es a ${legal.minRaiseTo}`);
        }

        const previousBet = this.currentBet;
        const fullRaiseTo = this.fullRaiseTarget();
        this.commit(seatIndex, target - seat.bet);

        const isFullRaise = seat.bet >= fullRaiseTo;
        this.currentBet = Math.max(this.currentBet, seat.bet);

        if (isFullRaise) {
          this.lastRaiseSize = Math.max(this.currentBet - previousBet, this.settings.bigBlind);
          this.reopened = true;
          // Una subida completa obliga a todos los demás a volver a decidir.
          for (const other of this.activeSeats()) {
            if (other !== seatIndex) this.seats[other]!.hasActed = false;
          }
        } else {
          // All-in corto: no reabre la ronda para quienes ya habían igualado.
          this.reopened = false;
        }

        seat.hasActed = true;

        if (seat.allIn) {
          seat.lastAction = `All-in ${formatChips(seat.bet)}`;
          this.addLog(`${seat.name} va all-in: ${formatChips(seat.bet)}`, 'action');
        } else if (previousBet === 0) {
          seat.lastAction = `Apostó ${formatChips(seat.bet)}`;
          this.addLog(`${seat.name} apuesta ${formatChips(seat.bet)}`, 'action');
        } else {
          seat.lastAction = `Subió a ${formatChips(seat.bet)}`;
          this.addLog(`${seat.name} sube a ${formatChips(seat.bet)}`, 'action');
        }
        break;
      }

      default:
        throw new Error('Acción desconocida');
    }

    this.afterAction();
  }

  private applyFold(seatIndex: number, reason?: string): void {
    const seat = this.seats[seatIndex]!;
    seat.folded = true;
    seat.hasActed = true;
    seat.lastAction = 'Se retiró';
    this.addLog(`${seat.name} se retira${reason ? ` (${reason})` : ''}`, 'action');
  }

  /** Mueve fichas del stack a la apuesta de la calle. Devuelve lo efectivamente puesto. */
  private commit(seatIndex: number, amount: number): number {
    const seat = this.seats[seatIndex]!;
    const paid = Math.max(0, Math.min(Math.floor(amount), seat.chips));
    seat.chips -= paid;
    seat.bet += paid;
    seat.committed += paid;
    if (seat.chips === 0) seat.allIn = true;
    return paid;
  }

  private afterAction(): void {
    if (!this.isHandLive()) return;

    // ¿Quedó uno solo? Se lleva el bote sin mostrar cartas.
    if (this.contenders().length <= 1) {
      this.endHand();
      return;
    }

    if (this.bettingRoundComplete()) {
      this.finishBettingRound();
      return;
    }

    const next = this.nextActiveFrom((this.turn ?? 0) + 1);
    this.setTurn(next);
    if (next === null) this.finishBettingRound();
  }

  private bettingRoundComplete(): boolean {
    const active = this.activeSeats();
    if (active.length === 0) return true;

    // Con un solo jugador con fichas y el resto all-in, no hay más que apostar.
    if (active.length === 1) {
      const only = this.seats[active[0]!]!;
      const others = this.contenders().filter((s) => s !== active[0]);
      if (others.length > 0 && others.every((s) => this.seats[s]!.allIn)) {
        return only.hasActed && only.bet >= this.currentBet;
      }
    }

    return active.every((s) => {
      const seat = this.seats[s]!;
      return seat.hasActed && seat.bet === this.currentBet;
    });
  }

  private finishBettingRound(): void {
    this.collectBetsIntoPots();

    if (this.phase === 'river') {
      this.endHand();
      return;
    }

    // Si ya nadie puede apostar, se corren todas las calles de una.
    const noMoreBetting = this.everyoneElseAllIn();

    this.dealNextStreet();

    const first = noMoreBetting ? null : this.nextActiveFrom(this.firstToActPostflop());
    if (first === null) {
      this.runOutBoard();
      this.endHand();
      return;
    }

    this.setTurn(first);
  }

  /** Reparte las cartas comunitarias que falten hasta completar el river. */
  private runOutBoard(): void {
    let guard = 0;
    while (this.board.length < 5 && guard++ < 5) this.dealNextStreet();
  }

  private everyoneElseAllIn(): boolean {
    const contenders = this.contenders();
    const active = this.activeSeats();
    if (active.length === 0) return true;
    if (active.length > 1) return false;
    const onlyActive = active[0]!;
    const rest = contenders.filter((s) => s !== onlyActive);
    return rest.length > 0 && rest.every((s) => this.seats[s]!.allIn) &&
      this.seats[onlyActive]!.bet >= this.currentBet;
  }

  /** Postflop abre el primero a la izquierda del botón. */
  private firstToActPostflop(): number {
    return (this.button ?? 0) + 1;
  }

  private collectBetsIntoPots(): void {
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.bet = 0;
      seat.hasActed = false;
    }
    this.currentBet = 0;
    this.lastRaiseSize = this.settings.bigBlind;
    this.reopened = true;
    this.pots = this.snapshotPots();
  }

  private snapshotPots(): Pot[] {
    return buildPots(
      this.contendersAndFolders().map((i) => ({
        seat: i,
        committed: this.seats[i]!.committed,
        folded: this.seats[i]!.folded,
      })),
    );
  }

  /** Todos los que recibieron cartas en esta mano, hayan apostado o no. */
  private dealtInSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i]?.inHand) out.push(i);
    }
    return out;
  }

  private contendersAndFolders(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat?.inHand && seat.committed > 0) out.push(i);
    }
    return out;
  }

  private dealNextStreet(): void {
    switch (this.phase) {
      case 'preflop':
        this.draw(); // quemada
        this.board.push(this.draw(), this.draw(), this.draw());
        this.phase = 'flop';
        this.addLog(`Flop: ${this.board.map(cardLabel).join(' ')}`, 'deal');
        break;
      case 'flop':
        this.draw();
        this.board.push(this.draw());
        this.phase = 'turn';
        this.addLog(`Turn: ${cardLabel(this.board[3]!)}`, 'deal');
        break;
      case 'turn':
        this.draw();
        this.board.push(this.draw());
        this.phase = 'river';
        this.addLog(`River: ${cardLabel(this.board[4]!)}`, 'deal');
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- showdown

  private endHand(): void {
    // Las apuestas sueltas de la calle en curso entran al bote.
    for (const seat of this.seats) {
      if (seat) seat.bet = 0;
    }

    const participants = this.contendersAndFolders();
    const contributors = participants.map((i) => ({
      seat: i,
      committed: this.seats[i]!.committed,
      folded: this.seats[i]!.folded,
    }));

    // Devolver la parte de la apuesta que nadie igualó.
    const uncalled = uncalledBet(contributors);
    if (uncalled && uncalled.amount > 0) {
      const seat = this.seats[uncalled.seat]!;
      seat.chips += uncalled.amount;
      seat.committed -= uncalled.amount;
      const entry = contributors.find((c) => c.seat === uncalled.seat);
      if (entry) entry.committed -= uncalled.amount;
      this.addLog(
        `Se le devuelven ${formatChips(uncalled.amount)} a ${seat.name} (nadie igualó)`,
        'result',
      );
    }

    const pots = buildPots(contributors);
    this.pots = pots;

    const contenders = this.contenders();
    const payouts: Payout[] = [];
    const shown: ShowdownEntry[] = [];

    if (contenders.length === 1) {
      // Todos se retiraron: se lleva todo sin mostrar.
      const winner = contenders[0]!;
      const total = pots.reduce((sum, pot) => sum + pot.amount, 0);
      this.seats[winner]!.chips += total;
      this.seats[winner]!.wonLast = total;
      if (total > 0) {
        payouts.push({
          seat: winner,
          name: this.seats[winner]!.name,
          amount: total,
          potLabel: 'Bote',
        });
      }
      shown.push({
        seat: winner,
        name: this.seats[winner]!.name,
        cards: [],
        best: [],
        label: 'Se lleva el bote sin mostrar',
        byFold: true,
      });
      this.phase = 'showdown';
      this.addLog(
        `${this.seats[winner]!.name} gana ${formatChips(total)} (todos se retiraron)`,
        'result',
      );
    } else {
      this.phase = 'showdown';

      const hands = new Map<number, ReturnType<typeof evaluateBest>>();
      for (const seatIndex of contenders) {
        const seat = this.seats[seatIndex]!;
        const hand = evaluateBest([...seat.holeCards, ...this.board]);
        hands.set(seatIndex, hand);
        this.revealed.add(seatIndex);
        shown.push({
          seat: seatIndex,
          name: seat.name,
          cards: seat.holeCards.slice(),
          best: hand.cards,
          label: hand.label,
          byFold: false,
        });
      }

      for (let index = 0; index < pots.length; index++) {
        const pot = pots[index]!;
        if (pot.amount <= 0) continue;
        const potLabel = pots.length === 1 ? 'Bote' : index === 0 ? 'Bote principal' : `Bote lateral ${index}`;

        const eligible = pot.eligible.filter((s) => hands.has(s));
        if (eligible.length === 0) continue;

        const best = Math.max(...eligible.map((s) => hands.get(s)!.score));
        const winners = eligible.filter((s) => hands.get(s)!.score === best);

        const unit = this.settings.chipUnit;
        const share = Math.floor(pot.amount / unit / winners.length) * unit;
        let remainder = pot.amount - share * winners.length;

        // Las fichas que no se pueden partir van al primero a la izquierda del botón.
        const ordered = this.orderFromButton(winners);
        for (const seatIndex of ordered) {
          let amount = share;
          if (remainder > 0) {
            amount += unit;
            remainder -= unit;
          }
          this.seats[seatIndex]!.chips += amount;
          this.seats[seatIndex]!.wonLast += amount;
          payouts.push({
            seat: seatIndex,
            name: this.seats[seatIndex]!.name,
            amount,
            potLabel,
          });
        }

        const names = ordered.map((s) => this.seats[s]!.name).join(' y ');
        this.addLog(
          `${names} ${ordered.length > 1 ? 'se reparten' : 'gana'} ${formatChips(pot.amount)} con ${
            hands.get(ordered[0]!)!.label
          }${pots.length > 1 ? ` (${potLabel.toLowerCase()})` : ''}`,
          'result',
        );
      }
    }

    // El registro se arma ANTES de limpiar `committed`: es lo que alimenta el
    // ranking, y necesita saber cuánto puso cada uno además de cuánto ganó.
    const potSize = pots.reduce((sum, pot) => sum + pot.amount, 0);
    const record: HandRecord = {
      roomCode: this.code,
      handNumber: this.handNumber,
      potSize,
      playedAt: Date.now(),
      // Se incluye a todos los que recibieron cartas, no solo a los que
      // pusieron fichas: si no, quien se retira preflop sin pagar ciega no
      // sumaría la mano como jugada.
      players: this.dealtInSeats().map((index) => {
        const seat = this.seats[index]!;
        return {
          playerId: seat.playerId,
          userId: seat.userId,
          name: seat.name,
          netChips: seat.wonLast - seat.committed,
          committed: seat.committed,
          won: seat.wonLast,
          handLabel: shown.find((entry) => entry.seat === index && !entry.byFold)?.label ?? null,
        };
      }),
    };

    for (const seat of this.seats) {
      if (seat) seat.committed = 0;
    }

    this.lastResult = {
      handNumber: this.handNumber,
      board: this.board.slice(),
      shown,
      payouts,
      summary: summarize(payouts),
    };

    if (this.onHandComplete && record.players.length > 0) {
      try {
        this.onHandComplete(record);
      } catch (error) {
        // Que falle el guardado nunca debe cortar la partida.
        console.error('No se pudo registrar la mano:', error);
      }
    }

    // Quien se quedó sin fichas pasa a descanso (puede recargar si está habilitado).
    for (const seat of this.seats) {
      if (seat && seat.chips <= 0) {
        seat.sittingOut = true;
        seat.allIn = false;
      }
    }

    this.turn = null;
    this.turnEndsAt = null;
    this.phase = 'handover';
    const extra = Math.min(shown.filter((s) => !s.byFold).length, 4) * SHOWDOWN_EXTRA_MS;
    this.nextHandAt = Date.now() + HANDOVER_MS + extra;
    this.syncTournament();
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i] && this.pendingDepartures.has(this.seats[i]!.playerId)) this.removeSeat(i);
    }
  }

  /** Ordena asientos empezando por el primero a la izquierda del botón. */
  private orderFromButton(seatIndices: number[]): number[] {
    const start = (this.button ?? 0) + 1;
    return seatIndices
      .slice()
      .sort((a, b) => mod(a - start, MAX_SEATS) - mod(b - start, MAX_SEATS));
  }

  // -------------------------------------------------------------------- reloj

  /**
   * Avanza el reloj: aplica timeouts de turno, arranca la mano siguiente y
   * libera los asientos de quien se desconectó hace mucho.
   */
  tick(now = Date.now()): boolean {
    let changed = false;

    // Asientos abandonados.
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat || seat.connected || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt > RECONNECT_GRACE_MS) {
        // Una desconexión no elimina a un participante ni decide su recompra.
        if (this.match) continue;
        this.addLog(`${seat.name} se desconectó y deja la mesa`, 'system');
        this.leave(seat.playerId);
        changed = true;
      }
    }

    // Timeout del turno.
    if (this.turn !== null && this.turnEndsAt !== null && now >= this.turnEndsAt) {
      const seatIndex = this.turn;
      const seat = this.seats[seatIndex]!;
      const legal = this.legalActions(seatIndex);

      seat.missedTurns++;
      if (legal?.canCheck) {
        seat.hasActed = true;
        seat.lastAction = 'Pasó (tiempo)';
        this.addLog(`${seat.name} pasa por tiempo`, 'action');
      } else {
        this.applyFold(seatIndex, 'tiempo');
      }

      if (seat.missedTurns >= 2 && !seat.connected && !this.match) {
        seat.sittingOut = true;
        this.addLog(`${seat.name} queda de descanso por inactividad`, 'system');
      }

      this.afterAction();
      changed = true;
    }

    // Próxima mano.
    if (this.nextHandAt !== null && now >= this.nextHandAt) {
      this.nextHandAt = null;
      if (this.running) {
        if (this.eligibleSeats().length >= 2) {
          this.beginHand();
        } else {
          this.phase = 'waiting';
          this.addLog('No hay suficientes jugadores con fichas. Partida en espera.', 'system');
        }
      } else {
        this.phase = 'waiting';
      }
      changed = true;
    }

    // Reanudar si volvió a haber gente.
    if (this.running && this.phase === 'waiting' && this.nextHandAt === null && (!this.match || this.match.status === 'playing')) {
      if (this.eligibleSeats().length >= 2) {
        this.nextHandAt = now + 1500;
        changed = true;
      }
    }

    return changed;
  }

  // ------------------------------------------------------------------ estado

  private addLog(text: string, kind: LogEntry['kind']): void {
    const entry: LogEntry = { id: ++this.logSeq, at: Date.now(), text, kind };
    this.logEntries.push(entry);
    this.pendingLog.push(entry);
    if (this.logEntries.length > 300) this.logEntries.splice(0, this.logEntries.length - 300);
  }

  /** Entradas de log nuevas desde la última llamada. */
  drainLog(): LogEntry[] {
    const out = this.pendingLog;
    this.pendingLog = [];
    return out;
  }

  recentLog(count = 60): LogEntry[] {
    return this.logEntries.slice(-count);
  }

  /**
   * Estado visible para un jugador. Oculta las cartas ajenas: es el único lugar
   * que decide qué puede ver cada uno.
   */
  getStateFor(playerId: string): GameState {
    const youSeat = this.findSeat(playerId);
    const showdownVisible = this.phase === 'showdown' || this.phase === 'handover';

    const players: PublicPlayer[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;

      const isYou = i === youSeat;
      const canSeeCards = isYou || (showdownVisible && this.revealed.has(i));
      const cards: (Card | null)[] = seat.holeCards.length
        ? canSeeCards
          ? seat.holeCards.slice()
          : seat.holeCards.map(() => null)
        : [];

      let handLabel: string | null = null;
      if (canSeeCards && seat.holeCards.length === 2 && this.board.length >= 3) {
        handLabel = evaluateBest([...seat.holeCards, ...this.board]).label;
      }

      players.push({
        id: seat.playerId,
        name: seat.name,
        seat: i,
        chips: seat.chips,
        rebuyUsed: this.rebuyUsed.has(seat.playerId),
        bet: seat.bet,
        committed: seat.committed,
        status: this.statusOf(seat),
        cards,
        connected: seat.connected,
        isDealer: this.button === i,
        isTurn: this.turn === i,
        lastAction: seat.lastAction,
        handLabel,
        wonLast: seat.wonLast,
      });
    }

    const potViews: PotView[] = this.pots.map((pot, index) => ({
      amount: pot.amount,
      eligible: pot.eligible,
      label: this.pots.length === 1 ? 'Bote' : index === 0 ? 'Principal' : `Lateral ${index}`,
    }));

    const liveBets = this.seats.reduce((sum, seat) => sum + (seat?.bet ?? 0), 0);
    const potTotal = this.pots.reduce((sum, pot) => sum + pot.amount, 0);

    return {
      tournament: this.match?.view(this.tournamentSeats()) ?? null,
      roomCode: this.code,
      settings: this.settings,
      phase: this.phase,
      handNumber: this.handNumber,
      players,
      board: this.board.slice(),
      pots: potViews,
      totalPot: potTotal + liveBets,
      currentBet: this.currentBet,
      dealerSeat: this.button,
      turnSeat: this.turn,
      turnEndsAt: this.turnEndsAt,
      serverNow: Date.now(),
      youSeat,
      youId: playerId,
      canRebuy: youSeat !== null && this.settings.allowRebuy &&
        (!this.settings.tournament || this.match?.entries.get(playerId)?.status === 'rebuy') &&
        !this.rebuyUsed.has(playerId) && this.seats[youSeat]!.chips === 0 &&
        !(this.seats[youSeat]!.inHand && this.isHandLive()),
      hostId: this.hostId,
      legal: youSeat === null ? null : this.legalActions(youSeat),
      lastResult: this.lastResult,
      running: this.running,
      pausedReason: this.pausedReason(),
    };
  }

  private statusOf(seat: Seat): PublicPlayer['status'] {
    if (seat.sittingOut) return 'sitting-out';
    if (!seat.inHand) return 'waiting';
    if (seat.folded) return 'folded';
    if (seat.allIn) return 'allin';
    return this.isHandLive() || this.phase === 'showdown' ? 'playing' : 'waiting';
  }

  private pausedReason(): string | null {
    if (this.match?.status === 'finished') return 'Partida terminada';
    if (this.match?.status === 'awaiting-rebuy') {
      const names = [...this.match.entries.values()].filter((p) => p.status === 'rebuy').map((p) => p.name);
      return `Esperando recompra o retiro de ${names.join(', ')}`;
    }
    if (this.isHandLive()) return null;
    if (this.settings.tournament && !this.match) return 'Esperando al menos 3 jugadores para empezar';
    if (!this.running) {
      return this.eligibleSeats().length < 2
        ? 'Esperando jugadores (hacen falta 2 con fichas)'
        : 'Esperando que el anfitrión empiece la partida';
    }
    if (this.eligibleSeats().length < 2) return 'Esperando jugadores con fichas';
    return null;
  }
}

function summarize(payouts: Payout[]): string {
  if (payouts.length === 0) return 'Mano sin bote';
  const byPlayer = new Map<string, number>();
  for (const payout of payouts) {
    byPlayer.set(payout.name, (byPlayer.get(payout.name) ?? 0) + payout.amount);
  }
  return [...byPlayer.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => `${name} +${formatChips(amount)}`)
    .join(' · ');
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
