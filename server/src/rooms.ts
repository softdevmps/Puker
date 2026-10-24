/**
 * Salas en memoria.
 *
 * Las mesas en curso no se guardan en la base a propósito: si el servidor se
 * reinicia, se pierden. Lo que sí sobrevive son las cuentas y los resultados
 * de cada mano, que es lo que alimenta el ranking.
 *
 * La identidad del jugador sale de su cuenta, así que reconectar es trivial:
 * el mismo usuario siempre tiene el mismo `playerId` y vuelve a su asiento.
 */

import { type ChatMessage, type TableSettings, sanitizeChat } from '@puker/shared';

import { makeRoomCode } from './rng.js';
import { Table, type HandRecord } from './table.js';

/** Sala vacía más de esto se borra sola. */
const IDLE_ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 200;
const CHAT_HISTORY = 80;

export interface PlayerIdentity {
  playerId: string;
  userId: number;
  name: string;
}

/** El asiento se ata a la cuenta: reconectar siempre te devuelve el tuyo. */
export function identityOf(user: { id: number; display_name: string }): PlayerIdentity {
  return { playerId: `u${user.id}`, userId: user.id, name: user.display_name };
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
  seated: boolean;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Se invoca al cerrar cada mano en cualquier mesa. Lo cablea el servidor. */
  onHandComplete: ((record: HandRecord) => void) | null = null;

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

  create(player: PlayerIdentity, settings?: Partial<TableSettings>): JoinOutcome {
    if (this.rooms.size >= MAX_ROOMS) {
      this.cleanup();
      if (this.rooms.size >= MAX_ROOMS) throw new Error('El servidor está lleno, probá más tarde');
    }

    const code = this.freshCode();
    const table = new Table(code, settings);
    table.onHandComplete = (record) => this.onHandComplete?.(record);

    const room: Room = {
      table,
      chat: [],
      chatSeq: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.rooms.set(code, room);

    table.sit(player.playerId, player.name, undefined, player.userId);
    return { room, seated: true };
  }

  join(rawCode: string, player: PlayerIdentity): JoinOutcome {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) throw new Error('No existe ninguna sala con ese código');

    room.lastActivityAt = Date.now();

    try {
      room.table.sit(player.playerId, player.name, undefined, player.userId);
      return { room, seated: true };
    } catch {
      // Mesa llena: entra como espectador y se sienta cuando se libere un lugar.
      return { room, seated: false };
    }
  }

  addChat(room: Room, from: string, rawText: string): ChatMessage | null {
    const text = sanitizeChat(rawText);
    if (!text) return null;
    const message: ChatMessage = { id: ++room.chatSeq, at: Date.now(), from, text };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
    room.lastActivityAt = Date.now();
    return message;
  }

  /** Borra las salas vacías y viejas. */
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
    return removed;
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
