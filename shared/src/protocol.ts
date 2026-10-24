/**
 * Contrato entre cliente y servidor.
 *
 * Regla de oro: el servidor es la única autoridad. El cliente nunca calcula
 * resultados ni ve cartas que no le corresponden; solo pinta el `GameState`
 * que recibe y manda intenciones de acción.
 */

import type { Card } from './cards.js';

export const MAX_SEATS = 9;

export interface TableSettings {
  /** Ciega chica. */
  smallBlind: number;
  /** Ciega grande. Es también la apuesta mínima. */
  bigBlind: number;
  /** Fichas con las que entra cada jugador. */
  startingStack: number;
  /** Segundos para decidir antes del auto-fold / auto-check. */
  turnTimeSec: number;
  /** Cantidad de asientos habilitados en la mesa (2..9). */
  maxSeats: number;
  /** Si está activo, al quedarse sin fichas se recarga el stack inicial. */
  allowRebuy: boolean;
}

export const DEFAULT_SETTINGS: TableSettings = {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 2000,
  turnTimeSec: 30,
  maxSeats: 6,
  allowRebuy: true,
};

export type PlayerStatus =
  /** Sentado pero esperando que arranque la próxima mano. */
  | 'waiting'
  /** Jugando la mano actual. */
  | 'playing'
  /** Se retiró de la mano actual. */
  | 'folded'
  /** Puso todas sus fichas. */
  | 'allin'
  /** Sentado pero sin participar (de descanso o sin fichas). */
  | 'sitting-out';

export type Phase =
  /** No hay mano en curso. */
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  /** Se muestran las cartas y se reparte el bote. */
  | 'showdown'
  /** Pausa corta entre manos. */
  | 'handover';

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  chips: number;
  /** Apostado en la calle actual. */
  bet: number;
  /** Apostado en toda la mano. */
  committed: number;
  status: PlayerStatus;
  /** Dos entradas. `null` = carta tapada para quien mira. */
  cards: (Card | null)[];
  connected: boolean;
  isDealer: boolean;
  isTurn: boolean;
  /** Texto de la última acción: "Subió a 200", "Pasó"... */
  lastAction: string | null;
  /** Nombre de la mano. Solo se manda si las cartas son visibles. */
  handLabel: string | null;
  /** Fichas ganadas en la mano que recién terminó, para la animación. */
  wonLast: number;
}

export interface PotView {
  amount: number;
  /** Asientos con derecho a este bote. */
  eligible: number[];
  label: string;
}

/** Qué puede hacer el jugador al que le toca. Lo calcula el servidor. */
export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Fichas a poner para igualar (ya recortado al stack disponible). */
  callAmount: number;
  /** Primera apuesta de la calle (no hay apuesta previa que igualar). */
  canBet: boolean;
  /** Subir una apuesta existente. */
  canRaise: boolean;
  /** Total mínimo al que se puede llevar la apuesta de la calle. */
  minRaiseTo: number;
  /** Total máximo = todo el stack. */
  maxRaiseTo: number;
  /** El stack no alcanza para la subida mínima: solo queda all-in. */
  raiseIsAllIn: boolean;
}

export interface ShowdownEntry {
  seat: number;
  name: string;
  cards: Card[];
  /** Las 5 cartas que forman su mejor mano. */
  best: Card[];
  label: string;
  /** Si no llegó al showdown pero se le adjudicó el bote por abandono. */
  byFold: boolean;
}

export interface Payout {
  seat: number;
  name: string;
  amount: number;
  potLabel: string;
}

export interface HandResult {
  handNumber: number;
  board: Card[];
  shown: ShowdownEntry[];
  payouts: Payout[];
  summary: string;
}

export interface GameState {
  roomCode: string;
  settings: TableSettings;
  phase: Phase;
  handNumber: number;
  /** Solo los asientos ocupados. */
  players: PublicPlayer[];
  board: Card[];
  pots: PotView[];
  totalPot: number;
  /** Apuesta más alta de la calle actual. */
  currentBet: number;
  dealerSeat: number | null;
  turnSeat: number | null;
  /** Epoch ms del SERVIDOR en que se vence el tiempo del turno. */
  turnEndsAt: number | null;
  /**
   * Reloj del servidor al armar este estado. El cliente lo usa para corregir
   * la diferencia con su propio reloj y que la cuenta regresiva no se desfase.
   */
  serverNow: number;
  /** Tu asiento, o null si estás mirando. */
  youSeat: number | null;
  youId: string;
  hostId: string | null;
  /** Acciones permitidas para ti ahora mismo (null si no es tu turno). */
  legal: LegalActions | null;
  lastResult: HandResult | null;
  /** La partida está en marcha (reparte manos sola). */
  running: boolean;
  /** Por qué está detenida, para mostrarlo en la UI. */
  pausedReason: string | null;
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** `amount` es el TOTAL al que querés llevar tu apuesta de la calle. */
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allin' };

export interface LogEntry {
  id: number;
  at: number;
  text: string;
  kind: 'action' | 'system' | 'deal' | 'result';
}

export interface ChatMessage {
  id: number;
  at: number;
  from: string;
  text: string;
}

/** Respuesta estándar de los callbacks de socket. */
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: { name: string; settings?: Partial<TableSettings> },
    ack: (res: Ack<JoinResult>) => void,
  ) => void;
  'room:join': (
    payload: { code: string; name: string; token?: string },
    ack: (res: Ack<JoinResult>) => void,
  ) => void;
  'seat:take': (payload: { seat: number }, ack: (res: Ack) => void) => void;
  'seat:leave': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'seat:sitout': (payload: { sitOut: boolean }, ack: (res: Ack) => void) => void;
  'game:start': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'game:pause': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'game:action': (payload: PlayerAction, ack: (res: Ack) => void) => void;
  'player:rebuy': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'settings:update': (payload: Partial<TableSettings>, ack: (res: Ack) => void) => void;
  'chat:send': (payload: { text: string }, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  log: (entries: LogEntry[]) => void;
  chat: (message: ChatMessage) => void;
  toast: (payload: { kind: 'info' | 'error' | 'success'; text: string }) => void;
  kicked: (payload: { reason: string }) => void;
}
