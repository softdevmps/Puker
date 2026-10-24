import { useCallback, useEffect, useState } from 'react';

import { formatStack, type RankingEntry } from '@puker/shared';

interface Props {
  /** Para resaltar tu propia fila. */
  youId: number | null;
  onClose(): void;
}

export function Ranking({ youId, onClose }: Props) {
  const [rows, setRows] = useState<RankingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/ranking');
      if (!response.ok) throw new Error(`Error ${response.status}`);
      const body = (await response.json()) as { ranking: RankingEntry[] };
      setRows(body.ranking);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar el ranking');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__card">
        <header className="modal__head">
          <h2>Ranking</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        {error ? (
          <div className="modal__body">
            <p className="panel__empty">{error}</p>
            <button type="button" className="btn btn--ghost btn--wide" onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        ) : rows === null ? (
          <div className="modal__body">
            <p className="panel__empty">Cargando...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="modal__body">
            <p className="panel__empty">Todavía no jugó nadie. Sé el primero.</p>
          </div>
        ) : (
          <div className="modal__body">
            <table className="ranking">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Jugador</th>
                  <th className="ranking__num">Fichas</th>
                  <th className="ranking__num">Manos</th>
                  <th className="ranking__num">Ganadas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.userId} className={row.userId === youId ? 'ranking__me' : undefined}>
                    <td className="ranking__pos">{medal(index)}</td>
                    <td>
                      <div className="ranking__player">
                        <span className="ranking__name">{row.displayName}</span>
                        {row.bestHand ? (
                          <span className="ranking__best">Mejor: {row.bestHand}</span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={`ranking__num ${row.net > 0 ? 'ranking__up' : row.net < 0 ? 'ranking__down' : ''}`}
                    >
                      {row.net > 0 ? '+' : ''}
                      {formatStack(row.net)}
                    </td>
                    <td className="ranking__num">{row.hands}</td>
                    <td className="ranking__num">
                      {row.wins}
                      {row.hands > 0 ? (
                        <small> ({Math.round((row.wins / row.hands) * 100)}%)</small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="modal__note">
              Las fichas son el neto acumulado: lo ganado menos lo apostado, sumando todas las manos
              de todas las mesas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function medal(index: number): string {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return String(index + 1);
}
