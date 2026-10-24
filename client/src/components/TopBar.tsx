import { useState } from 'react';

import { formatChips, type GameState } from '@puker/shared';

interface Props {
  state: GameState;
  connected: boolean;
  muted: boolean;
  onToggleMuted(): void;
  onTogglePanel(): void;
  onStart(): void;
  onPause(): void;
  onSitOut(sitOut: boolean): void;
  onRebuy(): void;
  onLeaveSeat(): void;
  onExit(): void;
  onNotify(kind: 'info' | 'error' | 'success', text: string): void;
}

export function TopBar({
  state,
  connected,
  muted,
  onToggleMuted,
  onTogglePanel,
  onStart,
  onPause,
  onSitOut,
  onRebuy,
  onLeaveSeat,
  onExit,
  onNotify,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const you = state.players.find((player) => player.seat === state.youSeat);
  const isHost = state.hostId !== null && state.hostId === state.youId;
  const canStart = isHost && !state.running;

  const share = async () => {
    const url = `${window.location.origin}/?sala=${state.roomCode}`;
    const text = `Entrá a jugar al poker: ${url} (código ${state.roomCode})`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Puker', text, url });
        return;
      }
      await navigator.clipboard.writeText(text);
      onNotify('success', 'Link copiado. Pasáselo a tus amigos.');
    } catch {
      onNotify('info', `Código de la mesa: ${state.roomCode}`);
    }
  };

  return (
    <header className="topbar">
      <button type="button" className="topbar__code" onClick={share} title="Compartir la mesa">
        <span className="topbar__code-label">Mesa</span>
        <strong>{state.roomCode}</strong>
        <span className="topbar__share">⇪</span>
      </button>

      <div className="topbar__info">
        {!connected ? (
          <span className="topbar__offline">Reconectando...</span>
        ) : (
          <>
            <span title="Jugadores en la mesa">
              {state.players.length}/{state.settings.maxSeats}
            </span>
            <span className="topbar__dot">·</span>
            <span title="Ciegas">
              {formatChips(state.settings.smallBlind)}/{formatChips(state.settings.bigBlind)}
            </span>
            {state.handNumber > 0 ? (
              <>
                <span className="topbar__dot">·</span>
                <span title="Número de mano">#{state.handNumber}</span>
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="topbar__buttons">
        {canStart ? (
          <button type="button" className="btn btn--small btn--primary" onClick={onStart}>
            Empezar
          </button>
        ) : null}
        {isHost && state.running ? (
          <button type="button" className="btn btn--small btn--ghost" onClick={onPause}>
            Pausar
          </button>
        ) : null}

        <button type="button" className="btn btn--icon" onClick={onTogglePanel} title="Historial y chat">
          ☰
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setMenuOpen((open) => !open)}
          title="Más opciones"
        >
          ⋯
        </button>
      </div>

      {menuOpen ? (
        <>
          <div className="sheet__backdrop" onClick={() => setMenuOpen(false)} />
          <div className="sheet">
            <button
              type="button"
              className="sheet__item"
              onClick={() => {
                onToggleMuted();
                setMenuOpen(false);
              }}
            >
              {muted ? '🔔 Activar sonido' : '🔇 Silenciar sonido'}
            </button>

            {you && you.chips <= 0 && state.settings.allowRebuy ? (
              <button
                type="button"
                className="sheet__item sheet__item--accent"
                onClick={() => {
                  onRebuy();
                  setMenuOpen(false);
                }}
              >
                Recargar {formatChips(state.settings.startingStack)} fichas
              </button>
            ) : null}

            {you ? (
              <button
                type="button"
                className="sheet__item"
                onClick={() => {
                  onSitOut(you.status !== 'sitting-out');
                  setMenuOpen(false);
                }}
              >
                {you.status === 'sitting-out' ? 'Volver a jugar' : 'Ponerme de descanso'}
              </button>
            ) : null}

            {you ? (
              <button
                type="button"
                className="sheet__item"
                onClick={() => {
                  onLeaveSeat();
                  setMenuOpen(false);
                }}
              >
                Levantarme de la mesa
              </button>
            ) : null}

            <button
              type="button"
              className="sheet__item sheet__item--danger"
              onClick={() => {
                setMenuOpen(false);
                onExit();
              }}
            >
              Salir de la sala
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
}
