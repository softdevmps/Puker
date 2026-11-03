import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ActionBar } from './components/ActionBar';
import { AuthScreen } from './components/AuthScreen';
import { Lobby } from './components/Lobby';
import { Profile } from './components/Profile';
import { Ranking } from './components/Ranking';
import { SidePanel } from './components/SidePanel';
import { TableView } from './components/TableView';
import { TopBar } from './components/TopBar';
import { TournamentHistory, TournamentPanel } from './components/TournamentPanel';
import { sounds } from './lib/sound';
import { useVoice } from './lib/useVoice';
import { useAuth } from './useAuth';
import { type GameApi, useGame } from './useGame';

export function App() {
  const auth = useAuth();
  const game = useGame(auth.user !== null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [seenChatId, setSeenChatId] = useState(0);

  const { state, notify } = game;

  // Los códigos de mensaje empiezan de cero en cada sala.
  const roomCode = state?.roomCode;
  useEffect(() => setSeenChatId(0), [roomCode]);
  const unreadChat = game.chat.reduce((count, message) => count + (message.id > seenChatId ? 1 : 0), 0);

  /** Nombre visible de un jugador, para los mensajes del audio. */
  const nameOf = useCallback(
    (playerId: string) => state?.players.find((p) => p.id === playerId)?.name ?? 'Alguien',
    [state],
  );

  const voice = useVoice({
    socket: game.socket,
    youId: state?.youId ?? '',
    nameOf,
    notify,
  });

  // Un link del tipo /?sala=ABCD precarga el código de la mesa.
  const roomFromUrl = useMemo(() => {
    try {
      const value = new URLSearchParams(window.location.search).get('sala');
      return value ? value.toUpperCase().slice(0, 6) : '';
    } catch {
      return '';
    }
  }, []);

  const previousTurn = useRef(false);
  const previousHand = useRef(0);
  const previousResult = useRef(0);

  useEffect(() => {
    if (!state || game.muted) return;

    const isMyTurn = state.legal !== null;
    if (isMyTurn && !previousTurn.current) sounds.yourTurn();
    previousTurn.current = isMyTurn;

    if (state.handNumber > previousHand.current) {
      previousHand.current = state.handNumber;
      if (state.phase === 'preflop') sounds.deal();
    }

    const result = state.lastResult;
    if (result && result.handNumber !== previousResult.current) {
      previousResult.current = result.handNumber;
      if (result.payouts.some((payout) => payout.seat === state.youSeat)) sounds.win();
    }
  }, [state, game.muted]);

  if (auth.loading) {
    return (
      <div className="lobby">
        <div className="lobby__card lobby__card--loading">Cargando...</div>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <>
        <AuthScreen auth={auth} onNotify={notify} />
        <Toasts game={game} />
      </>
    );
  }

  if (game.screen === 'lobby' || !state) {
    return (
      <>
        <Lobby
          user={auth.user}
          savedRoom={roomFromUrl || game.savedRoom}
          busy={game.busy}
          connected={game.connected}
          onCreate={game.createRoom}
          onJoin={game.joinRoom}
          onError={(message) => notify('error', message)}
          onShowRanking={() => setRankingOpen(true)}
          onShowHistory={() => setHistoryOpen(true)}
          onShowProfile={() => setProfileOpen(true)}
          onLogout={() => void auth.logout()}
        />
        {rankingOpen ? (
          <Ranking youId={auth.user.id} onClose={() => setRankingOpen(false)} />
        ) : null}
        <Toasts game={game} />
        {historyOpen ? <TournamentHistory onClose={() => setHistoryOpen(false)} /> : null}
        {profileOpen ? <Profile user={auth.user} onSave={auth.updateProfile} onClose={() => setProfileOpen(false)} /> : null}
      </>
    );
  }

  return (
    <div className="app">
      <TopBar
        state={state}
        connected={game.connected}
        muted={game.muted}
        voice={voice}
        unreadChat={unreadChat}
        onToggleMuted={game.toggleMuted}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onShowRanking={() => setRankingOpen(true)}
        onShowProfile={() => setProfileOpen(true)}
        onStart={() => void game.startGame().catch(() => {})}
        onPause={() => void game.pauseGame().catch(() => {})}
        onSitOut={(sitOut) => void game.setSitOut(sitOut).catch(() => {})}
        onRebuy={() => void game.rebuy().catch(() => {})}
        onLeaveSeat={() => void game.leaveSeat().catch(() => {})}
        onExit={game.exitRoom}
        onNotify={notify}
      />

      <TournamentPanel state={state} onRebuy={game.rebuy} onWithdraw={game.withdraw} onExit={game.exitRoom} />

      <main className="main">
        <TableView
          state={state}
          turnDeadline={game.turnDeadline}
          voiceParticipants={voice.participants}
          voiceSpeaking={voice.speaking}
          onSit={(seat) => void game.takeSeat(seat).catch(() => {})}
        />
        <SidePanel
          logs={game.logs}
          chat={game.chat}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onSendChat={game.sendChat}
          onChatSeen={setSeenChatId}
        />
      </main>

      <ActionBar state={state} onAct={game.act} />

      {rankingOpen ? <Ranking youId={auth.user.id} onClose={() => setRankingOpen(false)} /> : null}
      {profileOpen ? <Profile user={auth.user} onSave={auth.updateProfile} onClose={() => setProfileOpen(false)} /> : null}
      <Toasts game={game} />
    </div>
  );
}

function Toasts({ game }: { game: GameApi }) {
  if (game.toasts.length === 0) return null;
  return (
    <div className="toasts">
      {game.toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.kind}`}
          onClick={() => game.dismissToast(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}
