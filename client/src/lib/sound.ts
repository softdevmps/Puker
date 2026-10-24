/**
 * Avisos sonoros mínimos, generados con WebAudio para no cargar archivos.
 *
 * Sirve sobre todo en el celular: te avisa que te toca aunque tengas la
 * pantalla en otra cosa.
 */

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    // Los navegadores suspenden el audio hasta que el usuario interactúa.
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function beep(frequency: number, durationMs: number, gain = 0.06): void {
  const ctx = ensureContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  const now = ctx.currentTime;
  const seconds = durationMs / 1000;
  volume.gain.setValueAtTime(0, now);
  volume.gain.linearRampToValueAtTime(gain, now + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + seconds + 0.02);
}

export const sounds = {
  /** Te toca actuar. */
  yourTurn(): void {
    beep(880, 160);
    setTimeout(() => beep(1175, 180), 150);
  },
  /** Se repartieron cartas nuevas. */
  deal(): void {
    beep(420, 90, 0.035);
  },
  /** Ganaste la mano. */
  win(): void {
    beep(659, 140);
    setTimeout(() => beep(784, 140), 130);
    setTimeout(() => beep(1047, 240), 260);
  },
};
