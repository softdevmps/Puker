import assert from 'node:assert/strict';
import test from 'node:test';

import { type PotContributor, buildPots, uncalledBet } from '../pots.js';

const p = (seat: number, committed: number, folded = false): PotContributor => ({
  seat,
  committed,
  folded,
});

test('un solo bote cuando todos apostaron lo mismo', () => {
  const pots = buildPots([p(0, 100), p(1, 100), p(2, 100)]);
  assert.equal(pots.length, 1);
  assert.equal(pots[0]!.amount, 300);
  assert.deepEqual(pots[0]!.eligible, [0, 1, 2]);
});

test('el dinero del que se retira queda en el bote pero no puede ganarlo', () => {
  const pots = buildPots([p(0, 100), p(1, 100), p(2, 100, true)]);
  assert.equal(pots.length, 1);
  assert.equal(pots[0]!.amount, 300);
  assert.deepEqual(pots[0]!.eligible, [0, 1]);
});

test('un all-in corto genera un bote lateral', () => {
  // El asiento 0 va all-in por 50; los otros dos llegan a 200.
  const pots = buildPots([p(0, 50), p(1, 200), p(2, 200)]);
  assert.equal(pots.length, 2);

  assert.equal(pots[0]!.amount, 150); // 50 x 3
  assert.deepEqual(pots[0]!.eligible, [0, 1, 2]);

  assert.equal(pots[1]!.amount, 300); // 150 x 2
  assert.deepEqual(pots[1]!.eligible, [1, 2]);

  const total = pots.reduce((s, pot) => s + pot.amount, 0);
  assert.equal(total, 450);
});

test('dos all-in de distinto tamaño generan tres botes', () => {
  const pots = buildPots([p(0, 50), p(1, 120), p(2, 300), p(3, 300)]);
  assert.equal(pots.length, 3);

  assert.equal(pots[0]!.amount, 200); // 50 x 4
  assert.deepEqual(pots[0]!.eligible, [0, 1, 2, 3]);

  assert.equal(pots[1]!.amount, 210); // 70 x 3
  assert.deepEqual(pots[1]!.eligible, [1, 2, 3]);

  assert.equal(pots[2]!.amount, 360); // 180 x 2
  assert.deepEqual(pots[2]!.eligible, [2, 3]);

  const total = pots.reduce((s, pot) => s + pot.amount, 0);
  assert.equal(total, 50 + 120 + 300 + 300);
});

test('los botes nunca pierden ni inventan fichas', () => {
  const casos: PotContributor[][] = [
    [p(0, 0), p(1, 0)],
    [p(0, 25), p(1, 25), p(2, 25), p(3, 25), p(4, 25)],
    [p(0, 10, true), p(1, 300), p(2, 300)],
    [p(0, 7), p(1, 13), p(2, 29), p(3, 29, true), p(4, 100)],
    [p(0, 1), p(1, 2), p(2, 3), p(3, 4), p(4, 5), p(5, 6)],
  ];

  for (const jugadores of casos) {
    const esperado = jugadores.reduce((s, j) => s + j.committed, 0);
    const total = buildPots(jugadores).reduce((s, pot) => s + pot.amount, 0);
    assert.equal(total, esperado, `fichas descuadradas en ${JSON.stringify(jugadores)}`);
  }
});

test('niveles consecutivos con los mismos elegibles se fusionan en un bote', () => {
  // El asiento 2 se retiró después de poner más que nadie: no abre bote nuevo.
  const pots = buildPots([p(0, 100), p(1, 100), p(2, 160, true)]);
  assert.equal(pots.length, 1);
  assert.equal(pots[0]!.amount, 360);
  assert.deepEqual(pots[0]!.eligible, [0, 1]);
});

test('uncalledBet devuelve solo el exceso no igualado', () => {
  assert.deepEqual(uncalledBet([p(0, 500), p(1, 200, true)]), { seat: 0, amount: 300 });
  assert.equal(uncalledBet([p(0, 200), p(1, 200)]), null);
  assert.equal(uncalledBet([p(0, 100), p(1, 100), p(2, 100)]), null);
});

test('uncalledBet con un único jugador con fichas le devuelve todo', () => {
  assert.deepEqual(uncalledBet([p(0, 50)]), { seat: 0, amount: 50 });
  assert.equal(uncalledBet([]), null);
});
