import { useEffect, useState } from 'react';
import { formatPesos, formatStack, type GameState, type TournamentResult } from '@puker/shared';
import { AliasCopy } from './AliasCopy';
import { Avatar } from './Avatar';

export function TournamentPanel({ state, onRebuy, onWithdraw, onExit }: {
  state: GameState;
  onRebuy(): Promise<void>;
  onWithdraw(): Promise<void>;
  /** Terminada la partida, lo que uno quiere es irse: se ofrece acá mismo. */
  onExit(): void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const match = state.tournament;
  if (!state.settings.tournament) return null;
  const you = match?.participants.find((p) => p.id === state.youId);
  const mustDecide = you?.status === 'rebuy';
  const result = match?.result;
  const showResult = !!result && (open || dismissed !== result.id);
  const close = () => { setOpen(false); setDismissed(result?.id ?? null); };
  const decide = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch { /* useGame muestra el error. */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="tournament-bar">
        <span>Pozo en pesos <strong>{formatPesos(match?.potCents ?? 0)}</strong></span>
        {you ? <span>Tu aporte <strong>{formatPesos(you.investedCents)}</strong></span> : null}
        {match ? <button type="button" onClick={() => setOpen(true)}>{result ? 'Ver reparto' : 'Ver aportes'}</button> : <span>Entrada {formatPesos(state.settings.entryFee * 100)} · mínimo 3 jugadores</span>}
      </div>
      {match?.status === 'awaiting-rebuy' ? <div className="tournament-wait" role="status">{state.pausedReason}. No se reparten nuevas manos.</div> : null}
      {mustDecide ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rebuy-title">
          <div className="modal__backdrop" />
          <div className="modal__card">
            <header className="modal__head"><h2 id="rebuy-title">Te quedaste sin fichas</h2></header>
            <div className="modal__body tournament-details">
              <p>La mesa espera tu decisión. Podés recomprar una sola vez o retirarte de la partida.</p>
              <p><strong>{formatStack(state.settings.startingStack)} fichas por {formatPesos(state.settings.rebuyFee * 100)}</strong></p>
              <p>Tu aporte total pasará a {formatPesos((you?.investedCents ?? 0) + state.settings.rebuyFee * 100)}.</p>
              <button type="button" className="btn btn--primary btn--wide" disabled={busy} onClick={() => void decide(onRebuy)}>Recomprar por {formatPesos(state.settings.rebuyFee * 100)}</button>
              <button type="button" className="btn btn--ghost btn--wide" disabled={busy} onClick={() => void decide(onWithdraw)}>Retirarme de la partida</button>
              <small>Si te retirás, tu aporte queda en el pozo de los finalistas.</small>
            </div>
          </div>
        </div>
      ) : showResult || open ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tournament-title">
          <div className="modal__backdrop" onClick={close} />
          <div className="modal__card tournament-modal">
            <header className="modal__head">
              <h2 id="tournament-title">{result ? 'Reparto final' : 'Aportes de la partida'}</h2>
              <button type="button" className="btn btn--icon" aria-label="Cerrar reparto" onClick={close}>×</button>
            </header>
            <div className="modal__body tournament-details">
              {result ? <TournamentResultDetails result={result} /> : <>
                <p>Pozo acumulado: <strong>{formatPesos(match?.potCents ?? 0)}</strong></p>
                <p>Entrada: {formatPesos(state.settings.entryFee * 100)} · Única recompra: {formatPesos(state.settings.rebuyFee * 100)}</p>
                <div className="tournament-contributions">{match?.participants.map((p) => <div key={p.id}><span>{p.name}<small>{p.rebuyUsed ? 'Entrada + recompra' : 'Entrada'}</small></span><strong>{formatPesos(p.investedCents)}</strong></div>)}</div>
                <p>Cuando queden dos jugadores, el pozo completo se reparte según sus fichas. Las recompras pendientes se resuelven primero.</p>
              </>}
            </div>
            {result ? (
              <footer className="modal__foot">
                <button type="button" className="btn btn--ghost" onClick={close}>Seguir en la mesa</button>
                <button type="button" className="btn btn--primary" onClick={onExit}>Salir de la sala</button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function TournamentResultDetails({ result }: { result: TournamentResult }) {
  const finalists = result.players.filter((p) => p.status === 'finalist');
  return <>
    <p className="tournament-pot">Pozo total <strong>{formatPesos(result.potCents)}</strong></p>
    {result.kind === 'cancelled' ? <p>Partida cancelada sin finalistas. Corresponde devolver a cada jugador su aporte.</p> : <p>{finalists.length === 1 ? 'Un único finalista recibe el 100% del pozo.' : 'El pozo completo se divide por el porcentaje de fichas de los dos finalistas.'}</p>}
    <div className="tournament-finalists">{finalists.map((p) => <article key={p.id} className="tournament-finalist">
      <h3 className="tournament-finalist__name"><Avatar src={p.avatarUrl} name={p.name} />{p.name}</h3>
      <p>{formatStack(p.chips)} fichas · <strong>{(p.share * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%</strong></p>
      <dl><dt>Aportó</dt><dd>{formatPesos(p.investedCents)}</dd><dt>Cobra</dt><dd className="tournament-award">{formatPesos(p.payoutCents)}</dd><dt>Resultado neto</dt><dd>{p.netCents > 0 ? '+' : ''}{formatPesos(p.netCents)}</dd></dl>
      <AliasCopy alias={p.transferAlias} />
    </article>)}</div>
    <h3>Cuenta de cada jugador</h3>
    <div className="tournament-contributions">{result.players.map((p) => <div key={p.id}>
      <span>{p.name}<small>{p.rebuyUsed ? 'Entrada + recompra' : 'Entrada'} · aportó {formatPesos(p.investedCents)}</small></span>
      <span>Cobra {formatPesos(p.payoutCents)}<small>Neto {p.netCents > 0 ? '+' : ''}{formatPesos(p.netCents)}</small></span>
    </div>)}</div>
    <p className="field__hint">El neto es lo que cobrás menos lo que pusiste. Puker solo lleva la cuenta: las transferencias las hacen ustedes.</p>
  </>;
}

export function TournamentHistory({ onClose }: { onClose(): void }) {
  const [matches, setMatches] = useState<{ id: string; roomCode: string; startedAt: number; result: TournamentResult | null }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/tournaments', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('No se pudo cargar el historial');
      const data = await response.json();
      setMatches(data.tournaments);
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Error al cargar'); });
    return () => controller.abort();
  }, []);
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Mis partidas">
    <div className="modal__backdrop" onClick={onClose} />
    <div className="modal__card tournament-modal">
      <header className="modal__head"><h2>Mis partidas</h2><button type="button" className="btn btn--icon" onClick={onClose} aria-label="Cerrar historial">×</button></header>
      <div className="modal__body tournament-details">
        {error ? <p>{error}</p> : matches === null ? <p>Cargando…</p> : !matches.length ? <p>Todavía no participaste de una partida.</p> : matches.map((match) => <details key={match.id} className="tournament-history">
          <summary>Mesa {match.roomCode} · {new Date(match.startedAt).toLocaleDateString('es-AR')}</summary>
          {match.result ? <TournamentResultDetails result={match.result} /> : <p>No hay reparto final registrado para esta partida.</p>}
        </details>)}
      </div>
    </div>
  </div>;
}
