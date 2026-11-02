/** Valores de las fichas de la mesa y reparto inicial por jugador. */
export const CHIP_DENOMINATIONS = [
  { value: 50, color: 'blue', label: 'Azules', count: 10 },
  { value: 100, color: 'black', label: 'Negras', count: 10 },
  { value: 250, color: 'green', label: 'Verdes', count: 10 },
  { value: 500, color: 'red', label: 'Rojas', count: 10 },
  { value: 1000, color: 'gray', label: 'Grises', count: 10 },
  { value: 5000, color: 'yellow', label: 'Amarillas', count: 2 },
] as const;

export const CHIP_UNIT = 50;
export const STARTING_STACK = CHIP_DENOMINATIONS.reduce((sum, chip) => sum + chip.value * chip.count, 0);

/** Cambio automático: conserva variedad de valores y representa el saldo exacto. */
export function chipBreakdown(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount % CHIP_UNIT !== 0) return [];
  const chips = CHIP_DENOMINATIONS.map((chip) => ({
    ...chip,
    count: Math.floor(chip.count * amount / STARTING_STACK),
  }));
  let remaining = amount - chips.reduce((sum, chip) => sum + chip.value * chip.count, 0);
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i]!;
    const extra = Math.floor(remaining / chip.value);
    chip.count += extra;
    remaining -= extra * chip.value;
  }
  return chips.filter((chip) => chip.count > 0);
}
