/**
 * Tests de integración sobre el stack real: HTTP + cuentas + Socket.IO + motor.
 *
 * Levantan un servidor con base en memoria y lo manejan con clientes de
 * socket.io de verdad, autenticados por cookie igual que el navegador.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Socket, io } from 'socket.io-client';

import type { Ack, AuthInfo, GameState, JoinResult, PlayerAction, RankingEntry } from '@puker/shared';

import { createPukerServer, type PukerServer } from '../server.js';

const TIMEOUT = 8000;

interface AckEmitter {
  emit(event: string, payload: unknown, ack: (res: Ack<unknown>) => void): void;
}

/** Cliente de prueba: una cuenta + su socket, con el último estado recibido. */
class TestClient {
  socket: Socket | null = null;
  state: GameState | null = null;
  cookie = '';
  username = '';
  private waiters: { predicate: (s: GameState) => boolean; resolve: (s: GameState) => void }[] = [];

  constructor(readonly port: number) {}

  private url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  /** Crea la cuenta y guarda la cookie de sesión que devuelve el servidor. */
  async register(username: string, password = 'unaClaveLarga123'): Promise<void> {
    const response = await fetch(this.url('/api/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, displayName: username, password }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `register falló (${response.status})`);
    this.cookie = extractCookie(response);
    this.username = username;
  }

  async login(username: string, password: string): Promise<Response> {
    const response = await fetch(this.url('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) {
      this.cookie = extractCookie(response);
      this.username = username;
    }
    return response;
  }

  async me(): Promise<AuthInfo> {
    const response = await fetch(this.url('/api/auth/me'), { headers: { cookie: this.cookie } });
    return (await response.json()) as AuthInfo;
  }

  /** Abre el socket mandando la cookie en el handshake. */
  connect(): Promise<void> {
    const socket = io(`http://127.0.0.1:${this.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: this.cookie ? { Cookie: this.cookie } : {},
    });
    this.socket = socket;

    socket.on('state', (next: GameState) => {
      this.state = next;
      const pending = this.waiters;
      this.waiters = [];
      for (const waiter of pending) {
        if (waiter.predicate(next)) waiter.resolve(next);
        else this.waiters.push(waiter);
      }
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout conectando')), TIMEOUT);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  request<T>(event: string, payload: unknown = {}): Promise<T> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('socket sin conectar'));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout en ${event}`)), TIMEOUT);
      (socket as unknown as AckEmitter).emit(event, payload, (res) => {
        clearTimeout(timer);
        if (res && res.ok) resolve(res.data as T);
        else reject(new Error(res?.ok === false ? res.error : 'error desconocido'));
      });
    });
  }

  waitFor(predicate: (state: GameState) => boolean, label = 'estado'): Promise<GameState> {
    if (this.state && predicate(this.state)) return Promise.resolve(this.state);
    return new Promise<GameState>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${label}`)), TIMEOUT);
      this.waiters.push({
        predicate,
        resolve: (state) => {
          clearTimeout(timer);
          resolve(state);
        },
      });
    });
  }

  close(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }
}

function extractCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const session = raw.find((entry) => entry.startsWith('puker_session='));
  if (!session) throw new Error('el servidor no mandó la cookie de sesión');
  return session.split(';')[0]!;
}

interface Ctx {
  port: number;
  server: PukerServer;
  clients: TestClient[];
}

async function withServer(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const server = createPukerServer({
    clientDist: false,
    tickMs: 40,
    chatIntervalMs: 0,
    databaseFile: ':memory:',
  });
  const port = await server.listen(0, '127.0.0.1');
  const ctx: Ctx = { port, server, clients: [] };

  try {
    await run(ctx);
  } finally {
    for (const client of ctx.clients) client.close();
    await server.close();
  }
}

/** Registra una cuenta y conecta el socket, que es el caso normal. */
async function newPlayer(ctx: Ctx, username: string): Promise<TestClient> {
  const client = new TestClient(ctx.port);
  ctx.clients.push(client);
  await client.register(username);
  await client.connect();
  return client;
}

// ------------------------------------------------------------------ cuentas

test('registro, sesión y logout', async () => {
  await withServer(async (ctx) => {
    const client = new TestClient(ctx.port);
    ctx.clients.push(client);

    const anonimo = await client.me();
    assert.equal(anonimo.user, null, 'sin cookie no hay usuario');

    await client.register('marcos');
    const conSesion = await client.me();
    assert.equal(conSesion.user?.username, 'marcos');
    assert.equal(conSesion.user?.hasPassword, true);
    assert.equal(conSesion.user?.hasGoogle, false);

    await fetch(`http://127.0.0.1:${ctx.port}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: client.cookie },
    });
    const despues = await client.me();
    assert.equal(despues.user, null, 'la sesión quedó cerrada');
  });
});

test('el usuario y la contraseña se validan', async () => {
  await withServer(async (ctx) => {
    const client = new TestClient(ctx.port);
    ctx.clients.push(client);

    await assert.rejects(() => client.register('ma'), /al menos 3/i);
    await assert.rejects(() => client.register('1marcos'), /empez/i);
    await assert.rejects(() => client.register('marcos', 'corta'), /al menos 8/i);
    await assert.rejects(() => client.register('marcos', 'password'), /más usadas/i);
  });
});

test('no se puede repetir un nombre de usuario, ni con otras mayúsculas', async () => {
  await withServer(async (ctx) => {
    const a = new TestClient(ctx.port);
    const b = new TestClient(ctx.port);
    ctx.clients.push(a, b);

    await a.register('marcos');
    await assert.rejects(() => b.register('MARCOS'), /ya está tomado/i);
  });
});

test('el login rechaza la contraseña incorrecta y acepta la correcta', async () => {
  await withServer(async (ctx) => {
    const client = new TestClient(ctx.port);
    ctx.clients.push(client);
    await client.register('marcos', 'miClaveSegura1');

    const mal = await client.login('marcos', 'otraCosa123');
    assert.equal(mal.status, 401);

    const inexistente = await client.login('nadie', 'loquesea123');
    assert.equal(inexistente.status, 401, 'no revela si el usuario existe');

    const bien = await client.login('marcos', 'miClaveSegura1');
    assert.equal(bien.status, 200);
  });
});

test('un socket sin sesión no puede conectarse', async () => {
  await withServer(async (ctx) => {
    const client = new TestClient(ctx.port);
    ctx.clients.push(client);
    await assert.rejects(() => client.connect(), /sesión|session/i);
  });
});

// -------------------------------------------------------------------- juego

test('el endpoint de salud responde', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; rooms: number; users: number };
    assert.equal(body.ok, true);
    assert.equal(body.rooms, 0);
    assert.equal(body.users, 0);
  });
});

test('crear una sala, entrar con el código y jugar una mano completa', async () => {
  await withServer(async (ctx) => {
    const anfitrion = await newPlayer(ctx, 'marcos');

    const creada = await anfitrion.request<JoinResult>('room:create', {
      settings: { smallBlind: 10, bigBlind: 20, startingStack: 1000, maxSeats: 2, turnTimeSec: 120 },
    });
    assert.match(creada.code, /^[A-Z2-9]{4}$/);

    const info = await fetch(`http://127.0.0.1:${ctx.port}/api/rooms/${creada.code}`);
    assert.equal(info.status, 200);

    const invitado = await newPlayer(ctx, 'amigo');
    const unido = await invitado.request<JoinResult>('room:join', { code: creada.code });
    assert.equal(unido.code, creada.code);
    assert.equal(unido.seated, true);

    const antes = await anfitrion.waitFor((s) => s.players.length === 2, 'dos jugadores');
    assert.equal(antes.phase, 'waiting');

    await assert.rejects(() => invitado.request('game:start'), /anfitrión/i);

    await anfitrion.request('game:start');
    const manoEnJuego = await anfitrion.waitFor((s) => s.phase === 'preflop', 'preflop');
    assert.equal(manoEnJuego.handNumber, 1);

    const yo = manoEnJuego.players.find((p) => p.seat === manoEnJuego.youSeat)!;
    const rival = manoEnJuego.players.find((p) => p.seat !== manoEnJuego.youSeat)!;
    assert.equal(yo.cards.filter((c) => c !== null).length, 2, 'veo mis dos cartas');
    assert.equal(rival.cards.filter((c) => c !== null).length, 0, 'no veo las del rival');

    const total = () =>
      (anfitrion.state?.players ?? []).reduce((sum, p) => sum + p.chips + p.committed, 0);
    assert.equal(total(), 2000);

    for (let paso = 0; paso < 40; paso++) {
      const state = anfitrion.state;
      if (!state || state.phase === 'handover' || state.phase === 'waiting') break;

      const turno = state.turnSeat;
      if (turno === null) {
        await delay(30);
        continue;
      }

      const esMio = turno === state.youSeat;
      const client = esMio ? anfitrion : invitado;
      const legal = esMio ? state.legal : invitado.state?.legal;
      if (!legal) {
        await delay(30);
        continue;
      }

      await client.request('game:action', legal.canCheck ? { type: 'check' } : { type: 'call' });
    }

    const final = await anfitrion.waitFor((s) => s.phase === 'handover', 'fin de mano');
    assert.equal(final.board.length, 5);
    assert.equal(final.lastResult!.shown.length, 2);
    assert.equal(total(), 2000, 'las fichas totales no cambiaron');
  });
});

test('reconectar con la misma cuenta recupera el asiento y las fichas', async () => {
  await withServer(async (ctx) => {
    const anfitrion = await newPlayer(ctx, 'marcos');
    const creada = await anfitrion.request<JoinResult>('room:create', {
      settings: { maxSeats: 3, startingStack: 1500 },
    });

    const amigo = await newPlayer(ctx, 'amigo');
    const unido = await amigo.request<JoinResult>('room:join', { code: creada.code });

    const conDos = await anfitrion.waitFor((s) => s.players.length === 2, 'dos jugadores');
    const asientoOriginal = conDos.players.find((p) => p.id === unido.playerId)!.seat;

    amigo.close();
    await anfitrion.waitFor(
      (s) => s.players.some((p) => p.id === unido.playerId && !p.connected),
      'marcado como desconectado',
    );

    // Vuelve con la misma cookie: para el servidor es el mismo jugador.
    await amigo.connect();
    const resumido = await amigo.request<JoinResult>('room:join', { code: creada.code });
    assert.equal(resumido.playerId, unido.playerId, 'mismo jugador, no uno nuevo');

    const recuperado = await amigo.waitFor(
      (s) => s.youSeat !== null && s.players.every((p) => p.connected),
      'reconectado',
    );
    assert.equal(recuperado.youSeat, asientoOriginal, 'recuperó su asiento');
    assert.equal(recuperado.players.length, 2, 'no se duplicó el jugador');
    assert.equal(recuperado.players.find((p) => p.id === unido.playerId)!.chips, 1500);
  });
});

test('el servidor rechaza acciones ilegales y fuera de turno', async () => {
  await withServer(async (ctx) => {
    const a = await newPlayer(ctx, 'marcos');
    const sala = await a.request<JoinResult>('room:create', {
      settings: { maxSeats: 2, smallBlind: 10, bigBlind: 20, startingStack: 1000, turnTimeSec: 120 },
    });

    const b = await newPlayer(ctx, 'amigo');
    await b.request('room:join', { code: sala.code });

    await a.waitFor((s) => s.players.length === 2, 'dos jugadores');
    await a.request('game:start');
    const state = await a.waitFor((s) => s.phase === 'preflop', 'preflop');

    const leToca = state.turnSeat === state.youSeat ? a : b;
    const noLeToca = leToca === a ? b : a;

    await assert.rejects(() => noLeToca.request('game:action', { type: 'fold' }), /turno/i);
    await assert.rejects(() => leToca.request('game:action', { type: 'check' }), /igualar/i);
    await assert.rejects(
      () => leToca.request('game:action', { type: 'raise', amount: 1 }),
      /mínima|al menos/i,
    );
    await assert.rejects(() => leToca.request('game:action', { type: 'inventada' }), /desconocida/i);
  });
});

test('no se puede entrar a una sala con un código inventado', async () => {
  await withServer(async (ctx) => {
    const client = await newPlayer(ctx, 'marcos');
    await assert.rejects(() => client.request('room:join', { code: 'XXXX' }), /no existe/i);
  });
});

test('el chat llega a todos los de la sala', async () => {
  await withServer(async (ctx) => {
    const a = await newPlayer(ctx, 'marcos');
    const sala = await a.request<JoinResult>('room:create', {});

    const b = await newPlayer(ctx, 'amigo');
    await b.request('room:join', { code: sala.code });
    await b.waitFor((s) => s.players.length === 2, 'dos jugadores');

    const recibido = new Promise<{ from: string; text: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando el chat')), TIMEOUT);
      b.socket!.on('chat', (message: { from: string; text: string }) => {
        if (message.text === 'vamo arriba') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    await a.request('chat:send', { text: 'vamo arriba' });
    assert.equal((await recibido).from, 'marcos');
  });
});

test('la mesa llena deja entrar como espectador y después sentarse', async () => {
  await withServer(async (ctx) => {
    const a = await newPlayer(ctx, 'marcos');
    const sala = await a.request<JoinResult>('room:create', { settings: { maxSeats: 2 } });

    const b = await newPlayer(ctx, 'amigo');
    await b.request('room:join', { code: sala.code });

    const c = await newPlayer(ctx, 'tercero');
    const entrada = await c.request<JoinResult>('room:join', { code: sala.code });
    assert.equal(entrada.seated, false, 'la mesa estaba llena');

    const comoEspectador = await c.waitFor((s) => s.players.length === 2, 'mesa llena');
    assert.equal(comoEspectador.youSeat, null);

    await b.request('seat:leave');
    await c.waitFor((s) => s.players.length === 1, 'un lugar libre');
    await c.request('seat:take', { seat: 1 });

    assert.equal((await c.waitFor((s) => s.youSeat !== null, 'sentado')).youSeat, 1);
  });
});

// ------------------------------------------------------------------ ranking

test('el ranking acumula el resultado de las manos jugadas', async () => {
  await withServer(async (ctx) => {
    const a = await newPlayer(ctx, 'marcos');
    const sala = await a.request<JoinResult>('room:create', {
      settings: { maxSeats: 2, smallBlind: 10, bigBlind: 20, startingStack: 1000, turnTimeSec: 120 },
    });
    const b = await newPlayer(ctx, 'amigo');
    await b.request('room:join', { code: sala.code });
    await a.waitFor((s) => s.players.length === 2, 'dos jugadores');
    await a.request('game:start');
    await a.waitFor((s) => s.phase === 'preflop', 'preflop');

    for (let paso = 0; paso < 40; paso++) {
      const state = a.state;
      if (!state || state.phase === 'handover') break;
      if (state.turnSeat === null) {
        await delay(30);
        continue;
      }
      const esMio = state.turnSeat === state.youSeat;
      const client = esMio ? a : b;
      const legal = esMio ? state.legal : b.state?.legal;
      if (!legal) {
        await delay(30);
        continue;
      }
      await client.request('game:action', legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    await a.waitFor((s) => s.phase === 'handover', 'fin de mano');

    const response = await fetch(`http://127.0.0.1:${ctx.port}/api/ranking`);
    const { ranking } = (await response.json()) as { ranking: RankingEntry[] };

    assert.equal(ranking.length, 2, 'los dos jugadores aparecen');
    assert.ok(
      ranking.every((row) => row.hands === 1),
      'cada uno jugó una mano',
    );
    assert.equal(
      ranking.reduce((sum, row) => sum + row.net, 0),
      0,
      'lo que gana uno lo pierde el otro: el neto de la mesa es cero',
    );
    assert.equal(
      ranking.reduce((sum, row) => sum + row.wins, 0),
      1,
      'hubo exactamente un ganador',
    );
    assert.ok(ranking[0]!.net >= ranking[1]!.net, 'viene ordenado por fichas netas');
  });
});

test('quien se registra aparece en el ranking aunque no haya jugado', async () => {
  await withServer(async (ctx) => {
    const client = new TestClient(ctx.port);
    ctx.clients.push(client);
    await client.register('recienllegado');

    const response = await fetch(`http://127.0.0.1:${ctx.port}/api/ranking`);
    const { ranking } = (await response.json()) as { ranking: RankingEntry[] };
    assert.equal(ranking.length, 1);
    assert.equal(ranking[0]!.hands, 0);
    assert.equal(ranking[0]!.net, 0);
  });
});

// ---------------------------------------------------------------------- voz

test('la config de voz trae STUN y avisa si no hay TURN', async () => {
  await withServer(async (ctx) => {
    const client = await newPlayer(ctx, 'marcos');
    const iceConfig = await client.request<{ iceServers: unknown[]; hasTurn: boolean }>(
      'voice:config',
    );
    assert.ok(iceConfig.iceServers.length > 0, 'siempre hay al menos un STUN');
    assert.equal(typeof iceConfig.hasTurn, 'boolean');
  });
});

test('la señalización de voz solo viaja entre quienes activaron el micrófono', async () => {
  await withServer(async (ctx) => {
    const a = await newPlayer(ctx, 'marcos');
    const sala = await a.request<JoinResult>('room:create', { settings: { maxSeats: 4 } });
    const b = await newPlayer(ctx, 'amigo');
    await b.request('room:join', { code: sala.code });
    await a.waitFor((s) => s.players.length === 2, 'dos jugadores');

    // Nadie activó la voz todavía: el relay tiene que rechazar.
    await assert.rejects(
      () => a.request('voice:signal', { to: 'u2', data: { hola: true } }),
      /no está en la conversación/i,
    );

    const peersDeA = await a.request<{ playerId: string }[]>('voice:join');
    assert.deepEqual(peersDeA, [], 'es el primero, no hay nadie con quien hablar');

    // Cuando entra el segundo, el primero se entera.
    const avisoDeEntrada = new Promise<{ playerId: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando peer-joined')), TIMEOUT);
      a.socket!.on('voice:peer-joined', (peer: { playerId: string }) => {
        clearTimeout(timer);
        resolve(peer);
      });
    });

    const peersDeB = await b.request<{ playerId: string }[]>('voice:join');
    assert.equal(peersDeB.length, 1, 'el segundo ve al primero');
    assert.equal(peersDeB[0]!.playerId, a.state!.youId, 'y ese primero es el anfitrión');

    const entrada = await avisoDeEntrada;
    assert.equal(entrada.playerId, b.state!.youId, 'al anfitrión le avisan que entró el segundo');

    // Ahora sí, la señalización llega al destinatario correcto.
    const señal = new Promise<{ from: string; data: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando la señal')), TIMEOUT);
      b.socket!.on('voice:signal', (payload: { from: string; data: unknown }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    await a.request('voice:signal', { to: b.state!.youId, data: { tipo: 'offer' } });
    const recibida = await señal;
    assert.deepEqual(recibida.data, { tipo: 'offer' });
    assert.equal(recibida.from, a.state!.youId, 'y llega identificada como del anfitrión');

    // Mandarse una señal a uno mismo no tiene sentido y se rechaza.
    await assert.rejects(
      () => a.request('voice:signal', { to: a.state!.youId, data: {} }),
      /vos mismo/i,
    );

    // Al irse, el otro se entera.
    const avisoDeSalida = new Promise<{ playerId: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando peer-left')), TIMEOUT);
      b.socket!.on('voice:peer-left', (payload: { playerId: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    await a.request('voice:leave');
    await avisoDeSalida;
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
