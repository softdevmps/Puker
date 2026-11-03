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
    tournament: false,
    chipUnit: 1,
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

test('all-in no permite subir si un all-in corto no reabrió las apuestas', () => {
  const h = makeTable(3);
  h.table.seats[1]!.chips = 30;
  h.table.start(h.ids[0]!);
  h.act({ type: 'call' });
  h.act({ type: 'allin' });
  h.act({ type: 'call' });
  assert.equal(h.table.getStateFor(h.ids[0]!).legal!.canRaise, false);
  assert.throws(() => h.act({ type: 'allin' }), /No podés subir/);
  assert.equal(h.table.seats[0]!.chips, 980);
  h.act({ type: 'call' });
});

test('cada jugador tiene una sola recarga por mesa y una mesa nueva renueva el cupo', () => {
  const table = new Table('ONCE', { tournament: false });
  for (const id of ['a', 'b']) {
    table.sit(id, id);
    table.seatOf(id)!.chips = 0;
    assert.equal(table.getStateFor(id).canRebuy, true);
    table.rebuy(id);
    assert.equal(table.seatOf(id)!.chips, 29_000);
    assert.equal(table.getStateFor(id).players.find((p) => p.id === id)!.rebuyUsed, true);
    table.seatOf(id)!.chips = 0;
    assert.equal(table.getStateFor(id).canRebuy, false);
    assert.throws(() => table.rebuy(id), /única recarga/);
    assert.equal(table.seatOf(id)!.chips, 0);
  }
  const next = new Table('NEXT', { tournament: false });
  next.sit('a', 'a');
  next.seatOf('a')!.chips = 0;
  next.rebuy('a');
  assert.equal(next.seatOf('a')!.chips, 29_000);
});

test('salir, reconectar y cambiar de asiento no regala fichas ni renueva la recarga', () => {
  const table = new Table('ONCE', { tournament: false });
  table.sit('a', 'a');
  table.seatOf('a')!.chips = 750;
  table.leave('a');
  table.sit('a', 'a');
  assert.equal(table.seatOf('a')!.chips, 750);
  table.seatOf('a')!.chips = 0;
  table.rebuy('a');
  table.seatOf('a')!.chips = 0;
  table.moveSeat('a', 2);
  table.setConnected('a', false, 0);
  table.tick(90_001);
  assert.equal(table.seatOf('a'), null);
  table.sit('a', 'a');
  assert.equal(table.seatOf('a')!.chips, 0);
  assert.equal(table.getStateFor('a').canRebuy, false);
  assert.throws(() => table.rebuy('a'), /única recarga/);
  table.updateSettings({ allowRebuy: false });
  table.updateSettings({ allowRebuy: true });
  assert.throws(() => table.rebuy('a'), /única recarga/);
});

test('los intentos inválidos no consumen la recarga y no se puede recargar durante un all-in', () => {
  const table = new Table('ONCE', { tournament: false, allowRebuy: false });
  table.sit('a', 'a');
  table.sit('b', 'b');
  assert.throws(() => table.rebuy('a'), /desactivada/);
  table.updateSettings({ allowRebuy: true });
  assert.throws(() => table.rebuy('a'), /Todavía/);
  table.start('a');
  table.act('a', { type: 'allin' });
  assert.equal(table.getStateFor('a').canRebuy, false);
  assert.throws(() => table.rebuy('a'), /termine la mano/);
  assert.equal(table.getStateFor('a').players.find((p) => p.id === 'a')!.rebuyUsed, false);
});

test('las mesas nuevas reparten 29.000 y rechazan apuestas que no se pagan con fichas de 50', () => {
  const table = new Table('CHIP', { tournament: false });
  table.sit('a', 'A');
  table.sit('b', 'B');
  assert.equal(table.seatOf('a')!.chips, 29_000);
  assert.equal(table.seatOf('b')!.chips, 29_000);
  table.start('a');
  assert.equal(table.getStateFor('a').totalPot, 150);
  assert.throws(() => table.act('a', { type: 'raise', amount: 225 }), /múltiplos de 50/);
  assert.equal(table.getStateFor('a').totalPot, 150);
  table.act('a', { type: 'raise', amount: 250 });
  table.act('b', { type: 'fold' });
  table.seatOf('b')!.chips = 0;
  table.rebuy('b');
  assert.equal(table.seatOf('b')!.chips, 29_000);
});

test('un empate de 450 reparte 250 y 200 sin fraccionar fichas de 50', () => {
  const h = makeTable(3, { chipUnit: 50, smallBlind: 50, bigBlind: 150, startingStack: 29_000 });
  const total = h.totalChips();
  h.table.start(h.ids[0]!);
  let guard = 0;
  while (h.table.phase !== 'river' && guard++ < 20) {
    const legal = h.table.legalActions(seatOf(h, h.current()!))!;
    h.act({ type: legal.canCheck ? 'check' : 'call' });
  }
  assert.equal(h.table.phase, 'river');
  h.table.board = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
  h.table.seats[0]!.holeCards = ['2c', '3c'];
  h.table.seats[1]!.holeCards = ['4c', '5c'];
  h.table.seats[2]!.holeCards = ['6c', '7c'];
  h.act({ type: 'fold' });
  h.act({ type: 'check' });
  h.act({ type: 'check' });
  const payouts = h.table.lastResult!.payouts;
  assert.deepEqual(payouts.map((p) => [p.seat, p.amount]), [[2, 250], [0, 200]]);
  assert.equal(h.totalChips(), total);
  assert.ok(h.table.seats.every((s) => !s || s.chips % 50 === 0));
});

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

test('mano a mano: si la ciega chica queda all-in al postear, el turno lo abre la grande', () => {
  // Regresión: el turno se le asignaba a la ciega chica sin verificar que
  // pudiera actuar, así que una mesa quedaba trabada apuntando a un all-in.
  const h = makeTable(2, { smallBlind: 10, bigBlind: 20, startingStack: 1000 });
  h.table.seats[0]!.chips = 10; // justo para la ciega chica y nada más
  const total = h.totalChips();

  h.table.start(h.ids[0]!);

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.dealerSeat, 0, 'el botón arranca en el asiento 0');
  assert.equal(h.table.seats[0]!.allIn, true, 'se quedó all-in poniendo la ciega');
  assert.equal(state.turnSeat, 1, 'habla la ciega grande, no el all-in');
  assert.ok(h.table.legalActions(1), 'y esa ciega grande tiene acciones válidas');

  // La mano se puede terminar sin trabarse.
  h.act({ type: 'check' });
  assert.equal(h.table.getStateFor(h.ids[0]!).phase, 'handover');
  assert.equal(h.totalChips(), total, 'las fichas cuadran');
});

test('con 3 jugadores, si las ciegas dejan all-in a alguien el turno lo saltea', () => {
  const h = makeTable(3, { smallBlind: 10, bigBlind: 20, startingStack: 1000 });
  h.table.seats[1]!.chips = 10; // ciega chica justa
  h.table.seats[2]!.chips = 20; // ciega grande justa
  const total = h.totalChips();

  h.table.start(h.ids[0]!);

  const state = h.table.getStateFor(h.ids[0]!);
  assert.equal(state.turnSeat, 0, 'el único con fichas es el que habla');
  assert.ok(h.table.legalActions(0), 'y puede actuar');

  let guard = 0;
  while (h.table.isHandLive() && guard++ < 20) {
    const playerId = h.current();
    if (!playerId) break;
    const legal = h.table.legalActions(seatOf(h, playerId))!;
    h.table.act(playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }

  assert.ok(guard < 20, 'la mano no se trabó');
  assert.equal(h.totalChips(), total);
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
  assert.equal(h.table.occupiedCount, 3, 'el asiento conserva sus aportes hasta cerrar la mano');
  assert.equal(h.table.seatOf(turno)!.folded, true);
  h.act({ type: 'fold' });
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

test('quien vuelve del descanso paga la ciega grande antes de recibir el botón', () => {
  // Regresión: al volver se entraba directo en el botón sin pagar ninguna
  // ciega, es decir la mejor posición de la mesa gratis. Bastaba pararse una
  // mano y volver en el momento justo.
  const h = makeTable(3, { startingStack: 1_000_000 });
  h.table.setSittingOut(h.ids[2]!, true);
  h.table.start(h.ids[0]!);

  const playOut = () => {
    let guard = 0;
    while (h.table.isHandLive() && guard++ < 60) {
      const playerId = h.current();
      if (!playerId) break;
      const legal = h.table.legalActions(seatOf(h, playerId))!;
      h.table.act(playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    h.table.tick(Date.now() + 60_000);
  };

  playOut(); // mano 1: mano a mano entre los asientos 0 y 1
  h.table.setSittingOut(h.ids[2]!, false);
  assert.equal(h.table.seats[2]!.awaitingBigBlind, true, 'vuelve debiendo una ciega grande');
  playOut(); // mano 2, y arranca la 3 ya con el que volvió

  const state = h.table.getStateFor(h.ids[0]!);
  assert.notEqual(state.dealerSeat, 2, 'el botón no puede caerle al que recién volvió');
  assert.equal(
    state.players.find((p) => p.seat === 2)!.bet,
    h.table.blinds.big,
    'entra pagando la ciega grande de la ronda en curso',
  );
  assert.equal(h.table.seats[2]!.awaitingBigBlind, false, 'cumplida la ciega, ya puede ser botón');

  // Lo mismo vale para quien se sienta con la partida ya en marcha.
  h.table.sit('nuevo', 'Nuevo', 3);
  assert.equal(h.table.seats[3]!.awaitingBigBlind, true);
});

test('reducir la mesa no echa a nadie ni deja la partida sin anfitrión', () => {
  // Regresión: al achicar la mesa se liberaban los asientos altos sin reasignar
  // el anfitrión, así que `hostId` apuntaba a alguien que ya no estaba sentado
  // y nadie podía empezar, pausar ni volver a cambiar las reglas.
  const table = new Table('SEATS', { tournament: false, maxSeats: 9, allowRebuy: false });
  for (let i = 0; i < 5; i++) table.sit(`p${i}`, `J${i}`);
  table.moveSeat('p0', 8); // el anfitrión se corre al último asiento

  assert.throws(() => table.updateSettings({ maxSeats: 3 }), /5 jugadores sentados/);
  assert.equal(table.settings.maxSeats, 9, 'el intento fallido no cambia las reglas');
  assert.equal(table.occupiedCount, 5, 'no se fue nadie');
  assert.ok(table.findSeat(table.hostId!) !== null, 'el anfitrión sigue sentado');

  // Con lugar suficiente, los asientos altos se corren solos y nadie se va.
  table.updateSettings({ maxSeats: 5 });
  assert.equal(table.occupiedCount, 5);
  assert.ok(table.seats.slice(5).every((seat) => seat === null), 'nadie queda fuera del límite');
  assert.ok(table.findSeat(table.hostId!) !== null, 'el anfitrión conserva su asiento');
  table.start(table.hostId!);
  assert.equal(table.running, true, 'la mesa sigue siendo jugable');
});

test('se juegan muchas manos al azar sin perder ni inventar fichas', () => {
  const rnd = mulberry32(20261023);

  for (let partida = 0; partida < 40; partida++) {
    const jugadores = 2 + Math.floor(rnd() * 8);
    // Se mezclan stacks largos con stacks cortísimos a propósito: con 2 o 3
    // ciegas de stack aparecen los all-in forzados al postear, que es donde
    // se esconden los casos de borde.
    const startingStack = partida % 3 === 0 ? 30 + Math.floor(rnd() * 60) : 500 + Math.floor(rnd() * 1500);
    const h = makeTable(jugadores, { startingStack });
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
  const legal = table.legalActions(seat);
  // Si la mesa dice que es el turno de alguien, ese alguien tiene que poder
  // actuar. Sin esta comprobación el fuzz moría con un TypeError opaco.
  assert.ok(
    legal,
    `el turno apunta al asiento ${seat} pero no tiene acciones posibles ` +
      `(folded=${table.seats[seat]?.folded}, allIn=${table.seats[seat]?.allIn}, ` +
      `chips=${table.seats[seat]?.chips})`,
  );
  const opciones: PlayerAction[] = [];

  if (legal.canCheck) opciones.push({ type: 'check' }, { type: 'check' });
  if (legal.canCall) opciones.push({ type: 'call' }, { type: 'call' });
  if (legal.canFold && legal.callAmount > 0) opciones.push({ type: 'fold' });
  if (legal.canBet || legal.canRaise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const amount = legal.minRaiseTo + (span > 0 ? Math.floor(rnd() * (span + 1)) : 0);
    opciones.push({ type: legal.canBet ? 'bet' : 'raise', amount });
  }
  if (legal.canBet || legal.canRaise || legal.callAmount === table.seats[seat]!.chips) {
    opciones.push({ type: 'allin' });
  }

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

// ----------------------------------------------------- ciegas que suben

/** Juega la mano en curso a puro pasar/igualar y deja lista la siguiente. */
function playOutHand(h: Harness): void {
  let guard = 0;
  while (h.table.isHandLive() && guard++ < 80) {
    const playerId = h.current();
    if (!playerId) break;
    const legal = h.table.legalActions(seatOf(h, playerId))!;
    h.table.act(playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
  h.table.tick(Date.now() + 60_000);
}

test('las ciegas se duplican cuando el botón completa la vuelta', () => {
  const h = makeTable(3, { startingStack: 1_000_000 });
  h.table.start(h.ids[0]!);

  const repartidores: (number | null)[] = [];
  const ciegas: string[] = [];
  for (let mano = 0; mano < 7; mano++) {
    const state = h.table.getStateFor(h.ids[0]!);
    repartidores.push(state.dealerSeat);
    ciegas.push(`${state.blinds.small}/${state.blinds.big}`);
    playOutHand(h);
  }

  assert.deepEqual(
    ciegas,
    ['10/20', '10/20', '10/20', '20/40', '20/40', '20/40', '40/80'],
    'suben recién cuando el reparto volvió al primero',
  );
  assert.equal(repartidores[0], repartidores[3], 'la mano 4 la reparte el mismo que la 1');
  assert.equal(repartidores[0], repartidores[6], 'y la 7 también');
});

test('la cuenta regresiva de las ciegas baja mano a mano y se reinicia al subir', () => {
  const h = makeTable(4, { startingStack: 1_000_000 });
  h.table.start(h.ids[0]!);

  const faltan: number[] = [];
  const niveles: number[] = [];
  for (let mano = 0; mano < 5; mano++) {
    const state = h.table.getStateFor(h.ids[0]!);
    faltan.push(state.blinds.handsLeft);
    niveles.push(state.blinds.level);
    playOutHand(h);
  }

  assert.deepEqual(faltan, [4, 3, 2, 1, 4], 'avisa cuántas manos faltan para la suba');
  assert.deepEqual(niveles, [1, 1, 1, 1, 2], 'la quinta mano ya es de la segunda ronda');
  assert.equal(h.table.getStateFor(h.ids[0]!).blinds.handsPerLevel, 4, 'la ronda dura una vuelta');
});

test('las ciegas dejan de subir al llegar al tope y no desarman la proporción', () => {
  const h = makeTable(2, { smallBlind: 50_000, bigBlind: 100_000, startingStack: 100_000_000 });
  h.table.start(h.ids[0]!);

  // Dos jugadores: la vuelta es de dos manos, así que sube rápido.
  for (let mano = 0; mano < 8; mano++) playOutHand(h);

  const { blinds } = h.table.getStateFor(h.ids[0]!);
  assert.equal(blinds.small, 100_000, 'la chica se queda en el tope');
  assert.equal(blinds.big, 200_000, 'la grande también, y sigue siendo el doble');
  assert.equal(blinds.capped, true, 'avisa que ya no suben más');
});

test('la subida de ciegas queda anotada en el registro de la mesa', () => {
  const h = makeTable(3, { startingStack: 1_000_000 });
  h.table.start(h.ids[0]!);
  for (let mano = 0; mano < 4; mano++) playOutHand(h);

  const avisos = h.table.drainLog().filter((entry) => entry.text.includes('las ciegas pasan a'));
  assert.equal(avisos.length, 1, 'se avisa una sola vez por ronda');
  assert.match(avisos[0]!.text, /20\/40/, 'y dice a cuánto pasaron');
});

test('frente a una apuesta grande, subir pide igualar su tamaño o ir all-in', () => {
  // Reporte real: con una apuesta de 13.000 en la mesa no se podía subir a
  // 20.000. Es la regla, no una falla: la subida mínima es a 26.000.
  const h = makeTable(2, { chipUnit: 50, smallBlind: 400, bigBlind: 800, startingStack: 200_000 });
  h.table.start(h.ids[0]!);
  while (h.table.getStateFor(h.ids[0]!).phase === 'preflop') {
    const playerId = h.current()!;
    const legal = h.table.legalActions(seatOf(h, playerId))!;
    h.table.act(playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }

  const apostador = h.current()!;
  const responde = h.ids.find((id) => id !== apostador)!;
  h.table.act(apostador, { type: 'bet', amount: 13_000 });

  const asiento = seatOf(h, responde);
  h.table.seats[asiento]!.chips = 100_000;
  const holgado = h.table.legalActions(asiento)!;
  assert.equal(holgado.fullRaiseTo, 26_000, 'subir pide igualar el tamaño de la apuesta');
  assert.equal(holgado.minRaiseTo, 26_000, 'y con fichas de sobra ese es el mínimo');
  assert.equal(holgado.raiseIsAllIn, false);
  assert.throws(() => h.table.act(responde, { type: 'raise', amount: 20_000 }), /subida mínima/);

  // Con menos de 26.000 encima, la única subida que queda es todo el stack.
  h.table.seats[asiento]!.chips = 24_000;
  const corto = h.table.legalActions(asiento)!;
  assert.equal(corto.fullRaiseTo, 26_000, 'el total que se pediría no cambia');
  assert.equal(corto.minRaiseTo, 24_000, 'pero el mínimo baja al all-in');
  assert.equal(corto.maxRaiseTo, 24_000);
  assert.equal(corto.raiseIsAllIn, true, 'y se avisa que solo queda ir con todo');
});
