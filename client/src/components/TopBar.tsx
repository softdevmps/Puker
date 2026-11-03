import { useState } from 'react';

import { formatChips, formatPesos, type GameState } from '@puker/shared';

import type { VoiceApi } from '../lib/useVoice';
import { VoiceBar } from './VoiceBar';

interface Props {
  state: GameState;
  connected: boolean;
  muted: boolean;
  voice: VoiceApi;
  /** Mensajes de chat que todavía no viste. */
  unreadChat: number;
  onToggleMuted(): void;
  onTogglePanel(): void;
  onShowRanking(): void;
  onShowProfile(): void;
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
  voice,
  unreadChat,
  onToggleMuted,
  onTogglePanel,
  onShowRanking,
  onShowProfile,
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
  const canStart = isHost && !state.running && state.tournament?.status !== 'finished';
  const minimumPlayers = state.settings.tournament && !state.tournament ? 3 : 2;
  const enoughPlayers = state.players.filter((p) => p.chips > 0 && p.status !== 'sitting-out').length >= minimumPlayers;
  const entry = state.tournament?.participants.find((p) => p.id === state.youId);
  // El aviso de las ciegas solo tiene sentido con la partida en marcha.
  const showBlindCountdown = state.running && !state.blinds.capped && state.handNumber > 0;
  const blindsTitle = state.blinds.capped
    ? `Ciegas ${formatChips(state.blinds.small)}/${formatChips(state.blinds.big)}. Ya no suben más.`
    : state.blinds.handsLeft === 0
      ? 'Las ciegas se duplican en la próxima mano'
      : `Las ciegas se duplican en ${state.blinds.handsLeft} ${state.blinds.handsLeft === 1 ? 'mano' : 'manos'}, cuando el reparto dé la vuelta a la mesa`;
  const confirmLeave = () => !entry || !['active', 'rebuy'].includes(entry.status) || window.confirm('¿Retirarte de la partida? Tu aporte queda en el pozo y perdés el derecho a participar del reparto.');

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
            <span title={blindsTitle}>
              {formatChips(state.blinds.small)}/{formatChips(state.blinds.big)}
            </span>
            {showBlindCountdown ? (
              <span className="topbar__blinds-up" title={blindsTitle}>
                {state.blinds.handsLeft === 0 ? 'suben ya' : `faltan ${state.blinds.handsLeft}`}
              </span>
            ) : null}
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
          <button type="button" className="btn btn--small btn--primary" disabled={!enoughPlayers || state.tournament?.status === 'awaiting-rebuy'} onClick={onStart} title={enoughPlayers ? undefined : `Faltan jugadores: hacen falta ${minimumPlayers}`}>
            {state.handNumber > 0 ? 'Continuar' : 'Empezar'}
          </button>
        ) : null}
        {isHost && state.running ? (
          <button type="button" className="btn btn--small btn--ghost" onClick={onPause}>
            Pausar
          </button>
        ) : null}

        <VoiceBar voice={voice} />

        <button
          type="button"
          className="btn btn--icon btn--badged"
          onClick={onTogglePanel}
          title={unreadChat > 0 ? `Historial y chat · ${unreadChat} sin leer` : 'Historial y chat'}
        >
          ☰
          {unreadChat > 0 ? (
            <span className="btn__badge" aria-label={`${unreadChat} mensajes sin leer`}>
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          ) : null}
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
            <button type="button" className="sheet__item" onClick={() => { setMenuOpen(false); onShowProfile(); }}>Mi perfil</button>
            <button
              type="button"
              className="sheet__item"
              onClick={() => {
                setMenuOpen(false);
                onShowRanking();
              }}
            >
              🏆 Ver el ranking
            </button>

            <button
              type="button"
              className="sheet__item"
              onClick={() => {
                onToggleMuted();
                setMenuOpen(false);
              }}
            >
              {muted ? '🔔 Activar avisos' : '🔇 Silenciar avisos'}
            </button>

            {you && state.settings.allowRebuy ? (
              <div className="sheet__item sheet__item--note">
                {you.rebuyUsed ? 'Ya usaste tu recarga' : 'Te queda una recarga'}
              </div>
            ) : null}

            {state.canRebuy ? (
              <button
                type="button"
                className="sheet__item sheet__item--accent"
                onClick={() => {
                  onRebuy();
                  setMenuOpen(false);
                }}
              >
                {state.settings.tournament ? `Recomprar por ${formatPesos(state.settings.rebuyFee * 100)}` : `Recargar ${formatChips(state.settings.startingStack)} fichas (única recarga)`}
              </button>
            ) : null}

            {you && !state.tournament ? (
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
                  if (!confirmLeave()) return;
                  onLeaveSeat();
                  setMenuOpen(false);
                }}
              >
                {state.tournament && !state.tournament.result ? 'Retirarme de la partida' : 'Levantarme de la mesa'}
              </button>
            ) : null}

            <button
              type="button"
              className="sheet__item sheet__item--danger"
              onClick={() => {
                if (!confirmLeave()) return;
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
