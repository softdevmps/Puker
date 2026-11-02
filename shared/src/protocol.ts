/**
 * Contrato entre cliente y servidor.
 *
 * Regla de oro: el servidor es la única autoridad. El cliente nunca calcula
 * resultados ni ve cartas que no le corresponden; solo pinta el `GameState`
 * que recibe y manda intenciones de acción.
 */

import type { Card } from './cards.js';
import { CHIP_UNIT, STARTING_STACK } from './chips.js';
import type { TournamentView } from './tournament.js';

export const MAX_SEATS = 9;

export interface TableSettings {
  /** Cierra la partida al quedar como máximo dos jugadores. */
  tournament: boolean;
  /** Importes en pesos enteros; el reparto se calcula en centavos. */
  entryFee: number;
  rebuyFee: number;
  /** Unidad indivisible de apuesta y reparto. */
  chipUnit: number;
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
  /** Permite una única recarga del stack inicial por jugador y partida. */
  allowRebuy: boolean;
}

export const DEFAULT_SETTINGS: TableSettings = {
  tournament: true,
  entryFee: 5000,
  rebuyFee: 4000,
  chipUnit: CHIP_UNIT,
  smallBlind: 50,
  bigBlind: 100,
  startingStack: STARTING_STACK,
  turnTimeSec: 30,
  maxSeats: 6,
  allowRebuy: true,
};

// ------------------------------------------------------------------- cuentas

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  transferAlias: string | null;
  createdAt: number;
  /** Puede entrar con contraseña. */
  hasPassword: boolean;
  /** Tiene una cuenta de Google vinculada. */
  hasGoogle: boolean;
}

export interface ProfileUpdate {
  displayName?: string;
  bio?: string;
  transferAlias?: string;
  /** JPEG optimizado por el navegador; null quita la foto actual. */
  avatarDataUrl?: string | null;
}

export interface AuthInfo {
  user: AuthUser | null;
  /** El servidor tiene credenciales de Google configuradas. */
  googleEnabled: boolean;
}

export interface RankingEntry {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  /** Fichas netas acumuladas: lo ganado menos lo apostado. */
  net: number;
  hands: number;
  wins: number;
  biggestPot: number;
  bestHand: string | null;
  lastPlayedAt: number | null;
}

// --------------------------------------------------------------------- juego

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
  avatarUrl?: string | null;
  seat: number;
  chips: number;
  /** Ya consumió su única recarga en esta partida. */
  rebuyUsed: boolean;
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
  tournament: TournamentView | null;
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
  /** Puede usar su recarga ahora (sin fichas y fuera de una mano activa). */
  canRebuy: boolean;
  hostId: string | null;
  /** Acciones permitidas para ti ahora mismo (null si no es tu turno). */
  legal: LegalActions | null;
  lastResult: HandResult | null;
  /** La partida está en marcha (reparte manos sola). */
  running: boolean;
  /** Por qué está detenida, para mostrarlo en la UI. */
  pausedReason: string | null;
}

// ----------------------------------------------------------------------- voz

/** Configuración ICE que el servidor le entrega al navegador. */
export interface IceConfig {
  iceServers: {
    urls: string | string[];
    username?: string;
    credential?: string;
  }[];
  /** Si no hay TURN configurado, se avisa para poder alertar en la UI. */
  hasTurn: boolean;
}

export interface VoicePeer {
  playerId: string;
  name: string;
  seat: number | null;
}

// --------------------------------------------------------------------- juego

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
  /** False si la mesa estaba llena y entraste como espectador. */
  seated: boolean;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: { settings?: Partial<TableSettings> },
    ack: (res: Ack<JoinResult>) => void,
  ) => void;
  'room:join': (payload: { code: string }, ack: (res: Ack<JoinResult>) => void) => void;
  'seat:take': (payload: { seat: number }, ack: (res: Ack) => void) => void;
  'seat:leave': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'seat:sitout': (payload: { sitOut: boolean }, ack: (res: Ack) => void) => void;
  'game:start': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'game:pause': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'game:action': (payload: PlayerAction, ack: (res: Ack) => void) => void;
  'player:rebuy': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'player:withdraw': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  'settings:update': (payload: Partial<TableSettings>, ack: (res: Ack) => void) => void;
  'chat:send': (payload: { text: string }, ack: (res: Ack) => void) => void;

  /** Pide la config ICE (STUN/TURN) para arrancar la voz. */
  'voice:config': (payload: Record<string, never>, ack: (res: Ack<IceConfig>) => void) => void;
  /** Avisa que encendiste el micrófono y querés hablar. */
  'voice:join': (payload: Record<string, never>, ack: (res: Ack<VoicePeer[]>) => void) => void;
  'voice:leave': (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  /** Relay opaco de la negociación WebRTC hacia otro par. */
  'voice:signal': (payload: { to: string; data: unknown }, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  log: (entries: LogEntry[]) => void;
  chat: (message: ChatMessage) => void;
  toast: (payload: { kind: 'info' | 'error' | 'success'; text: string }) => void;
  kicked: (payload: { reason: string }) => void;

  'voice:peer-joined': (peer: VoicePeer) => void;
  'voice:peer-left': (payload: { playerId: string }) => void;
  'voice:signal': (payload: { from: string; data: unknown }) => void;
}
