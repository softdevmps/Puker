/**
 * Tests de integración sobre el stack real: HTTP + Socket.IO + motor.
 *
 * Levantan un servidor en un puerto libre y lo manejan con clientes de
 * socket.io de verdad, igual que el navegador.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Socket, io } from 'socket.io-client';

import type { Ack, GameState, JoinResult, PlayerAction } from '@puker/shared';

import { createPukerServer, type PukerServer } from '../server.js';

const TIMEOUT = 5000;

interface AckEmitter {
  emit(event: string, payload: unknown, ack: (res: Ack<unknown>) => void): void;
}

/** Cliente de prueba: guarda el último estado recibido y permite esperar. */
class TestClient {
  readonly socket: Socket;
  state: GameState | null = null;
  private waiters: { predicate: (s: GameState) => boolean; resolve: (s: GameState) => void }[] = [];

  constructor(port: number) {
    this.socket = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    this.socket.on('state', (next: GameState) => {
      this.state = next;
      const pending = this.waiters;
      this.waiters = [];
      for (const waiter of pending) {
        if (waiter.predicate(next)) waiter.resolve(next);
        else this.waiters.push(waiter);
      }
    });
  }

  connected(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout conectando')), TIMEOUT);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  request<T>(event: string, payload: unknown = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout en ${event}`)), TIMEOUT);
      (this.socket as unknown as AckEmitter).emit(event, payload, (res) => {
        clearTimeout(timer);
        if (res && res.ok) resolve(res.data as T);
        else reject(new Error(res?.ok === false ? res.error : 'error desconocido'));
      });
    });
  }

  /** Espera un estado que cumpla la condición (o el actual, si ya la cumple). */
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
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

async function withServer(
  run: (ctx: { port: number; server: PukerServer; clients: TestClient[] }) => Promise<void>,
): Promise<void> {
  const server = createPukerServer({ clientDist: false, tickMs: 50, chatIntervalMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  const clients: TestClient[] = [];

  try {
    await run({ port, server, clients });
  } finally {
    for (const client of clients) client.close();
    await server.close();
  }
}

function makeClient(ctx: { port: number; clients: TestClient[] }): TestClient {
  const client = new TestClient(ctx.port);
  ctx.clients.push(client);
  return client;
}

test('el endpoint de salud responde', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; rooms: number };
    assert.equal(body.ok, true);
    assert.equal(body.rooms, 0);
  });
});

test('una sala inexistente devuelve 404', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms/ZZZZ`);
    assert.equal(response.status, 404);
  });
});

test('crear una sala, entrar con el código y jugar una mano completa', async () => {
  await withServer(async (ctx) => {
    const anfitrion = makeClient(ctx);
    await anfitrion.connected();

    const creada = await anfitrion.request<JoinResult>('room:create', {
      name: 'Marcos',
      settings: { smallBlind: 10, bigBlind: 20, startingStack: 1000, maxSeats: 2, turnTimeSec: 120 },
    });
    assert.match(creada.code, /^[A-Z2-9]{4}$/);

    // La sala aparece en el endpoint público.
    const info = await fetch(`http://127.0.0.1:${ctx.port}/api/rooms/${creada.code}`);
    assert.equal(info.status, 200);

    const invitado = makeClient(ctx);
    await invitado.connected();
    const unido = await invitado.request<JoinResult>('room:join', {
      code: creada.code,
      name: 'Amigo',
    });
    assert.equal(unido.code, creada.code);

    const antes = await anfitrion.waitFor((s) => s.players.length === 2, 'dos jugadores');
    assert.equal(antes.phase, 'waiting');
    assert.equal(antes.hostId, creada.playerId);

    // Solo el anfitrión puede arrancar.
    await assert.rejects(() => invitado.request('game:start'), /anfitrión/i);

    await anfitrion.request('game:start');
    const manoEnJuego = await anfitrion.waitFor((s) => s.phase === 'preflop', 'preflop');
    assert.equal(manoEnJuego.handNumber, 1);

    // Cada uno ve sus dos cartas y las del otro tapadas.
    const yo = manoEnJuego.players.find((p) => p.seat === manoEnJuego.youSeat)!;
    const rival = manoEnJuego.players.find((p) => p.seat !== manoEnJuego.youSeat)!;
    assert.equal(yo.cards.filter((c) => c !== null).length, 2, 'veo mis dos cartas');
    assert.equal(rival.cards.filter((c) => c !== null).length, 0, 'no veo las del rival');

    // Jugamos la mano pasando/igualando hasta que termine.
    const total = () =>
      (anfitrion.state?.players ?? []).reduce((sum, p) => sum + p.chips + p.committed, 0);
    const fichasIniciales = 2000;
    assert.equal(total(), fichasIniciales);

    for (let paso = 0; paso < 40; paso++) {
      const state = anfitrion.state;
      if (!state || state.phase === 'handover' || state.phase === 'waiting') break;

      const turno = state.turnSeat;
      if (turno === null) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }

      const esMio = turno === state.youSeat;
      const client = esMio ? anfitrion : invitado;
      const legal = esMio ? state.legal : invitado.state?.legal;
      if (!legal) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }

      const action: PlayerAction = legal.canCheck ? { type: 'check' } : { type: 'call' };
      await client.request('game:action', action);
    }

    const final = await anfitrion.waitFor((s) => s.phase === 'handover', 'fin de mano');
    assert.equal(final.board.length, 5, 'se repartieron las cinco comunitarias');
    assert.ok(final.lastResult, 'hay resultado de la mano');
    assert.equal(final.lastResult!.shown.length, 2, 'ambos mostraron cartas');
    assert.equal(total(), fichasIniciales, 'las fichas totales no cambiaron');

    const repartido = final.lastResult!.payouts.reduce((sum, p) => sum + p.amount, 0);
    assert.equal(repartido, 40, 'el bote eran las dos ciegas igualadas');
  });
});

test('reconectar con el token recupera el asiento y las fichas', async () => {
  await withServer(async (ctx) => {
    const anfitrion = makeClient(ctx);
    await anfitrion.connected();
    const creada = await anfitrion.request<JoinResult>('room:create', {
      name: 'Marcos',
      settings: { maxSeats: 3, startingStack: 1500 },
    });

    const amigo = makeClient(ctx);
    await amigo.connected();
    const unido = await amigo.request<JoinResult>('room:join', { code: creada.code, name: 'Amigo' });

    const conDos = await anfitrion.waitFor((s) => s.players.length === 2, 'dos jugadores');
    const asientoOriginal = conDos.players.find((p) => p.id === unido.playerId)!.seat;

    // Se cae la conexión del amigo.
    amigo.close();
    await anfitrion.waitFor(
      (s) => s.players.some((p) => p.id === unido.playerId && !p.connected),
      'marcado como desconectado',
    );

    // Vuelve con el mismo token.
    const amigoVuelve = makeClient(ctx);
    await amigoVuelve.connected();
    const resumido = await amigoVuelve.request<JoinResult>('room:join', {
      code: creada.code,
      name: 'Amigo',
      token: unido.token,
    });

    assert.equal(resumido.playerId, unido.playerId, 'mismo jugador, no uno nuevo');

    const recuperado = await amigoVuelve.waitFor(
      (s) => s.youSeat !== null && s.players.every((p) => p.connected),
      'reconectado',
    );
    assert.equal(recuperado.youSeat, asientoOriginal, 'recuperó su asiento');
    assert.equal(recuperado.players.length, 2, 'no se duplicó el jugador');
    assert.equal(
      recuperado.players.find((p) => p.id === unido.playerId)!.chips,
      1500,
      'conservó sus fichas',
    );
  });
});

test('el servidor rechaza acciones ilegales y fuera de turno', async () => {
  await withServer(async (ctx) => {
    const a = makeClient(ctx);
    await a.connected();
    const sala = await a.request<JoinResult>('room:create', {
      name: 'Marcos',
      settings: { maxSeats: 2, smallBlind: 10, bigBlind: 20, startingStack: 1000, turnTimeSec: 120 },
    });

    const b = makeClient(ctx);
    await b.connected();
    await b.request('room:join', { code: sala.code, name: 'Amigo' });

    await a.waitFor((s) => s.players.length === 2, 'dos jugadores');
    await a.request('game:start');
    const state = await a.waitFor((s) => s.phase === 'preflop', 'preflop');

    const leToca = state.turnSeat === state.youSeat ? a : b;
    const noLeToca = leToca === a ? b : a;

    await assert.rejects(() => noLeToca.request('game:action', { type: 'fold' }), /turno/i);
    await assert.rejects(() => leToca.request('game:action', { type: 'check' }), /igualar/i);
    await assert.rejects(() => leToca.request('game:action', { type: 'raise', amount: 1 }), /mínima|al menos/i);
    await assert.rejects(() => leToca.request('game:action', { type: 'inventada' }), /desconocida/i);
  });
});

test('no se puede entrar a una sala con un código inventado', async () => {
  await withServer(async (ctx) => {
    const client = makeClient(ctx);
    await client.connected();
    await assert.rejects(
      () => client.request('room:join', { code: 'XXXX', name: 'Nadie' }),
      /no existe/i,
    );
  });
});

test('el nombre se valida en el servidor', async () => {
  await withServer(async (ctx) => {
    const client = makeClient(ctx);
    await client.connected();
    await assert.rejects(() => client.request('room:create', { name: 'a' }), /2 caracteres/i);
  });
});

test('el chat llega a todos los de la sala', async () => {
  await withServer(async (ctx) => {
    const a = makeClient(ctx);
    await a.connected();
    const sala = await a.request<JoinResult>('room:create', { name: 'Marcos' });

    const b = makeClient(ctx);
    await b.connected();
    await b.request('room:join', { code: sala.code, name: 'Amigo' });
    await b.waitFor((s) => s.players.length === 2, 'dos jugadores');

    const recibido = new Promise<{ from: string; text: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando el chat')), TIMEOUT);
      b.socket.on('chat', (message: { from: string; text: string }) => {
        if (message.text === 'vamo arriba') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    await a.request('chat:send', { text: 'vamo arriba' });
    const message = await recibido;
    assert.equal(message.from, 'Marcos');
  });
});

test('la mesa llena deja entrar como espectador y después sentarse', async () => {
  await withServer(async (ctx) => {
    const a = makeClient(ctx);
    await a.connected();
    const sala = await a.request<JoinResult>('room:create', {
      name: 'Marcos',
      settings: { maxSeats: 2 },
    });

    const b = makeClient(ctx);
    await b.connected();
    await b.request('room:join', { code: sala.code, name: 'Amigo' });

    const c = makeClient(ctx);
    await c.connected();
    await c.request('room:join', { code: sala.code, name: 'Tercero' });

    const comoEspectador = await c.waitFor((s) => s.players.length === 2, 'mesa llena');
    assert.equal(comoEspectador.youSeat, null, 'entró sin asiento');

    // Se libera un lugar y ahora sí puede sentarse.
    await b.request('seat:leave');
    await c.waitFor((s) => s.players.length === 1, 'un lugar libre');
    await c.request('seat:take', { seat: 1 });

    const sentado = await c.waitFor((s) => s.youSeat !== null, 'sentado');
    assert.equal(sentado.youSeat, 1);
  });
});
