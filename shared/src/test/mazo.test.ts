import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDeck, shuffle, RANKS, SUITS } from '../cards.js';

test('el mazo tiene 52 cartas distintas, 4 por número y 13 por palo', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52, 'ninguna carta viene repetida');

  for (const rank of RANKS) {
    assert.equal(deck.filter((card) => card[0] === rank).length, 4, `faltan ${rank}`);
  }
  for (const suit of SUITS) {
    assert.equal(deck.filter((card) => card[1] === suit).length, 13, `faltan ${suit}`);
  }
});

test('barajar reordena sin perder ni duplicar una sola carta', () => {
  const deck = makeDeck();
  for (let intento = 0; intento < 500; intento++) {
    const mezclado = shuffle(deck);
    assert.equal(mezclado.length, 52);
    assert.equal(new Set(mezclado).size, 52);
    assert.deepEqual([...mezclado].sort(), [...deck].sort(), 'son las mismas 52 cartas');
  }
});

test('barajar no toca el mazo original', () => {
  const deck = makeDeck();
  const copia = [...deck];
  shuffle(deck);
  assert.deepEqual(deck, copia);
});

/**
 * Fisher-Yates mal escrito (el error clásico es sortear entre las 52 en vez
 * de entre las que faltan) sigue devolviendo las 52 cartas, pero reparte unas
 * posiciones más que otras. Esto lo agarra: con un azar de mentira que siempre
 * devuelve 0, cada carta tiene que terminar en un lugar previsible.
 */
test('barajar recorre el mazo de atrás para adelante, como manda Fisher-Yates', () => {
  const deck = makeDeck();
  // rng() = 0 siempre: cada paso intercambia la posición i con la 0.
  const salida = shuffle(deck, () => 0);
  const esperado = [...deck];
  for (let i = esperado.length - 1; i > 0; i--) {
    const tmp = esperado[i]!;
    esperado[i] = esperado[0]!;
    esperado[0] = tmp;
  }
  assert.deepEqual(salida, esperado);
});
