import type { VoiceApi } from '../lib/useVoice';

interface Props {
  voice: VoiceApi;
}

/**
 * Control del audio. Dos botones: entrar/salir de la conversación y silenciar.
 * El indicador de quién habla se dibuja sobre cada asiento, no acá.
 */
export function VoiceBar({ voice }: Props) {
  const others = Math.max(0, voice.participants.size - (voice.active ? 1 : 0));

  if (!voice.active) {
    return (
      <button
        type="button"
        className="voice-btn"
        onClick={() => void voice.start()}
        disabled={voice.connecting}
        title="Hablar con la mesa"
      >
        {voice.connecting ? '...' : '🎤'}
      </button>
    );
  }

  return (
    <div className="voice">
      <button
        type="button"
        className={`voice-btn${voice.muted ? ' voice-btn--muted' : ' voice-btn--on'}`}
        onClick={voice.toggleMute}
        title={voice.muted ? 'Activar micrófono' : 'Silenciar micrófono'}
      >
        {voice.muted ? '🔇' : '🎤'}
      </button>
      <button
        type="button"
        className="voice-btn voice-btn--hang"
        onClick={voice.stop}
        title="Salir del audio"
      >
        ✕
      </button>
      {others > 0 ? <span className="voice__count">{others}</span> : null}
    </div>
  );
}

/** Aviso de que falta TURN: la voz va a fallar con datos móviles. */
export function VoiceWarning({ voice }: Props) {
  if (!voice.active || !voice.turnMissing) return null;
  return (
    <div className="voice-warning">
      El servidor no tiene TURN configurado. El audio puede no conectar para quien esté con datos
      móviles.
    </div>
  );
}
