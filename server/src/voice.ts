/**
 * Soporte de voz: solo la parte que el servidor tiene que hacer.
 *
 * El audio NO pasa por acá. Los navegadores se conectan directo entre ellos
 * (WebRTC en malla), así que el servidor únicamente:
 *   1. entrega la lista de servidores ICE con credenciales temporales, y
 *   2. hace de cartero para que dos navegadores se pongan de acuerdo.
 *
 * Eso mantiene la latencia en el mínimo posible y el costo de ancho de banda
 * del servidor prácticamente en cero.
 */

import { createHmac } from 'node:crypto';

import type { IceConfig } from '@puker/shared';

import { config } from './config.js';

/**
 * Credenciales temporales para coturn configurado con `use-auth-secret`.
 *
 * El formato es el estándar de la "TURN REST API": el usuario es una marca de
 * tiempo de vencimiento y la clave es su HMAC. Así no hay usuarios fijos
 * guardados en ningún lado, y una credencial filtrada caduca sola.
 */
export function buildIceConfig(playerId: string): IceConfig {
  const iceServers: IceConfig['iceServers'] = [];

  if (config.voice.stunUrls.length > 0) {
    iceServers.push({ urls: config.voice.stunUrls });
  }

  const { turnUrls, turnSecret, turnUsername, turnPassword } = config.voice;
  const hasTurn = turnUrls.length > 0 && Boolean(turnSecret || (turnUsername && turnPassword));

  if (hasTurn && turnSecret) {
    const expiry = Math.floor(Date.now() / 1000) + config.voice.turnTtlSec;
    const username = `${expiry}:${playerId}`;
    const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  } else if (hasTurn) {
    // Un TURN contratado suele dar usuario y clave fijos y listo.
    iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnPassword });
  }

  return { iceServers, hasTurn };
}

/**
 * Quién habla en cada sala. Solo guarda identificadores: no toca el audio.
 */
export class VoiceRooms {
  private readonly byRoom = new Map<string, Set<string>>();

  join(roomCode: string, playerId: string): void {
    let members = this.byRoom.get(roomCode);
    if (!members) {
      members = new Set();
      this.byRoom.set(roomCode, members);
    }
    members.add(playerId);
  }

  leave(roomCode: string, playerId: string): void {
    const members = this.byRoom.get(roomCode);
    if (!members) return;
    members.delete(playerId);
    if (members.size === 0) this.byRoom.delete(roomCode);
  }

  leaveAll(playerId: string): string[] {
    const affected: string[] = [];
    for (const [roomCode, members] of this.byRoom) {
      if (members.delete(playerId)) affected.push(roomCode);
      if (members.size === 0) this.byRoom.delete(roomCode);
    }
    return affected;
  }

  members(roomCode: string): string[] {
    return [...(this.byRoom.get(roomCode) ?? [])];
  }

  has(roomCode: string, playerId: string): boolean {
    return this.byRoom.get(roomCode)?.has(playerId) ?? false;
  }
}
