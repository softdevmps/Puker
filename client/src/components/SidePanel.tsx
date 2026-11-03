import { useEffect, useRef, useState } from 'react';

import type { ChatMessage, LogEntry } from '@puker/shared';

interface Props {
  logs: LogEntry[];
  chat: ChatMessage[];
  open: boolean;
  onClose(): void;
  onSendChat(text: string): Promise<void>;
  /** Avisa hasta qué mensaje llegó a ver, para apagar el contador. */
  onChatSeen(lastId: number): void;
}

export function SidePanel({ logs, chat, open, onClose, onSendChat, onChatSeen }: Props) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [draft, setDraft] = useState('');
  const body = useRef<HTMLDivElement | null>(null);

  // Lo último, abajo. Se mueve `scrollTop` y no `scrollIntoView`: este arrastra
  // también a los padres, y como la mesa los recorta con `overflow: hidden`, la
  // página terminaba corrida sin manera de volver.
  useEffect(() => {
    const visible = body.current;
    if (visible) visible.scrollTop = visible.scrollHeight;
  }, [logs, chat, tab]);

  // Con el chat a la vista, lo que llega ya está leído.
  useEffect(() => {
    if (!open || tab !== 'chat') return;
    const last = chat[chat.length - 1];
    if (last) onChatSeen(last.id);
  }, [open, tab, chat, onChatSeen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await onSendChat(text);
    } catch {
      // El toast de error ya lo muestra useGame.
    }
  };

  return (
    <>
    {open ? <div className="panel__backdrop" onClick={onClose} aria-hidden="true" /> : null}
    <aside className={`panel${open ? ' panel--open' : ''}`}>
      <div className="panel__tabs">
        <button
          type="button"
          className={`panel__tab${tab === 'log' ? ' panel__tab--on' : ''}`}
          onClick={() => setTab('log')}
        >
          Mesa
        </button>
        <button
          type="button"
          className={`panel__tab${tab === 'chat' ? ' panel__tab--on' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Cerrar panel">
          ✕
        </button>
      </div>

      {tab === 'log' ? (
        <div className="panel__body" ref={body}>
          {logs.length === 0 ? <p className="panel__empty">Todavía no pasó nada.</p> : null}
          {logs.map((entry) => (
            <p key={entry.id} className={`log log--${entry.kind}`}>
              {entry.text}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="panel__body" ref={body}>
            {chat.length === 0 ? <p className="panel__empty">Decile algo a la mesa.</p> : null}
            {chat.map((message) => (
              <p key={message.id} className="chat">
                <strong>{message.from}:</strong> {message.text}
              </p>
            ))}
          </div>

          <form className="panel__compose" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Escribí un mensaje"
              maxLength={240}
            />
            <button type="submit" className="btn btn--small" disabled={!draft.trim()}>
              Enviar
            </button>
          </form>
        </>
      )}
    </aside>
    </>
  );
}
