import { useEffect, useState } from 'react';

export interface Countdown {
  /** Milisegundos restantes (nunca negativo). */
  remaining: number;
  /** Fracción de 0 a 1 de tiempo que queda, para la barra. */
  fraction: number;
  seconds: number;
}

/**
 * Cuenta regresiva hacia `deadline` (reloj local, ya corregido el desfase con
 * el servidor). Refresca 10 veces por segundo solo mientras hay un turno.
 */
export function useCountdown(deadline: number | null, totalMs: number): Countdown {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [deadline]);

  if (deadline === null) return { remaining: 0, fraction: 0, seconds: 0 };

  const remaining = Math.max(0, deadline - now);
  return {
    remaining,
    fraction: totalMs > 0 ? Math.min(1, remaining / totalMs) : 0,
    seconds: Math.ceil(remaining / 1000),
  };
}

/**
 * Segundos que faltan hasta `deadline`, refrescados una vez por segundo. Para
 * cuentas largas donde no hace falta la precisión del reloj del turno.
 */
export function useSecondsLeft(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
