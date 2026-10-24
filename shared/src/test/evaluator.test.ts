import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDeck, shuffle } from '../cards.js';
import { HandCategory, evaluate5, evaluateBest } from '../evaluator.js';

const cat = (cards: string[]) => evaluate5(cards).category;

test('reconoce cada categoría de mano', () => {
  assert.equal(cat(['As', 'Ks', 'Qs', 'Js', 'Ts']), HandCategory.StraightFlush);
  assert.equal(cat(['9h', '8h', '7h', '6h', '5h']), HandCategory.StraightFlush);
  assert.equal(cat(['7c', '7d', '7h', '7s', '2c']), HandCategory.Quads);
  assert.equal(cat(['Kc', 'Kd', 'Kh', '3s', '3c']), HandCategory.FullHouse);
  assert.equal(cat(['Ac', 'Jc', '9c', '5c', '2c']), HandCategory.Flush);
  assert.equal(cat(['9c', '8d', '7h', '6s', '5c']), HandCategory.Straight);
  assert.equal(cat(['Qc', 'Qd', 'Qh', '8s', '3c']), HandCategory.Trips);
  assert.equal(cat(['Jc', 'Jd', '4h', '4s', 'Ac']), HandCategory.TwoPair);
  assert.equal(cat(['Tc', 'Td', '8h', '5s', '2c']), HandCategory.Pair);
  assert.equal(cat(['Ac', 'Jd', '9h', '5s', '2c']), HandCategory.HighCard);
});

test('la escalera A-2-3-4-5 cuenta como escalera al 5', () => {
  const wheel = evaluate5(['Ac', '2d', '3h', '4s', '5c']);
  assert.equal(wheel.category, HandCategory.Straight);
  assert.equal(wheel.ranks[0], 5);

  // Y pierde contra la escalera al 6.
  const six = evaluate5(['2d', '3h', '4s', '5c', '6h']);
  assert.ok(six.score > wheel.score, 'la escalera al 6 debe ganar a la rueda');
});

test('A-K-Q-J-T no se confunde con la rueda', () => {
  const broadway = evaluate5(['Ac', 'Kd', 'Qh', 'Js', 'Tc']);
  assert.equal(broadway.category, HandCategory.Straight);
  assert.equal(broadway.ranks[0], 14);
});

test('K-A-2-3-4 no es escalera', () => {
  assert.equal(cat(['Kc', 'Ad', '2h', '3s', '4c']), HandCategory.HighCard);
});

test('el orden de categorías es el correcto', () => {
  const ordenAscendente = [
    ['Ac', 'Jd', '9h', '5s', '2c'], // carta alta
    ['Tc', 'Td', '8h', '5s', '2c'], // pareja
    ['Jc', 'Jd', '4h', '4s', 'Ac'], // doble pareja
    ['Qc', 'Qd', 'Qh', '8s', '3c'], // trío
    ['9c', '8d', '7h', '6s', '5c'], // escalera
    ['Ac', 'Jc', '9c', '5c', '2c'], // color
    ['Kc', 'Kd', 'Kh', '3s', '3c'], // full
    ['7c', '7d', '7h', '7s', '2c'], // póker
    ['9h', '8h', '7h', '6h', '5h'], // escalera de color
  ];

  for (let i = 1; i < ordenAscendente.length; i++) {
    const anterior = evaluate5(ordenAscendente[i - 1]!);
    const actual = evaluate5(ordenAscendente[i]!);
    assert.ok(
      actual.score > anterior.score,
      `${actual.label} debería ganarle a ${anterior.label}`,
    );
  }
});

test('desempata por kicker', () => {
  const conAs = evaluate5(['Tc', 'Td', 'As', '5s', '2c']);
  const conRey = evaluate5(['Tc', 'Td', 'Ks', '5s', '2c']);
  assert.ok(conAs.score > conRey.score);

  // Misma pareja y mismos kickers = empate exacto.
  const a = evaluate5(['Tc', 'Td', 'As', '5s', '2c']);
  const b = evaluate5(['Th', 'Ts', 'Ad', '5h', '2d']);
  assert.equal(a.score, b.score);
});

test('desempata doble pareja por la pareja alta y después por el kicker', () => {
  const reyesYdoses = evaluate5(['Kc', 'Kd', '2h', '2s', '9c']);
  const reinasYjotas = evaluate5(['Qc', 'Qd', 'Jh', 'Js', '9c']);
  assert.ok(reyesYdoses.score > reinasYjotas.score, 'manda la pareja más alta');

  const kickerAlto = evaluate5(['Kc', 'Kd', '2h', '2s', 'Ac']);
  assert.ok(kickerAlto.score > reyesYdoses.score);
});

test('evaluateBest elige la mejor mano de 5 entre 7 cartas', () => {
  // 2 propias + 5 del board: el color es la mejor combinación disponible.
  const mano = evaluateBest(['Ah', 'Kh', '7h', '2h', '9h', '3c', '3d']);
  assert.equal(mano.category, HandCategory.Flush);
  assert.equal(mano.cards.length, 5);
  assert.ok(!mano.cards.includes('3c'));

  // Con dos pares en el board y un trío posible, elige el full.
  const full = evaluateBest(['8c', '8d', '8h', 'Kc', 'Kd', '2s', '3s']);
  assert.equal(full.category, HandCategory.FullHouse);
  assert.equal(full.ranks[0], 8);
  assert.equal(full.ranks[1], 13);
});

test('con tres parejas elige las dos más altas y el mejor kicker', () => {
  // A-A, K-K, Q-Q, J: no hay trío ni color, la mejor mano es doble pareja.
  const mejor = evaluateBest(['Ac', 'Ad', 'Kc', 'Kd', 'Qc', 'Qd', 'Jc']);
  assert.equal(mejor.category, HandCategory.TwoPair);
  assert.deepEqual(mejor.ranks, [14, 13, 12], 'ases y reyes con kicker de reina');

  const cinco = evaluate5(['Ac', 'Ad', 'Kc', 'Kd', 'Jc']);
  assert.ok(mejor.score >= cinco.score, 'con 7 cartas nunca puede salir una mano peor');
});

test('el mazo tiene 52 cartas únicas', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
});

test('evaluateBest se sostiene en 5000 manos de 7 cartas al azar', () => {
  const rnd = mulberry32(20261023);
  const deck = makeDeck();
  const vistas = new Set<number>();

  for (let i = 0; i < 5000; i++) {
    const mano = shuffle(deck, rnd).slice(0, 7);
    const mejor = evaluateBest(mano);

    assert.equal(mejor.cards.length, 5, 'la mano devuelta siempre tiene 5 cartas');
    assert.equal(new Set(mejor.cards).size, 5, 'sin cartas repetidas');
    assert.ok(mejor.cards.every((c) => mano.includes(c)), 'todas salen de las 7 recibidas');
    assert.ok(mejor.label.length > 0);

    // Invariante clave: el score de la mano elegida se reproduce evaluándola sola.
    assert.equal(
      evaluate5(mejor.cards).score,
      mejor.score,
      `score inconsistente para ${mano.join(' ')}`,
    );

    // Y ninguna otra combinación de 5 de esas 7 puede ser mejor.
    for (const combo of combinaciones(mano)) {
      assert.ok(
        evaluate5(combo).score <= mejor.score,
        `${combo.join(' ')} le gana a la "mejor" mano ${mejor.cards.join(' ')}`,
      );
    }

    vistas.add(mejor.category);
  }

  // El muestreo tiene que haber tocado al menos las categorías comunes.
  assert.ok(vistas.size >= 7, `se esperaban varias categorías distintas, hubo ${vistas.size}`);
});

function combinaciones(cards: string[]): string[][] {
  const out: string[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
  return out;
}

/** PRNG determinístico para que el fuzz sea reproducible. */
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
