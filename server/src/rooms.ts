/**
 * Salas en memoria y sesiones de jugador.
 *
 * No hay base de datos a propósito: es una partida casera entre amigos. Si el
 * servidor se reinicia, las mesas se pierden. A cambio, el deploy es un solo
 * proceso sin infraestructura alrededor.
 */

import {
  type ChatMessage,
  type TableSettings,
  sanitizeChat,
  sanitizeName,
} from '@puker/shared';

import { makeRoomCode, makeToken } from './rng.js';
import { Table } from './table.js';

/** Sala vacía más de esto se borra sola. */
const IDLE_ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 200;
const CHAT_HISTORY = 80;

export interface Session {
  playerId: string;
  token: string;
  name: string;
  roomCode: string;
}

export interface Room {
  table: Table;
  chat: ChatMessage[];
  chatSeq: number;
  createdAt: number;
  lastActivityAt: number;
}

export interface JoinOutcome {
  room: Room;
  session: Session;
  resumed: boolean;
  seated: boolean;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sessionsByToken = new Map<string, Session>();

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  exists(code: string): boolean {
    return this.rooms.has(normalizeCode(code));
  }

  listCodes(): string[] {
    return [...this.rooms.keys()];
  }

  create(rawName: string, settings?: Partial<TableSettings>): JoinOutcome {
    if (this.rooms.size >= MAX_ROOMS) {
      this.cleanup();
      if (this.rooms.size >= MAX_ROOMS) throw new Error('El servidor está lleno, probá más tarde');
    }

    const name = requireName(rawName);
    const code = this.freshCode();
    const room: Room = {
      table: new Table(code, settings),
      chat: [],
      chatSeq: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.rooms.set(code, room);

    const session = this.newSession(name, code);
    room.table.sit(session.playerId, session.name);
    return { room, session, resumed: false, seated: true };
  }

  /**
   * Entra a una sala. Si llega un token conocido, recupera la sesión anterior
   * (y con ella el asiento y las fichas) en lugar de crear un jugador nuevo.
   */
  join(rawCode: string, rawName: string, token?: string): JoinOutcome {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) throw new Error('No existe ninguna sala con ese código');

    const name = requireName(rawName);
    room.lastActivityAt = Date.now();

    const existing = token ? this.sessionsByToken.get(token) : undefined;
    if (existing && existing.roomCode === code) {
      existing.name = name;
      const seat = room.table.seatOf(existing.playerId);
      if (seat) {
        room.table.sit(existing.playerId, name);
        return { room, session: existing, resumed: true, seated: true };
      }
      // La sesión existe pero perdió el asiento (lo liberó el grace period).
      const seated = this.trySit(room, existing);
      return { room, session: existing, resumed: true, seated };
    }

    const session = this.newSession(name, code);
    const seated = this.trySit(room, session);
    return { room, session, resumed: false, seated };
  }

  private trySit(room: Room, session: Session): boolean {
    try {
      room.table.sit(session.playerId, session.name);
      return true;
    } catch {
      // Mesa llena: entra como espectador.
      return false;
    }
  }

  sessionByToken(token: string): Session | undefined {
    return this.sessionsByToken.get(token);
  }

  addChat(room: Room, from: string, rawText: string): ChatMessage | null {
    const text = sanitizeChat(rawText);
    if (!text) return null;
    const message: ChatMessage = {
      id: ++room.chatSeq,
      at: Date.now(),
      from,
      text,
    };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
    room.lastActivityAt = Date.now();
    return message;
  }

  /** Borra salas vacías y viejas, y las sesiones que quedaron colgadas. */
  cleanup(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      const empty = room.table.occupiedCount === 0;
      const idle = now - room.lastActivityAt > IDLE_ROOM_TTL_MS;
      if (empty && (idle || now - room.createdAt > IDLE_ROOM_TTL_MS)) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }

    if (removed.length) {
      for (const [token, session] of this.sessionsByToken) {
        if (!this.rooms.has(session.roomCode)) this.sessionsByToken.delete(token);
      }
    }
    return removed;
  }

  private newSession(name: string, roomCode: string): Session {
    const session: Session = {
      playerId: `p_${makeToken().slice(0, 12)}`,
      token: makeToken(),
      name,
      roomCode,
    };
    this.sessionsByToken.set(session.token, session);
    return session;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = makeRoomCode(4);
      if (!this.rooms.has(code)) return code;
    }
    // Improbable, pero mejor un código más largo que un error.
    return makeRoomCode(6);
  }
}

export function normalizeCode(code: string): string {
  return String(code ?? '').trim().toUpperCase().slice(0, 8);
}

function requireName(raw: string): string {
  const name = sanitizeName(String(raw ?? ''));
  if (name.length < 2) throw new Error('El nombre tiene que tener al menos 2 caracteres');
  return name;
}
