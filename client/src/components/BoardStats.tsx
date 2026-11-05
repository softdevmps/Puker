import { useCallback, useEffect, useState } from 'react';

import {
  BOARD_SHAPES,
  FLOP_PAIRED_EXPECTED,
  type BoardStats as Stats,
} from '@puker/shared';

import { PlayingCard } from './PlayingCard';

interface Props {
  onClose(): void;
}

/**
 * Cuántas veces vino emparejado el flop, contado sobre las manos que se
 * jugaron de verdad. Existe porque "me parece que salen muchas" no se puede
 * discutir: o se cuenta, o es la memoria de cada uno contra la del otro.
 */
export function BoardStats({ onClose }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/stats/boards');
      if (!response.ok) throw new Error(`Error ${response.status}`);
      setStats((await response.json()) as Stats);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar el historial');
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
          <h2>Historial de la mesa</h2>
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
        ) : stats === null ? (
          <div className="modal__body">
            <p className="panel__empty">Cargando...</p>
          </div>
        ) : stats.flops === 0 ? (
          <div className="modal__body">
            <p className="panel__empty">
              Todavía no se guardó ningún flop. Jugá unas manos y volvé: desde
              acá se cuentan solas.
            </p>
          </div>
        ) : (
          <div className="modal__body boards">
            <Flops flops={stats.flops} paired={stats.flopsPaired} />
            {stats.boards > 0 ? <Shapes boards={stats.boards} shapes={stats.shapes} /> : null}
            <Recent recent={stats.recent} />
          </div>
        )}
      </div>
    </div>
  );
}

function Flops({ flops, paired }: { flops: number; paired: number }) {
  const observed = (paired / flops) * 100;
  // Cuántos desvíos estándar separan lo que salió de lo que dicta el mazo.
  // Por debajo de 3 no hay nada que discutir: es el ruido de siempre.
  const p = FLOP_PAIRED_EXPECTED / 100;
  const sigmas = (paired - flops * p) / Math.sqrt(flops * p * (1 - p));
  const raro = Math.abs(sigmas) >= 3;

  return (
    <section className="boards__block">
      <h3 className="boards__title">El flop vino emparejado</h3>
      <div className="boards__hero">
        <div>
          <div className="boards__big">{observed.toFixed(2).replace('.', ',')} %</div>
          <div className="boards__sub">
            {paired} de {flops} flops
          </div>
        </div>
        <div>
          <div className="boards__big boards__big--dim">
            {FLOP_PAIRED_EXPECTED.toFixed(2).replace('.', ',')} %
          </div>
          <div className="boards__sub">lo que dicta el mazo</div>
        </div>
      </div>

      <p className={`boards__verdict${raro ? ' boards__verdict--raro' : ''}`}>
        {flops < 50
          ? `Con ${flops} flops todavía no se puede concluir nada: hacen falta unos 50 para que el número signifique algo.`
          : raro
            ? `Se aparta ${Math.abs(sigmas).toFixed(1)} desvíos de lo esperado. Eso ya no es casualidad; avisá.`
            : `Se aparta ${Math.abs(sigmas).toFixed(1)} desvíos de lo esperado, que es lo normal. El mazo viene bien.`}
      </p>
    </section>
  );
}

function Shapes({ boards, shapes }: { boards: number; shapes: Record<string, number> }) {
  return (
    <section className="boards__block">
      <h3 className="boards__title">Cómo vinieron las cinco cartas</h3>
      <table className="boards__table">
        <thead>
          <tr>
            <th>Forma</th>
            <th className="boards__num">Veces</th>
            <th className="boards__num">Salió</th>
            <th className="boards__num">Debería</th>
          </tr>
        </thead>
        <tbody>
          {BOARD_SHAPES.map((shape) => {
            const count = shapes[shape.pattern] ?? 0;
            return (
              <tr key={shape.pattern}>
                <td>{shape.label}</td>
                <td className="boards__num">{count}</td>
                <td className="boards__num">
                  {((count / boards) * 100).toFixed(2).replace('.', ',')} %
                </td>
                <td className="boards__num boards__num--dim">
                  {shape.expected.toFixed(2).replace('.', ',')} %
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="boards__note">
        Sobre {boards} manos que llegaron al river. Ojo con esta tabla: solo
        entran las manos que nadie abandonó antes, y eso puede correr un poco
        los números. El del flop, arriba, no tiene ese problema.
      </p>
    </section>
  );
}

function Recent({ recent }: { recent: { handNumber: number; board: string[] }[] }) {
  if (recent.length === 0) return null;
  return (
    <section className="boards__block">
      <h3 className="boards__title">Los últimos flops</h3>
      <ul className="boards__list">
        {recent.map((row, index) => {
          const flop = row.board.slice(0, 3);
          const repetido = new Set(flop.map((card) => card[0])).size < 3;
          return (
            <li key={`${row.handNumber}-${index}`} className={repetido ? 'boards__row--pair' : undefined}>
              <span className="boards__hand">#{row.handNumber}</span>
              <span className="boards__cards">
                {row.board.map((card, i) => (
                  <PlayingCard key={i} card={card} size="sm" dim={i >= 3} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="boards__note">
        Las tres primeras son el flop; las apagadas son turn y river. Las manos
        con flop emparejado van marcadas.
      </p>
    </section>
  );
}
