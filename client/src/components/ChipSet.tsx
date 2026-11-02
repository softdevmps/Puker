import { CHIP_DENOMINATIONS, chipBreakdown, STARTING_STACK } from '@puker/shared';

export function ChipSet({ amount = STARTING_STACK, compact = false }: { amount?: number; compact?: boolean }) {
  const breakdown = chipBreakdown(amount);
  const chips = compact ? CHIP_DENOMINATIONS.map((chip) => ({
    ...chip, count: breakdown.find((entry) => entry.value === chip.value)?.count ?? 0,
  })) : breakdown;
  return (
    <div className={`chip-set${compact ? ' chip-set--compact' : ''}`} aria-label={`Fichas por un total de ${amount.toLocaleString('es-AR')}`}>
      {chips.map((chip) => (
        <div className="chip-set__item" key={chip.value} title={`${chip.label}: ${chip.count} fichas de $${chip.value}`} aria-label={`${chip.label}: ${chip.count} fichas de $${chip.value}`}>
          <span className={`poker-chip poker-chip--${chip.color}`} aria-hidden="true">
            {chip.value.toLocaleString('es-AR')}
          </span>
          {compact ? <strong className="chip-set__quantity">×{chip.count}</strong> : <span><strong>{chip.count} × ${chip.value.toLocaleString('es-AR')}</strong><small>{chip.label}</small></span>}
        </div>
      ))}
    </div>
  );
}
