import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';

import type {
  Ack,
  ChatMessage,
  ClientToServerEvents,
  GameState,
  JoinResult,
  LogEntry,
  PlayerAction,
  ServerToClientEvents,
  TableSettings,
} from '@puker/shared';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Puerta de escape para los acks: tiparlos genéricamente no aporta nada acá. */
interface AckEmitter {
  emit(event: string, payload: unknown, ack: (res: Ack<unknown>) => void): void;
}

const STORAGE = {
  name: 'puker.name',
  token: 'puker.token',
  room: 'puker.room',
  muted: 'puker.muted',
} as const;

const ACK_TIMEOUT_MS = 10_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Modo privado o storage bloqueado: seguimos sin persistir.
  }
}

function emitAck<T>(socket: GameSocket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('El servidor no respondió. Revisá tu conexión.')),
      ACK_TIMEOUT_MS,
    );
    (socket as unknown as AckEmitter).emit(event, payload, (res) => {
      clearTimeout(timer);
      if (res && res.ok) resolve(res.data as T);
      else reject(new Error(res?.ok === false ? res.error : 'Error inesperado'));
    });
  });
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface GameApi {
  screen: 'lobby' | 'table';
  state: GameState | null;
  /** Momento (reloj local) en que se vence el turno, ya corregido el desfase. */
  turnDeadline: number | null;
  logs: LogEntry[];
  chat: ChatMessage[];
  connected: boolean;
  busy: boolean;
  toasts: Toast[];
  savedName: string;
  savedRoom: string;
  muted: boolean;

  createRoom(name: string, settings?: Partial<TableSettings>): Promise<void>;
  joinRoom(code: string, name: string): Promise<void>;
  exitRoom(): void;
  act(action: PlayerAction): Promise<void>;
  startGame(): Promise<void>;
  pauseGame(): Promise<void>;
  setSitOut(sitOut: boolean): Promise<void>;
  takeSeat(seat: number): Promise<void>;
  leaveSeat(): Promise<void>;
  rebuy(): Promise<void>;
  updateSettings(patch: Partial<TableSettings>): Promise<void>;
  sendChat(text: string): Promise<void>;
  dismissToast(id: number): void;
  toggleMuted(): void;
  notify(kind: Toast['kind'], text: string): void;
}

export function useGame(): GameApi {
  const [screen, setScreen] = useState<'lobby' | 'table'>('lobby');
  const [state, setState] = useState<GameState | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [muted, setMuted] = useState(() => read(STORAGE.muted) === '1');

  const socketRef = useRef<GameSocket | null>(null);
  const sessionRef = useRef<{ code: string; name: string; token: string } | null>(null);
  const rejoinRef = useRef(false);
  const toastSeq = useRef(0);

  const savedName = useMemo(() => read(STORAGE.name) ?? '', []);
  const savedRoom = useMemo(() => read(STORAGE.room) ?? '', []);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Crea el socket una sola vez y engancha los listeners. */
  const ensureSocket = useCallback((): GameSocket => {
    if (socketRef.current) return socketRef.current;

    const socket: GameSocket = io({
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Tras una reconexión el servidor ya no sabe quiénes somos: hay que
      // volver a entrar a la sala con el mismo token para recuperar el asiento.
      const session = sessionRef.current;
      if (rejoinRef.current && session) {
        emitAck<JoinResult>(socket, 'room:join', {
          code: session.code,
          name: session.name,
          token: session.token,
        }).catch((error: unknown) => {
          notify('error', error instanceof Error ? error.message : 'No pudimos volver a la mesa');
          rejoinRef.current = false;
          sessionRef.current = null;
          write(STORAGE.token, null);
          write(STORAGE.room, null);
          setScreen('lobby');
          setState(null);
        });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('state', (next) => {
      setState(next);
      setTurnDeadline(
        next.turnEndsAt === null ? null : Date.now() + (next.turnEndsAt - next.serverNow),
      );
    });

    socket.on('log', (entries) => {
      setLogs((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const merged = [...prev, ...entries.filter((e) => !seen.has(e.id))];
        return merged.slice(-120);
      });
    });

    socket.on('chat', (message) => {
      setChat((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message].slice(-60)));
    });

    socket.on('toast', ({ kind, text }) => notify(kind, text));

    socket.on('kicked', ({ reason }) => {
      notify('error', reason);
      sessionRef.current = null;
      rejoinRef.current = false;
      write(STORAGE.token, null);
      write(STORAGE.room, null);
      setScreen('lobby');
      setState(null);
    });

    socket.on('connect_error', () => {
      setConnected(false);
    });

    return socket;
  }, [notify]);

  const enterRoom = useCallback(
    (result: JoinResult, name: string) => {
      sessionRef.current = { code: result.code, name, token: result.token };
      rejoinRef.current = true;
      write(STORAGE.name, name);
      write(STORAGE.token, result.token);
      write(STORAGE.room, result.code);
      setScreen('table');
    },
    [],
  );

  const createRoom = useCallback(
    async (name: string, settings?: Partial<TableSettings>) => {
      setBusy(true);
      try {
        const socket = ensureSocket();
        const result = await emitAck<JoinResult>(socket, 'room:create', { name, settings });
        setLogs([]);
        setChat([]);
        enterRoom(result, name);
      } finally {
        setBusy(false);
      }
    },
    [ensureSocket, enterRoom],
  );

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      setBusy(true);
      try {
        const socket = ensureSocket();
        const normalized = code.trim().toUpperCase();
        // Reusamos el token solo si volvemos a la misma sala.
        const token = read(STORAGE.room) === normalized ? read(STORAGE.token) : null;
        const result = await emitAck<JoinResult>(socket, 'room:join', {
          code: normalized,
          name,
          token: token ?? undefined,
        });
        setLogs([]);
        setChat([]);
        enterRoom(result, name);
      } finally {
        setBusy(false);
      }
    },
    [ensureSocket, enterRoom],
  );

  /** Acción del jugador; los errores se muestran como toast y no rompen la UI. */
  const send = useCallback(
    async (event: string, payload: unknown = {}) => {
      const socket = socketRef.current;
      if (!socket) throw new Error('Sin conexión');
      try {
        await emitAck<undefined>(socket, event, payload);
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'No se pudo completar la acción');
        throw error;
      }
    },
    [notify],
  );

  const act = useCallback((action: PlayerAction) => send('game:action', action).catch(() => {}), [send]);

  const exitRoom = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      rejoinRef.current = false;
      void emitAck<undefined>(socket, 'seat:leave', {}).catch(() => {});
      socket.disconnect();
      socketRef.current = null;
    }
    sessionRef.current = null;
    write(STORAGE.token, null);
    write(STORAGE.room, null);
    setState(null);
    setLogs([]);
    setChat([]);
    setScreen('lobby');
    setConnected(false);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      write(STORAGE.muted, prev ? null : '1');
      return !prev;
    });
  }, []);

  // Al abrir la app, si hay una sesión guardada volvemos solos a la mesa.
  useEffect(() => {
    const token = read(STORAGE.token);
    const code = read(STORAGE.room);
    const name = read(STORAGE.name);
    if (!token || !code || !name) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
        if (!response.ok) throw new Error('La mesa ya no existe');
        if (cancelled) return;

        const socket = ensureSocket();
        const result = await emitAck<JoinResult>(socket, 'room:join', { code, name, token });
        if (cancelled) return;
        enterRoom(result, name);
      } catch {
        write(STORAGE.token, null);
        write(STORAGE.room, null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureSocket, enterRoom]);

  useEffect(
    () => () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    },
    [],
  );

  return {
    screen,
    state,
    turnDeadline,
    logs,
    chat,
    connected,
    busy,
    toasts,
    savedName,
    savedRoom,
    muted,
    createRoom,
    joinRoom,
    exitRoom,
    act,
    startGame: () => send('game:start'),
    pauseGame: () => send('game:pause'),
    setSitOut: (sitOut: boolean) => send('seat:sitout', { sitOut }),
    takeSeat: (seat: number) => send('seat:take', { seat }),
    leaveSeat: () => send('seat:leave'),
    rebuy: () => send('player:rebuy'),
    updateSettings: (patch: Partial<TableSettings>) => send('settings:update', patch),
    sendChat: (text: string) => send('chat:send', { text }),
    dismissToast,
    toggleMuted,
    notify,
  };
}
