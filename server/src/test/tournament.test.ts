import assert from 'node:assert/strict';
import test from 'node:test';
import { Table } from '../table.js';
import { Tournament } from '../tournament.js';
import { DEFAULT_SETTINGS } from '@puker/shared';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../db/store.js';

function makeTournament(allowRebuy = true) {
  const table = new Table('CASH', { allowRebuy });
  for (const id of ['a', 'b', 'c']) table.sit(id, id);
  return table;
}

/** Una mano determinista deja al jugador a en cero y a b/c con fichas. */
function bustFirst(table: Table) {
  table.seatOf('a')!.chips = 100;
  table.seatOf('b')!.chips = 29_000;
  table.seatOf('c')!.chips = 57_900;
  table.start('a');
  table.act('a', { type: 'allin' });
  table.act('b', { type: 'call' });
  table.act('c', { type: 'check' });
  table.board = ['2h', '3d', '7c', '8h', 'Ts'];
  table.phase = 'river';
  table.seatOf('a')!.holeCards = ['Qc', 'Qd'];
  table.seatOf('b')!.holeCards = ['Ac', 'Ad'];
  table.seatOf('c')!.holeCards = ['Kc', 'Kd'];
  table.act('b', { type: 'check' });
  table.act('c', { type: 'check' });
}

test('exige tres jugadores y cobra cada entrada una sola vez al comenzar', () => {
  const table = new Table('TEST');
  table.sit('a', 'a'); table.sit('b', 'b');
  assert.throws(() => table.start('a'), /al menos 3/);
  assert.equal(table.getStateFor('a').tournament, null);
  table.sit('c', 'c'); table.start('a');
  const before = table.getStateFor('a');
  assert.equal(before.tournament!.potCents, 1_500_000);
  table.pause('a'); table.start('a');
  const after = table.getStateFor('a');
  assert.equal(after.handNumber, before.handNumber);
  assert.deepEqual(after.board, before.board);
  assert.equal(after.totalPot, before.totalPot);
  assert.equal(after.turnSeat, before.turnSeat);
  assert.equal(after.tournament!.potCents, before.tournament!.potCents);
  assert.throws(() => table.sit('d', 'd'), /inscripción/);
  assert.throws(() => table.updateSettings({ entryFee: 1 }), /fijos/);
});

test('espera la decisión sin repartir manos; recomprar suma 4.000 una sola vez', () => {
  const table = makeTournament(); bustFirst(table);
  const before = table.getStateFor('a');
  assert.equal(before.tournament!.status, 'awaiting-rebuy');
  assert.equal(before.tournament!.result, null);
  assert.equal(before.canRebuy, true);
  table.setConnected('a', false, 0);
  table.tick(Date.now() + 300_000);
  assert.equal(table.getStateFor('a').handNumber, 1);
  assert.ok(table.seatOf('a'), 'desconectarse no decide la recompra');
  table.sit('a', 'a'); table.rebuy('a');
  const after = table.getStateFor('a');
  assert.equal(after.tournament!.potCents, 1_900_000);
  assert.equal(after.tournament!.status, 'playing');
  assert.equal(table.seatOf('a')!.chips, 29_000);
  assert.throws(() => table.rebuy('a'), /única recarga/);
  table.tick(Date.now() + 1600);
  assert.equal(table.handNumber, 2);
});

test('retirarse sin recomprar cierra con dos finalistas y conserva el aporte del eliminado', () => {
  const table = makeTournament(); bustFirst(table);
  table.withdraw('a');
  const match = table.getStateFor('b').tournament!;
  assert.equal(match.status, 'finished');
  assert.equal(match.result!.players.filter((p) => p.status === 'finalist').length, 2);
  assert.equal(match.result!.potCents, 1_500_000);
  assert.equal(match.result!.players.find((p) => p.id === 'a')!.netCents, -500_000);
  assert.equal(match.result!.players.reduce((sum, p) => sum + p.payoutCents, 0), 1_500_000);
  assert.equal(table.running, false);
  assert.throws(() => table.start('b'), /terminó/);
  assert.throws(() => table.sit('a', 'a'), /inscripción/);
  table.tick(Date.now() + 300_000);
  assert.equal(table.handNumber, 1);
});

test('sin recompra habilitada el cierre es automático al terminar la mano', () => {
  const table = makeTournament(false); bustFirst(table);
  assert.equal(table.getStateFor('a').tournament!.status, 'finished');
  assert.equal(table.getStateFor('a').canRebuy, false);
});

test('una salida fuera de turno conserva apuestas, turno y registro hasta el final', () => {
  const table = new Table('TEST', { tournament: false });
  for (const id of ['a', 'b', 'c']) table.sit(id, id);
  table.start('a');
  let recorded: number[] = [];
  table.onHandComplete = (record) => { recorded = record.players.map((p) => p.netChips); };
  const before = table.getStateFor('a');
  table.leave('b');
  assert.equal(table.getStateFor('a').totalPot, before.totalPot);
  assert.equal(table.getStateFor('a').turnSeat, before.turnSeat);
  table.act('a', { type: 'fold' });
  assert.equal(table.seatOf('c')!.chips, 29_050);
  assert.equal(recorded.length, 3);
  assert.equal(recorded.reduce((sum, n) => sum + n, 0), 0);
  table.sit('b', 'b');
  assert.equal(table.seatOf('b')!.chips, 28_950);
});

test('dos recompras pendientes se resuelven antes de liquidar; una segunda no aumenta el pozo', () => {
  const tournament = new Tournament('TEST', DEFAULT_SETTINGS, ['a', 'b', 'c'].map((id) => ({ playerId: id, userId: null, name: id, chips: 29_000 })));
  tournament.reconcile([{ playerId: 'a', userId: null, name: 'a', chips: 87_000 }, { playerId: 'b', userId: null, name: 'b', chips: 0 }, { playerId: 'c', userId: null, name: 'c', chips: 0 }]);
  tournament.rebuy('b', 29_000); tournament.reconcile([]);
  assert.equal(tournament.status, 'awaiting-rebuy');
  assert.throws(() => tournament.rebuy('b', 29_000), /disponible/);
  tournament.withdraw('c'); tournament.reconcile([]);
  assert.equal(tournament.result!.potCents, 1_900_000);
  assert.equal(tournament.result!.players.filter((p) => p.status === 'finalist').length, 2);
});

test('los aportes y el reparto sobreviven al cerrar y reabrir SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'puker-summary-'));
  const file = join(directory, 'test.db');
  let store: Store | null = null;
  try {
    store = new Store(file);
    const users = ['a', 'b', 'c'].map((name) => store!.createUser({ username: name, displayName: name }));
    const match = new Tournament('SAVE', DEFAULT_SETTINGS, users.map((user) => ({ playerId: `u${user.id}`, userId: user.id, name: user.display_name, chips: 29_000 })));
    store.saveTournament(match.record([]));
    match.entries.get(`u${users[2]!.id}`)!.chips = 0;
    match.reconcile([]);
    match.rebuy(`u${users[2]!.id}`, 29_000);
    match.withdraw(`u${users[2]!.id}`);
    match.reconcile([]);
    const saved = match.record([]);
    store.saveTournament(saved);
    store.saveTournament(saved);
    store.close(); store = new Store(file);
    const records = store.tournamentsFor(users[0]!.id);
    assert.equal(records.length, 1, 'guardar de nuevo no duplica aportes');
    assert.deepEqual(records[0], saved);
    assert.equal(records[0]!.potCents, 1_900_000);
  } finally {
    store?.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    rmdirSync(directory);
  }
});
