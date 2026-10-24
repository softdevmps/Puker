import { useEffect, useMemo, useRef, useState } from 'react';

import { ActionBar } from './components/ActionBar';
import { Lobby } from './components/Lobby';
import { SidePanel } from './components/SidePanel';
import { TableView } from './components/TableView';
import { TopBar } from './components/TopBar';
import { sounds } from './lib/sound';
import { useGame } from './useGame';

export function App() {
  const api = useGame();
  const [panelOpen, setPanelOpen] = useState(false);

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
    const state = api.state;
    if (!state || api.muted) return;

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
      const youWon = result.payouts.some((payout) => payout.seat === state.youSeat);
      if (youWon) sounds.win();
    }
  }, [api.state, api.muted]);

  const { state } = api;

  if (api.screen === 'lobby' || !state) {
    return (
      <>
        <Lobby
          savedName={api.savedName}
          savedRoom={roomFromUrl || api.savedRoom}
          busy={api.busy}
          onCreate={api.createRoom}
          onJoin={api.joinRoom}
          onError={(message) => api.notify('error', message)}
        />
        <Toasts api={api} />
      </>
    );
  }

  return (
    <div className="app">
      <TopBar
        state={state}
        connected={api.connected}
        muted={api.muted}
        onToggleMuted={api.toggleMuted}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onStart={() => void api.startGame().catch(() => {})}
        onPause={() => void api.pauseGame().catch(() => {})}
        onSitOut={(sitOut) => void api.setSitOut(sitOut).catch(() => {})}
        onRebuy={() => void api.rebuy().catch(() => {})}
        onLeaveSeat={() => void api.leaveSeat().catch(() => {})}
        onExit={api.exitRoom}
        onNotify={api.notify}
      />

      <main className="main">
        <TableView
          state={state}
          turnDeadline={api.turnDeadline}
          onSit={(seat) => void api.takeSeat(seat).catch(() => {})}
        />
        <SidePanel
          logs={api.logs}
          chat={api.chat}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onSendChat={api.sendChat}
        />
      </main>

      <ActionBar state={state} onAct={api.act} />
      <Toasts api={api} />
    </div>
  );
}

function Toasts({ api }: { api: ReturnType<typeof useGame> }) {
  if (api.toasts.length === 0) return null;
  return (
    <div className="toasts">
      {api.toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.kind}`}
          onClick={() => api.dismissToast(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}
