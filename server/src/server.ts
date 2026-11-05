/**
 * Servidor HTTP + Socket.IO.
 *
 * En producción también sirve el build del cliente, así todo el proyecto es un
 * único proceso de Node.
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
  type RecordedBoard,
  type GameState,
  type TournamentResult,
  type ClientToServerEvents,
  type IceConfig,
  type LogEntry,
  type PlayerAction,
  type RankingEntry,
  type ServerToClientEvents,
  type VoicePeer,
  MAX_SEATS,
} from '@puker/shared';

import { createAuthRouter } from './auth/routes.js';
import { userFromCookieHeader, userFromRequest } from './auth/sessions.js';
import { config } from './config.js';
import { Store, type UserRow } from './db/store.js';
import { RoomManager, identityOf, normalizeCode, type PlayerIdentity, type Room } from './rooms.js';
import { VoiceRooms, buildIceConfig } from './voice.js';

const TICK_MS = 400;
const CHAT_MIN_INTERVAL_MS = 700;
const CLEANUP_MS = 5 * 60 * 1000;

const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDist = resolve(here, '../../client/dist');

/**
 * Único origen que se acepta en el websocket, o null para no restringir.
 *
 * Solo se fija si estamos en producción Y la URL pública es de verdad: una URL
 * de desarrollo acá significa que falta configurarla, y restringir con ella
 * dejaría la aplicación inutilizable.
 */
export const pinnedOrigin: string[] | null =
  config.isProduction && !/^https?:\/\/localhost(:|\/|$)/.test(config.publicUrl)
    ? [config.publicUrl]
    : null;

interface SocketData {
  user?: UserRow;
  player?: PlayerIdentity;
  roomCode?: string;
  lastChatAt?: number;
  /** Cuándo entró al audio por esta conexión. Ver `voice:signal`. */
  voiceJoinedAt?: number;
}

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface PukerServerOptions {
  clientDist?: string | false;
  tickMs?: number;
  chatIntervalMs?: number;
  /** Ruta de la base. Los tests usan `:memory:`. */
  databaseFile?: string;
}

export interface PukerServer {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  manager: RoomManager;
  store: Store;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  servingClient: boolean;
}

export function createPukerServer(options: PukerServerOptions = {}): PukerServer {
  const tickMs = options.tickMs ?? TICK_MS;
  const chatIntervalMs = options.chatIntervalMs ?? CHAT_MIN_INTERVAL_MS;
  const clientDist =
    options.clientDist === false ? null : (options.clientDist ?? defaultClientDist);

  const store = new Store(options.databaseFile ?? config.databaseFile);
  const manager = new RoomManager();
  const voice = new VoiceRooms();
  manager.onTournamentChange = (record) => store.saveTournament(record);

  // Cada mano terminada se guarda para el ranking. Solo cuentan los jugadores
  // con cuenta: los asientos sin userId se ignoran.
  manager.onHandComplete = (record) => {
    try {
      store.recordHand(
        record.players
          .filter((player) => player.userId !== null)
          .map((player) => ({
            userId: player.userId!,
            roomCode: record.roomCode,
            handNumber: record.handNumber,
            netChips: player.netChips,
            won: player.won > 0,
            potSize: record.potSize,
            handLabel: player.handLabel,
            playedAt: record.playedAt,
          })),
      );
    } catch (error) {
      console.error('No se pudo guardar el resultado de la mano:', error);
    }

    // Las cartas de la mesa van aparte: no dependen de que haya cuentas, y
    // sirven para contar cada cuánto viene emparejado el flop de verdad.
    try {
      store.recordBoard({
        roomCode: record.roomCode,
        handNumber: record.handNumber,
        board: record.board,
        playedAt: record.playedAt,
      });
    } catch (error) {
      console.error('No se pudo guardar el board de la mano:', error);
    }
  };

  const app = express();
  const httpServer = createServer(app);

  app.set('trust proxy', 1); // detrás de Caddy/nginx, para que req.ip sea real
  app.use(compression());
  app.use('/api/auth/profile', express.json({ limit: '300kb' }));
  app.use(express.json({ limit: '16kb' }));
  app.disable('x-powered-by');

  app.use('/api/auth', createAuthRouter(store, (user) => {
    const player = identityOf(user);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.user?.id === user.id) {
        socket.data.user = user;
        socket.data.player = player;
      }
    }
    for (const code of manager.listCodes()) {
      const room = manager.get(code)!;
      room.table.updatePlayerName(player.playerId, player.name);
      broadcast(code);
    }
  }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: manager.size,
      users: store.countUsers(),
      uptime: Math.round(process.uptime()),
    });
  });

  app.get('/api/ranking', (_req, res) => {
    const rows: RankingEntry[] = store.ranking(100);
    res.json({ ranking: rows });
  });

  /**
   * El historial crudo de las manos: solo las cartas que salieron a la mesa,
   * sin cuentas ni porcentajes. La idea es bajarlo y analizarlo afuera.
   * Con ?format=csv sale listo para abrir en una planilla.
   */
  app.get('/api/stats/boards', (req, res) => {
    const user = userFromRequest(req, store);
    if (!user) { res.status(401).json({ error: 'Necesitás iniciar sesión' }); return; }

    const rows: RecordedBoard[] = store.boards().map((row) => ({
      roomCode: row.roomCode,
      handNumber: row.handNumber,
      board: row.board,
      playedAt: row.playedAt,
    }));

    if (req.query.format === 'csv') {
      const lineas = ['fecha,sala,mano,c1,c2,c3,c4,c5'];
      for (const row of rows) {
        const cartas = [0, 1, 2, 3, 4].map((i) => row.board[i] ?? '');
        lineas.push([new Date(row.playedAt).toISOString(), row.roomCode, row.handNumber, ...cartas].join(','));
      }
      // CRLF: es lo que esperan Excel y Google Sheets al abrir un CSV.
      res.type('text/csv; charset=utf-8').send(lineas.join('\r\n'));
      return;
    }

    res.json({ boards: rows });
  });

  app.get('/api/tournaments', (req, res) => {
    const user = userFromRequest(req, store);
    if (!user) { res.status(401).json({ error: 'Necesitás iniciar sesión' }); return; }
    const profiles = profileReader();
    res.json({ tournaments: store.tournamentsFor(user.id).map(({ userIds, ...record }) => ({
      ...record, result: record.result ? withResultProfiles(record.result, profiles) : null,
    })) });
  });

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
    // En producción el cliente se sirve desde el mismo origen, así que solo se
    // acepta ese. En desarrollo el cliente vive en otro puerto (Vite) y los
    // tests se conectan desde Node, donde no hay origen que validar.
    //
    // Si en producción quedó la URL de desarrollo, no se restringe nada: con el
    // origen mal puesto el navegador no se conecta a ninguna mesa y la pantalla
    // se queda en "Reconectando" sin decir por qué. Es peor que no restringir.
    cors: { origin: pinnedOrigin ?? true, credentials: true },
    pingTimeout: 25_000,
    pingInterval: 10_000,
  });

  /**
   * Identidad del socket: sale de la misma cookie de sesión del navegador.
   * Sin cuenta no se puede jugar, así que la conexión se rechaza de entrada.
   */
  io.use((socket, next) => {
    const user = userFromCookieHeader(socket.handshake.headers.cookie, store);
    if (!user) {
      next(new Error('Necesitás iniciar sesión'));
      return;
    }
    (socket as AppSocket).data.user = user;
    (socket as AppSocket).data.player = identityOf(user);
    next();
  });

  const roomKey = (code: string): string => `room:${code}`;

  // Las cuentas monetarias son históricas; la foto y el alias se leen del perfil actual.
  function profileReader() {
    const cache = new Map<string, { avatarUrl: string | null; transferAlias: string | null }>();
    return (id: string) => {
      if (!cache.has(id)) {
        const user = /^u\d+$/.test(id) ? store.findUserById(Number(id.slice(1))) : null;
        cache.set(id, { avatarUrl: user?.avatar_url ?? null, transferAlias: user?.transfer_alias ?? null });
      }
      return cache.get(id)!;
    };
  }

  function withResultProfiles(result: TournamentResult, profiles: ReturnType<typeof profileReader>) {
    return { ...result, players: result.players.map((p) => ({ ...p, ...profiles(p.id) })) };
  }

  function withProfiles(state: GameState, profiles = profileReader()): GameState {
    return {
      ...state,
      players: state.players.map((p) => ({ ...p, avatarUrl: profiles(p.id).avatarUrl })),
      tournament: state.tournament ? {
        ...state.tournament,
        participants: state.tournament.participants.map((p) => ({ ...p, ...profiles(p.id) })),
        result: state.tournament.result ? withResultProfiles(state.tournament.result, profiles) : null,
      } : null,
    };
  }

  function broadcast(code: string): void {
    const room = manager.get(code);
    if (!room) return;

    const sockets = io.sockets.adapter.rooms.get(roomKey(code));
    const pending: LogEntry[] = room.table.drainLog();
    const profiles = profileReader();

    if (sockets) {
      for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId) as AppSocket | undefined;
        const playerId = socket?.data.player?.playerId;
        if (!socket || !playerId) continue;
        socket.emit('state', withProfiles(room.table.getStateFor(playerId), profiles));
      }
    }

    if (pending.length) io.to(roomKey(code)).emit('log', pending);
  }

  function contextOf(socket: AppSocket): { room: Room; player: PlayerIdentity; code: string } {
    const code = socket.data.roomCode;
    const player = socket.data.player;
    if (!code || !player) throw new Error('Todavía no entraste a ninguna sala');
    const room = manager.get(code);
    if (!room) throw new Error('La sala ya no existe');
    return { room, player, code };
  }

  function attach(socket: AppSocket, room: Room, player: PlayerIdentity): void {
    if (socket.data.roomCode && socket.data.roomCode !== room.table.code) {
      leaveVoice(socket);
      socket.leave(roomKey(socket.data.roomCode));
    }

    socket.data.roomCode = room.table.code;
    socket.join(roomKey(room.table.code));

    room.table.setConnected(player.playerId, true);
    room.lastActivityAt = Date.now();

    const history = room.table.recentLog();
    if (history.length) socket.emit('log', history);
    for (const message of room.chat.slice(-20)) socket.emit('chat', message);
    socket.emit('state', withProfiles(room.table.getStateFor(player.playerId)));
  }

  /** Saca al socket de la conversación de voz y avisa a los demás. */
  function leaveVoice(socket: AppSocket): void {
    const code = socket.data.roomCode;
    const playerId = socket.data.player?.playerId;
    if (!code || !playerId) return;
    if (!voice.has(code, playerId)) return;
    voice.leave(code, playerId);
    socket.to(roomKey(code)).emit('voice:peer-left', { playerId });
  }

  io.on('connection', (socket: AppSocket) => {
    socket.on('room:create', (payload, ack) => {
      try {
        const player = socket.data.player!;
        const outcome = manager.create(player, payload?.settings);
        attach(socket, outcome.room, player);
        ack(ok({ code: outcome.room.table.code, playerId: player.playerId, seated: true }));
        broadcast(outcome.room.table.code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('room:join', (payload, ack) => {
      try {
        const player = socket.data.player!;
        const outcome = manager.join(payload?.code ?? '', player);
        const code = outcome.room.table.code;
        attach(socket, outcome.room, player);

        ack(ok({ code, playerId: player.playerId, seated: outcome.seated }));

        if (!outcome.seated) {
          socket.emit('toast', {
            kind: 'info',
            text: 'Entrás como espectador: no hay asiento disponible o la inscripción ya está cerrada.',
          });
        }
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:take', (payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        const seat = Math.floor(Number(payload?.seat));
        if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) {
          throw new Error('Asiento inválido');
        }
        if (room.table.findSeat(player.playerId) === null) {
          room.table.sit(player.playerId, player.name, seat, player.userId);
        } else {
          room.table.moveSeat(player.playerId, seat);
        }
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:leave', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.leave(player.playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('seat:sitout', (payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.setSittingOut(player.playerId, Boolean(payload?.sitOut));
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:start', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.start(player.playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:pause', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.pause(player.playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('game:action', (payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.act(player.playerId, normalizeAction(payload));
        room.lastActivityAt = Date.now();
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('player:rebuy', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.rebuy(player.playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('player:withdraw', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        room.table.withdraw(player.playerId);
        ack(ok(undefined));
        broadcast(code);
      } catch (error) { ack(fail(error)); }
    });

    socket.on('settings:update', (payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);
        if (room.table.hostId && room.table.hostId !== player.playerId) {
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
        const { room, player, code } = contextOf(socket);
        const now = Date.now();
        if (now - (socket.data.lastChatAt ?? 0) < chatIntervalMs) {
          throw new Error('Esperá un segundo antes de volver a escribir');
        }
        socket.data.lastChatAt = now;

        const message = manager.addChat(room, player.name, payload?.text ?? '');
        if (message) io.to(roomKey(code)).emit('chat', message);
        ack(ok(undefined));
      } catch (error) {
        ack(fail(error));
      }
    });

    // ------------------------------------------------------------- voz

    socket.on('voice:config', (_payload, ack) => {
      try {
        const player = socket.data.player!;
        const iceConfig: IceConfig = buildIceConfig(player.playerId);
        ack(ok(iceConfig));
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('voice:join', (_payload, ack) => {
      try {
        const { room, player, code } = contextOf(socket);

        const peers: VoicePeer[] = voice
          .members(code)
          .filter((id) => id !== player.playerId)
          .map((id) => {
            const seat = room.table.seatOf(id);
            return { playerId: id, name: seat?.name ?? 'Jugador', seat: room.table.findSeat(id) };
          });

        voice.join(code, player.playerId);
        socket.data.voiceJoinedAt = Date.now();
        socket.to(roomKey(code)).emit('voice:peer-joined', {
          playerId: player.playerId,
          name: player.name,
          seat: room.table.findSeat(player.playerId),
        });

        ack(ok(peers));
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('voice:leave', (_payload, ack) => {
      try {
        leaveVoice(socket);
        ack(ok(undefined));
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('voice:signal', (payload, ack) => {
      try {
        const { code, player } = contextOf(socket);
        const to = String(payload?.to ?? '');
        if (!to) throw new Error('Falta el destinatario');
        if (to === player.playerId) throw new Error('No podés señalizarte a vos mismo');
        // Solo se reenvía dentro de la misma sala y entre quienes activaron voz.
        if (!voice.has(code, to) || !voice.has(code, player.playerId)) {
          throw new Error('Ese jugador no está en la conversación');
        }

        // A una sola conexión, la última que entró al audio. Con la web abierta
        // en dos lugares, las dos contestaban la misma oferta: la negociación
        // se enredaba y el que hablaba se escuchaba a sí mismo con retardo.
        let target: AppSocket | undefined;
        for (const socketId of io.sockets.adapter.rooms.get(roomKey(code)) ?? []) {
          const other = io.sockets.sockets.get(socketId) as AppSocket | undefined;
          if (other?.data.player?.playerId !== to) continue;
          if (!target || (other.data.voiceJoinedAt ?? 0) >= (target.data.voiceJoinedAt ?? 0)) {
            target = other;
          }
        }
        target?.emit('voice:signal', { from: player.playerId, data: payload.data });
        ack(ok(undefined));
      } catch (error) {
        ack(fail(error));
      }
    });

    socket.on('disconnect', () => {
      const code = socket.data.roomCode;
      const playerId = socket.data.player?.playerId;
      if (!code || !playerId) return;
      const room = manager.get(code);
      if (!room) return;

      // ¿Le queda otra pestaña abierta? Entonces sigue conectado.
      const stillHere = [...(io.sockets.adapter.rooms.get(roomKey(code)) ?? [])].some((id) => {
        const other = io.sockets.sockets.get(id) as AppSocket | undefined;
        return other && other.id !== socket.id && other.data.player?.playerId === playerId;
      });
      if (stillHere) return;

      leaveVoice(socket);
      room.table.setConnected(playerId, false);
      broadcast(code);
    });
  });

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
    const sessions = store.deleteExpiredSessions();
    if (sessions > 0) console.log(`Sesiones vencidas borradas: ${sessions}`);
  }, CLEANUP_MS);

  tickTimer.unref?.();
  cleanupTimer.unref?.();

  return {
    httpServer,
    io,
    manager,
    store,
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
      store.close();
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
