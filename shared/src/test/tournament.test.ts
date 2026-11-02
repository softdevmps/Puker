import assert from 'node:assert/strict';
import test from 'node:test';
import { settleTournament, type TournamentParticipant } from '../tournament.js';

const player = (id: string, chips: number, investedCents: number, status: TournamentParticipant['status'] = 'active'): TournamentParticipant => ({ id, name: id, chips, investedCents, status, rebuyUsed: investedCents === 900_000 });

test('23.000 se reparten 60/40: cobran 13.800 y 9.200, netos 8.800 y 200', () => {
  const result = settleTournament('id', 'TEST', [player('a', 600, 500_000), player('b', 400, 900_000), player('c', 0, 900_000, 'eliminated')], 1);
  assert.equal(result.potCents, 2_300_000);
  assert.deepEqual(result.players.map((p) => [p.payoutCents, p.netCents]), [[1_380_000, 880_000], [920_000, 20_000], [0, -900_000]]);
  assert.equal(result.players.reduce((sum, p) => sum + p.netCents, 0), 0);
});

test('el redondeo conserva todos los centavos en miles de proporciones', () => {
  for (let chips = 1; chips < 2000; chips++) {
    const result = settleTournament('id', 'TEST', [player('a', chips, 500_000), player('b', 2000 - chips, 900_000), player('c', 0, 900_000, 'eliminated')], 1);
    assert.equal(result.players.reduce((sum, p) => sum + p.payoutCents, 0), result.potCents);
    assert.ok(result.players.every((p) => Number.isInteger(p.payoutCents)));
    assert.ok(Math.abs(result.players[0]!.payoutCents - result.potCents * chips / 2000) < 1);
  }
});

test('un finalista cobra el 100%; sin finalistas se devuelven los aportes', () => {
  const only = settleTournament('id', 'TEST', [player('a', 100, 500_000), player('b', 0, 900_000, 'eliminated')], 1);
  assert.equal(only.players[0]!.payoutCents, 1_400_000);
  const cancelled = settleTournament('id', 'TEST', [player('a', 100, 500_000, 'withdrawn'), player('b', 0, 900_000, 'withdrawn')], 1);
  assert.equal(cancelled.kind, 'cancelled');
  assert.ok(cancelled.players.every((p) => p.netCents === 0 && p.payoutCents === p.investedCents));
});

test('no liquida una recompra pendiente ni una partida con tres jugadores activos', () => {
  assert.throws(() => settleTournament('id', 'TEST', [player('a', 1, 500_000), player('b', 1, 500_000), player('c', 0, 500_000, 'rebuy')], 1), /recompra/);
  assert.throws(() => settleTournament('id', 'TEST', [player('a', 1, 500_000), player('b', 1, 500_000), player('c', 1, 500_000)], 1), /más de dos/);
});
