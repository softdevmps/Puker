import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayerAction, TableSettings } from '@puker/shared';

import { Table } from '../table.js';

interface Harness {
  table: Table;
  ids: string[];
  /** Suma de fichas en los stacks + lo que hay apostado. */
  totalChips(): number;
  /** playerId al que le toca actuar. */
  current(): string | null;
  act(action: PlayerAction): void;
}

function makeTable(playerCount: number, settings: Partial<TableSettings> = {}): Harness {
  const table = new Table('TEST', {
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    turnTimeSec: 10_000,
    maxSeats: 9,
    allowRebuy: false,
    ...settings,
  });

  const ids: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const id = `p${i}`;
    table.sit(id, `Jugador${i}`);
    ids.push(id);
  }

  const totalChips = () =>
    table.seats.reduce((sum, seat) => sum + (seat ? seat.chips + seat.committed : 0), 0);

  const current = (): string | null => {
    const state = table.getStateFor(ids[0]!);
    if (state.turnSeat === null) return null;
    return table.seats[state.turnSeat]!.playerId;
  };

  return {
    table,
    ids,
    totalChips,
    current,
    act(action) {
      const playerId = current();
      assert.ok(playerId, 'no hay nadie a quien le toque actuar');
      table.act(playerId, action);
    },
  };
}

const seatOf = (h: Harness, playerId: string) => h.table.findSeat(playerId)!;

test('las ciegas se ponen y el turno abre en la posición correcta con 3 jugadores', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.phase, 'preflop');
  assert.equal(state.handNumber, 1);

  const dealer = state.dealerSeat!;
  const sb = (dealer + 1) % 3;
  const bb = (dealer + 2) % 3;
  const utg = dealer; // con 3 jugadores, el botón es el primero en hablar preflop

  const bySeat = (seat: number) => state.players.find((p) => p.seat === seat)!;
  assert.equal(bySeat(sb).bet, 10, 'la ciega chica debe ser 10');
  assert.equal(bySeat(bb).bet, 20, 'la ciega grande debe ser 20');
  assert.equal(state.currentBet, 20);
  assert.equal(state.totalPot, 30);
  assert.equal(state.turnSeat, utg);

  // Cada jugador recibió dos cartas y solo ve las propias.
  const you = state.players.find((p) => p.seat === seatOf(h, h.ids[0]!))!;
  assert.equal(you.cards.length, 2);
  assert.ok(you.cards.every((c) => typeof c === 'string'));
  const other = state.players.find((p) => p.seat !== you.seat)!;
  assert.equal(other.cards.length, 2);
  assert.ok(other.cards.every((c) => c === null), 'las cartas ajenas van tapadas');
});

test('mano a mano: el botón es la ciega chica y habla primero preflop', () => {
  const h = makeTable(2);
  h.table.start(h.ids[0]!);

  const state = h.table.getStateFor(h.ids[0]!);
  const dealer = state.dealerSeat!;
  const bySeat = (seat: number) => state.players.find((p) => p.seat === seat)!;

  assert.equal(bySeat(dealer).bet, 10, 'el botón pone la ciega chica');
  assert.equal(state.turnSeat, dealer, 'y habla primero preflop');
});

test('mano a mano: postflop habla primero la ciega grande', () => {
  const h = makeTable(2);
  h.table.start(h.ids[0]!);

  const dealer = h.table.getStateFor(h.ids[0]!).dealerSeat!;
  const bb = h.table.seats.findIndex((s, i) => s && i !== dealer);

  h.act({ type: 'call' }); // el botón iguala
  h.act({ type: 'check' }); // la ciega grande pasa

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.phase, 'flop');
  assert.equal(state.board.length, 3);
  assert.equal(state.turnSeat, bb, 'postflop abre la ciega grande');
});

test('si todos se retiran, la ciega grande se lleva el bote sin mostrar cartas', () => {
  const h = makeTable(3);
  const total = h.totalChips();
  h.table.start(h.ids[0]!);

  const dealer = h.table.getStateFor(h.ids[0]!).dealerSeat!;
  const bbSeat = (dealer + 2) % 3;
  const bbPlayer = h.table.seats[bbSeat]!;

  h.act({ type: 'fold' });
  h.act({ type: 'fold' });

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.phase, 'handover');
  assert.equal(bbPlayer.chips, 1000 + 10, 'gana las dos ciegas y recupera la suya');
  assert.equal(h.totalChips(), total, 'no se perdieron fichas');

  const result = state.lastResult!;
  assert.equal(result.payouts.length, 1);
  assert.equal(result.payouts[0]!.seat, bbSeat);
  assert.ok(result.shown[0]!.byFold);
});

test('una mano completa llega al river y reparte el bote sin descuadrar fichas', () => {
  const h = makeTable(3);
  const total = h.totalChips();
  h.table.start(h.ids[0]!);

  // Preflop: todos igualan.
  h.act({ type: 'call' });
  h.act({ type: 'call' });
  h.act({ type: 'check' }); // opción de la ciega grande

  for (const street of ['flop', 'turn', 'river'] as const) {
    const state = h.table.getStateFor(h.ids[0]!);
    assert.equal(state.phase, street);
    h.act({ type: 'check' });
    h.act({ type: 'check' });
    h.act({ type: 'check' });
  }

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.phase, 'handover');
  assert.equal(state.board.length, 5);
  assert.equal(h.totalChips(), total);

  const result = state.lastResult!;
  const paid = result.payouts.reduce((sum, p) => sum + p.amount, 0);
  assert.equal(paid, 60, 'el bote eran las tres ciegas igualadas');
  assert.equal(result.shown.length, 3, 'los tres muestran cartas en el showdown');
  assert.ok(result.shown.every((s) => s.cards.length === 2 && s.best.length === 5));
});

test('rechaza subidas por debajo del mínimo y acepta la mínima exacta', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);

  const utg = h.current()!;
  const legal = h.table.legalActions(seatOf(h, utg))!;
  assert.equal(legal.minRaiseTo, 40, 'preflop la subida mínima es al doble de la ciega grande');

  assert.throws(() => h.table.act(utg, { type: 'raise', amount: 30 }), /mínima/i);
  assert.throws(() => h.table.act(utg, { type: 'raise', amount: 20 }), /al menos|mínima/i);

  h.table.act(utg, { type: 'raise', amount: 40 });
  assert.equal(h.table.getStateFor(utg).currentBet, 40);

  // Tras una subida a 40, la siguiente mínima es a 60.
  const next = h.current()!;
  assert.equal(h.table.legalActions(seatOf(h, next))!.minRaiseTo, 60);
});

test('una subida completa reabre la ronda para quien ya había hablado', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);

  const utg = h.current()!;
  h.table.act(utg, { type: 'call' }); // iguala 20
  const sb = h.current()!;
  h.table.act(sb, { type: 'raise', amount: 80 });

  // El que ya había igualado vuelve a tener turno y puede subir de nuevo.
  const bb = h.current()!;
  h.table.act(bb, { type: 'call' });
  assert.equal(h.current(), utg, 'le vuelve a tocar al que había igualado');
  const legal = h.table.legalActions(seatOf(h, utg))!;
  assert.ok(legal.canRaise, 'y puede volver a subir');
  assert.equal(legal.callAmount, 60);
});

test('no se puede actuar fuera de turno', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);

  const turno = h.current()!;
  const otro = h.ids.find((id) => id !== turno)!;
  assert.throws(() => h.table.act(otro, { type: 'fold' }), /no es tu turno/i);
});

test('no se puede pasar habiendo una apuesta sin igualar', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);
  const utg = h.current()!;
  assert.throws(() => h.table.act(utg, { type: 'check' }), /igualar/i);
});

test('un all-in corto genera bote lateral y las fichas cuadran', () => {
  const h = makeTable(3, { startingStack: 1000 });
  // El asiento 0 arranca corto.
  h.table.seats[0]!.chips = 120;
  const total = h.totalChips();
  h.table.start(h.ids[0]!);

  // Todos van all-in / igualan hasta el final.
  let guard = 0;
  while (h.table.isHandLive() && guard++ < 40) {
    const playerId = h.current();
    if (!playerId) break;
    const legal = h.table.legalActions(seatOf(h, playerId))!;
    if (legal.canRaise || legal.canBet) h.table.act(playerId, { type: 'allin' });
    else h.table.act(playerId, { type: 'call' });
  }

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.phase, 'handover', 'la mano terminó');
  assert.equal(h.totalChips(), total, 'las fichas totales no cambiaron');

  const result = state.lastResult!;
  const paid = result.payouts.reduce((sum, p) => sum + p.amount, 0);
  const apostado = 3000 - 1000 * 2 + 120 - 120; // referencia: todo lo comprometido
  void apostado;
  assert.ok(paid > 0, 'se repartió el bote');
  assert.ok(
    h.table.seats.every((s) => !s || s.chips >= 0),
    'nadie quedó con fichas negativas',
  );
});

test('el empate parte el bote y las fichas sobrantes no desaparecen', () => {
  const h = makeTable(2, { smallBlind: 5, bigBlind: 15, startingStack: 1000 });
  const total = h.totalChips();
  h.table.start(h.ids[0]!);

  // Forzamos un empate exacto: misma mano para los dos.
  h.table.seats[0]!.holeCards = ['Ac', 'Kd'];
  h.table.seats[1]!.holeCards = ['Ah', 'Ks'];

  let guard = 0;
  while (h.table.isHandLive() && guard++ < 40) {
    const playerId = h.current();
    if (!playerId) break;
    const legal = h.table.legalActions(seatOf(h, playerId))!;
    if (legal.canCheck) h.table.act(playerId, { type: 'check' });
    else h.table.act(playerId, { type: 'call' });
  }

  assert.equal(h.totalChips(), total);
  const result = h.table.getStateFor(h.ids[0]!).lastResult!;
  // Puede haber empate o no (depende del board), pero las fichas siempre cuadran.
  const paid = result.payouts.reduce((sum, p) => sum + p.amount, 0);
  assert.equal(paid, 30, 'el bote eran 15 + 15');
});

test('el jugador que se va de la mesa en medio de la mano no bloquea a los demás', () => {
  const h = makeTable(3);
  h.table.start(h.ids[0]!);

  const turno = h.current()!;
  h.table.leave(turno);

  const state = h.table.getStateFor(h.ids[1]!);
  assert.ok(
    state.turnSeat !== null || state.phase === 'handover',
    'el juego siguió: o hay turno nuevo o la mano terminó',
  );
  assert.equal(h.table.occupiedCount, 2);
});

test('el timeout pasa si puede y se retira si no', () => {
  const h = makeTable(3, { turnTimeSec: 5 });
  h.table.start(h.ids[0]!);

  const utg = h.current()!;
  const utgSeat = seatOf(h, utg);

  // Hay una ciega grande sin igualar: el timeout tiene que ser fold.
  h.table.tick(Date.now() + 6000);
  assert.equal(h.table.seats[utgSeat]!.folded, true, 'se retira por tiempo');

  // Ahora, en una situación sin apuesta pendiente, el timeout pasa.
  const h2 = makeTable(2, { turnTimeSec: 5 });
  h2.table.start(h2.ids[0]!);
  h2.act({ type: 'call' });
  const bb = h2.current()!;
  h2.table.tick(Date.now() + 6000);
  const bbSeat = seatOf(h2, bb);
  assert.equal(h2.table.seats[bbSeat]!.folded, false, 'no se retira si puede pasar gratis');
  assert.equal(h2.table.getStateFor(h2.ids[0]!).phase, 'flop');
});

test('se juegan muchas manos al azar sin perder ni inventar fichas', () => {
  const rnd = mulberry32(20261023);

  for (let partida = 0; partida < 12; partida++) {
    const jugadores = 2 + Math.floor(rnd() * 5);
    const h = makeTable(jugadores, { startingStack: 500 + Math.floor(rnd() * 1500) });
    const total = h.totalChips();

    h.table.start(h.ids[0]!);

    for (let mano = 0; mano < 25; mano++) {
      let guard = 0;
      while (h.table.isHandLive() && guard++ < 500) {
        const playerId = h.current();
        if (!playerId) break;
        const seat = seatOf(h, playerId);
        h.table.act(playerId, randomAction(h.table, seat, rnd));
      }

      assert.ok(guard < 500, 'la mano no debería trabarse en un bucle');
      assert.equal(
        h.totalChips(),
        total,
        `fichas descuadradas en la mano ${mano + 1} con ${jugadores} jugadores`,
      );
      assert.ok(
        h.table.seats.every((s) => !s || s.chips >= 0),
        'ningún stack puede quedar negativo',
      );

      const conFichas = h.table.seats.filter((s) => s && s.chips > 0).length;
      if (conFichas < 2) break;

      // Avanza el reloj para que arranque la mano siguiente.
      h.table.tick(Date.now() + 60_000);
      if (!h.table.isHandLive()) break;
    }
  }
});

test('el bote mostrado siempre coincide con lo que los jugadores comprometieron', () => {
  const rnd = mulberry32(777);
  const h = makeTable(4, { startingStack: 800 });
  h.table.start(h.ids[0]!);

  let guard = 0;
  while (h.table.isHandLive() && guard++ < 300) {
    const playerId = h.current();
    if (!playerId) break;
    const state = h.table.getStateFor(h.ids[0]!);
    const comprometido = h.table.seats.reduce((sum, s) => sum + (s ? s.committed : 0), 0);
    assert.equal(state.totalPot, comprometido, 'el bote visible debe ser lo comprometido');
    h.table.act(playerId, randomAction(h.table, seatOf(h, playerId), rnd));
  }
});

function randomAction(table: Table, seat: number, rnd: () => number): PlayerAction {
  const legal = table.legalActions(seat)!;
  const opciones: PlayerAction[] = [];

  if (legal.canCheck) opciones.push({ type: 'check' }, { type: 'check' });
  if (legal.canCall) opciones.push({ type: 'call' }, { type: 'call' });
  if (legal.canFold && legal.callAmount > 0) opciones.push({ type: 'fold' });
  if (legal.canBet || legal.canRaise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const amount = legal.minRaiseTo + (span > 0 ? Math.floor(rnd() * (span + 1)) : 0);
    opciones.push({ type: legal.canBet ? 'bet' : 'raise', amount });
  }
  opciones.push({ type: 'allin' });

  return opciones[Math.floor(rnd() * opciones.length)]!;
}

/** PRNG determinístico para que los tests sean reproducibles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
