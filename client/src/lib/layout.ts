/**
 * Posiciona los asientos sobre una elipse.
 *
 * El truco de usabilidad: el jugador siempre se ve a sí mismo abajo al centro,
 * y el resto se acomoda alrededor en el orden real de la mesa.
 */

export interface Point {
  left: string;
  top: string;
}

function onEllipse(displayIndex: number, total: number, radiusX: number, radiusY: number): Point {
  // Arranca abajo (PI/2) y avanza en sentido horario en pantalla.
  const angle = Math.PI / 2 - (displayIndex / total) * Math.PI * 2;
  return {
    left: `${50 + radiusX * Math.cos(angle)}%`,
    top: `${50 + radiusY * Math.sin(angle)}%`,
  };
}

/**
 * Dónde va el panel del jugador.
 *
 * Solo aplica de 900px para arriba: en celular los asientos se acomodan en una
 * grilla y estas coordenadas quedan anuladas por CSS.
 *
 * El radio horizontal no puede pasar de ~37%: el panel mide 128px, así que con
 * 42% los asientos de los costados se salían del paño sobre el fondo oscuro.
 */
export function seatPosition(displayIndex: number, total: number): Point {
  return onEllipse(displayIndex, total, 37, 39);
}

/** Dónde van sus fichas apostadas: entre el jugador y el centro. */
export function betPosition(displayIndex: number, total: number): Point {
  return onEllipse(displayIndex, total, 27, 24);
}

/**
 * Convierte un asiento real en su lugar visual, rotando la mesa para que
 * `youSeat` quede abajo. Si sos espectador, no se rota nada.
 */
export function displayIndexOf(seat: number, youSeat: number | null, total: number): number {
  if (youSeat === null) return ((seat % total) + total) % total;
  return (((seat - youSeat) % total) + total) % total;
}
