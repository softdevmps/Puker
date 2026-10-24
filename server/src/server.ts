/**
 * Servidor HTTP + Socket.IO.
 *
 * En producción también sirve el build del cliente, así todo el proyecto es un
 * único proceso de Node (fácil de subir a Render, Railway, Fly o un VPS).
 *
 * Se expone como fábrica en vez de arrancar al importarse, para que los tests
 * de integración puedan levantar y bajar instancias a voluntad.
 */

import { type Server as HttpServer, createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import compression from 'compression';
import express from 'express';
import { Server, type Socket } from 'socket.io';

import {
  type Ack,
  type ClientToServerEvents,
  type LogEntry,
  type PlayerAction,
  type ServerToClientEvents,
  MAX_SEATS,
  sanitizeName,
} from '@puker/shared';

import { RoomManager, normalizeCode, type Room } from './rooms.js';

const TICK_MS = 400;
const CHAT_MIN_INTERVAL_MS = 700;
const CLEANUP_MS = 5 * 60 * 1000;

const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDist = resolve(here, '../../client/dist');

interface SocketData {
  token?: string;
  playerId?: string;
  roomCode?: string;
  lastChatAt?: number;
}

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface PukerServerOptions {
  /** Carpeta del build del cliente. `false` desactiva el servido de estáticos. */
  clientDist?: string | false;
  /** Intervalo del reloj de las mesas. Los tests lo bajan para ir más rápido. */
  tickMs?: number;
  /** Mínimo entre mensajes de chat por socket. */
  chatIntervalMs?: number;
}

export interface PukerServer {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  manager: RoomManager;
  /** Arranca y resuelve con el puerto real (útil con puerto 0 en tests). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  servingClient: boolean;
}

export function createPukerServer(options: PukerServerOptions = {}): PukerServer {
  const tickMs = options.tickMs ?? TICK_MS;
  const chatIntervalMs = options.chatIntervalMs ?? CHAT_MIN_INTERVAL_MS;
  const clientDist =
    options.clientDist === false ? null : (options.clientDist ?? defaultClientDist);

  const manager = new RoomManager();
  const app = express();
  const httpServer = createServer(app);

  app.use(compression());
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: manager.size, uptime: Math.round(process.uptime()) });
  });

  /** El cliente lo usa para avisar "esa sala no existe" antes de intentar entrar. */
  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = manager.get(code);
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      code,
      players: room.table.occupiedCount,
      maxSeats: room.table.settings.maxSeats,
      running: room.table.running,
    });
  });

  const servingClient = clientDist !== null && existsSync(clientDist);

  if (servingClient && clientDist) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    // SPA: cualquier ruta que no sea API devuelve el index.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(join(clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('Servidor de Puker en marcha. En desarrollo abrí el cliente en http://localhost:5173');
    });
  }

  const io: PukerServer['io'] = new Server(httpServer, {
    cors: {
      // En dev el cliente entra por el proxy de Vite, pero dejamos CORS
      // abierto para poder probar desde el celular por IP de la red local.
      origin: true,
      credentials: true,
    },
    pingTimeout: 25_000,
    pingInterval: 10_000,
  });

  const roomKey = (code: string): string => `room:${code}`;

  /** Manda a cada socket de la sala su propia vista del estado. */
  function broadcast(code: string): void {
    const room = manager.get(code);
    if (!room) return;

    const sockets = io.sockets.adapter.rooms.get(roomKey(code));
    const pending: LogEntry[] = room.table.drainLog();

    if (sockets) {
      for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId) as AppSocket | undefined;
        const playerId = socket?.data.playerId;
        if (!socket || !playerId) continue;
        socket.emit('state', room.table.getStateFor(playerId));
      }
    }

    if (pending.length) io.to(roomKey(code)).emit('log', pending);
  }

  /** Resuelve la sala y el jugador de un socket, o lanza. */
  function contextOf(socket: AppSocket): { room: Room; playerId: string; code: string } {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!code || !playerId) throw new Error('Todavía no entraste a ninguna sala');
    const room = manager.get(code);
    if (!room) throw new Error('La sala ya no existe');
    return { room, playerId, code };
  }

  function attach(socket: AppSocket, room: Room, playerId: string, token: string): void {
    // Si el socket venía de otra sala, la deja primero.
    if (socket.data.roomCode && socket.data.roomCode !== room.table.code) {
      socket.leave(roomKey(socket.data.roomCode));
    }

    socket.data.token = token;
    socket.data.playerId = playerId;
    socket.data.roomCode = room.table.code;
    socket.join(roomKey(room.table.code));

    room.table.setConnected(playerId, true);
    room.lastActivityAt = Date.now();

    // Al entrar o reconectar, el historial para no arrancar con la pantalla vacía.
    const history = room.table.recentLog();
    if (history.length) socket.emit('log', history);
    for (const message of room.chat.slice(-20)) socket.emit('chat', message);
    socket.emit('state', room.table.getStateFor(playerId));
  }

  function nameOf(room: Room, playerId: string, socket: AppSocket): string {
    const seat = room.table.seatOf(playerId);
    if (seat) return seat.name;
    const token = socket.data.token;
    const session = token ? manager.sessionByToken(token) : undefined;
    return sanitizeName(session?.name ?? 'Jugador') || 'Jugador';
  }

  io.on('connection', (socket: AppSocket) => {
    socket.on('room:create', (payload, ack) => {
      try {
        const outcome = manager.create(payload?.name ?? '', payload?.settings);
        attach(socket, outcome.room, outcome.session.playerId, outcome.session.token);
        ack(
          ok({
            code: outcome.room.table.code,
            playerId: outcome.session.playerId,
            token: outcome.session.token,
          }),
        );
        broadcast(outcome.room.table.code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('room:join', (payload, ack) => {
      try {
        const outcome = manager.join(payload?.code ?? '', payload?.name ?? '', payload?.token);
        const code = outcome.room.table.code;
        attach(socket, outcome.room, outcome.session.playerId, outcome.session.token);

        ack(ok({ code, playerId: outcome.session.playerId, token: outcome.session.token }));

        if (!outcome.seated) {
          socket.emit('toast', {
            kind: 'info',
            text: 'La mesa está llena. Entrás como espectador y te sentás cuando se libere un lugar.',
          });
        }
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:take', (payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        const seat = Math.floor(Number(payload?.seat));
        if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) {
          throw new Error('Asiento inválido');
        }
        if (room.table.findSeat(playerId) === null) {
          room.table.sit(playerId, nameOf(room, playerId, socket), seat);
        } else {
          room.table.moveSeat(playerId, seat);
        }
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:leave', (_payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.leave(playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:sitout', (payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.setSittingOut(playerId, Boolean(payload?.sitOut));
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:start', (_payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.start(playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:pause', (_payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.pause(playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:action', (payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.act(playerId, normalizeAction(payload));
        room.lastActivityAt = Date.now();
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('player:rebuy', (_payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        room.table.rebuy(playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('settings:update', (payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        if (room.table.hostId && room.table.hostId !== playerId) {
          throw new Error('Solo el anfitrión puede cambiar las reglas');
        }
        room.table.updateSettings(payload ?? {});
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('chat:send', (payload, ack) => {
      try {
        const { room, playerId, code } = contextOf(socket);
        const now = Date.now();
        if (now - (socket.data.lastChatAt ?? 0) < chatIntervalMs) {
          throw new Error('Esperá un segundo antes de volver a escribir');
        }
        socket.data.lastChatAt = now;

        const message = manager.addChat(room, nameOf(room, playerId, socket), payload?.text ?? '');
        if (message) io.to(roomKey(code)).emit('chat', message);
        ack(ok(undefined));
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('disconnect', () => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return;
      const room = manager.get(code);
      if (!room) return;

      // ¿Le queda otra pestaña abierta? Entonces sigue conectado.
      const stillHere = [...(io.sockets.adapter.rooms.get(roomKey(code)) ?? [])].some((id) => {
        const other = io.sockets.sockets.get(id) as AppSocket | undefined;
        return other && other.id !== socket.id && other.data.playerId === playerId;
      });
      if (stillHere) return;

      room.table.setConnected(playerId, false);
      broadcast(code);
    });
  });

  // Reloj global: un solo intervalo mueve todas las mesas.
  const tickTimer = setInterval(() => {
    for (const code of manager.listCodes()) {
      const room = manager.get(code);
      if (!room) continue;
      try {
        if (room.table.tick()) broadcast(code);
      } catch (error) {
        console.error(`[${code}] error en el tick:`, error);
      }
    }
  }, tickMs);

  const cleanupTimer = setInterval(() => {
    const removed = manager.cleanup();
    if (removed.length) console.log(`Salas cerradas por inactividad: ${removed.join(', ')}`);
  }, CLEANUP_MS);

  // Los timers no deben mantener el proceso vivo por sí solos.
  tickTimer.unref?.();
  cleanupTimer.unref?.();

  return {
    httpServer,
    io,
    manager,
    servingClient,

    listen(port, host = '0.0.0.0') {
      return new Promise<number>((resolvePort, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener('error', reject);
          const address = httpServer.address() as AddressInfo | null;
          resolvePort(address?.port ?? port);
        });
      });
    },

    async close() {
      clearInterval(tickTimer);
      clearInterval(cleanupTimer);
      await io.close();
      await new Promise<void>((done) => {
        if (!httpServer.listening) return done();
        httpServer.close(() => done());
      });
    },
  };
}

function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

function fail(error: unknown): Ack<never> {
  const message = error instanceof Error ? error.message : 'Error inesperado';
  return { ok: false, error: message };
}

/** Valida y normaliza lo que llega del cliente antes de tocar el juego. */
export function normalizeAction(raw: unknown): PlayerAction {
  const action = raw as { type?: unknown; amount?: unknown } | null;
  const type = String(action?.type ?? '');
  switch (type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'allin':
      return { type } as PlayerAction;
    case 'bet':
    case 'raise': {
      const amount = Math.floor(Number(action?.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Monto inválido');
      return { type, amount } as PlayerAction;
    }
    default:
      throw new Error('Acción desconocida');
  }
}
