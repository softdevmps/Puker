import assert from 'node:assert/strict';
import test from 'node:test';
import { CHIP_DENOMINATIONS, chipBreakdown, STARTING_STACK } from '../chips.js';

test('el reparto inicial suma 29.000 en 52 fichas con los seis valores', () => {
  assert.equal(STARTING_STACK, 29_000);
  assert.deepEqual(chipBreakdown(29_000), CHIP_DENOMINATIONS);
  assert.equal(CHIP_DENOMINATIONS.reduce((sum, chip) => sum + chip.count, 0), 52);
});

test('el cambio conserva exactamente el saldo en múltiplos de 50', () => {
  for (let amount = 0; amount <= 300_000; amount += 50) {
    const chips = chipBreakdown(amount);
    assert.equal(chips.reduce((sum, chip) => sum + chip.value * chip.count, 0), amount);
    assert.ok(chips.every((chip) => Number.isInteger(chip.count) && chip.count > 0));
  }
});
