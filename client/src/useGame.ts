import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Solo se recuerda la última sala, para volver sola al recargar. */
const ROOM_KEY = 'puker.room';
const MUTED_KEY = 'puker.muted';
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
  savedRoom: string;
  muted: boolean;
  /** Socket vivo, para que la voz use la misma conexión. */
  socket: GameSocket | null;

  createRoom(settings?: Partial<TableSettings>): Promise<void>;
  joinRoom(code: string): Promise<void>;
  exitRoom(): void;
  act(action: PlayerAction): Promise<void>;
  startGame(): Promise<void>;
  pauseGame(): Promise<void>;
  setSitOut(sitOut: boolean): Promise<void>;
  takeSeat(seat: number): Promise<void>;
  leaveSeat(): Promise<void>;
  rebuy(): Promise<void>;
  withdraw(): Promise<void>;
  updateSettings(patch: Partial<TableSettings>): Promise<void>;
  sendChat(text: string): Promise<void>;
  dismissToast(id: number): void;
  toggleMuted(): void;
  notify(kind: Toast['kind'], text: string): void;
}

export function useGame(signedIn: boolean): GameApi {
  const [screen, setScreen] = useState<'lobby' | 'table'>('lobby');
  const [state, setState] = useState<GameState | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [muted, setMuted] = useState(() => read(MUTED_KEY) === '1');
  const [socket, setSocket] = useState<GameSocket | null>(null);

  const socketRef = useRef<GameSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const rejoinRef = useRef(false);
  const toastSeq = useRef(0);

  const savedRoom = read(ROOM_KEY) ?? '';

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const forgetRoom = useCallback(() => {
    rejoinRef.current = false;
    roomRef.current = null;
    write(ROOM_KEY, null);
    setScreen('lobby');
    setState(null);
  }, []);

  /** Crea el socket una sola vez y engancha los listeners. */
  const ensureSocket = useCallback((): GameSocket => {
    if (socketRef.current) return socketRef.current;

    const created: GameSocket = io({
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = created;
    setSocket(created);

    created.on('connect', () => {
      setConnected(true);
      // Tras reconectar, el servidor ya no sabe en qué sala estábamos.
      const code = roomRef.current;
      if (rejoinRef.current && code) {
        emitAck<JoinResult>(created, 'room:join', { code }).catch((error: unknown) => {
          notify('error', error instanceof Error ? error.message : 'No pudimos volver a la mesa');
          forgetRoom();
        });
      }
    });

    created.on('disconnect', () => setConnected(false));

    created.on('connect_error', (error) => {
      setConnected(false);
      if (/sesi|session/i.test(error.message)) {
        notify('error', 'Tu sesión venció. Volvé a entrar.');
      }
    });

    created.on('state', (next) => {
      setState(next);
      setTurnDeadline(
        next.turnEndsAt === null ? null : Date.now() + (next.turnEndsAt - next.serverNow),
      );
    });

    created.on('log', (entries) => {
      setLogs((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...entries.filter((e) => !seen.has(e.id))].slice(-120);
      });
    });

    created.on('chat', (message) => {
      setChat((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message].slice(-60),
      );
    });

    created.on('toast', ({ kind, text }) => notify(kind, text));

    created.on('kicked', ({ reason }) => {
      notify('error', reason);
      forgetRoom();
    });

    return created;
  }, [notify, forgetRoom]);

  const enterRoom = useCallback((code: string) => {
    roomRef.current = code;
    rejoinRef.current = true;
    write(ROOM_KEY, code);
    setScreen('table');
  }, []);

  const createRoom = useCallback(
    async (settings?: Partial<TableSettings>) => {
      setBusy(true);
      try {
        const result = await emitAck<JoinResult>(ensureSocket(), 'room:create', { settings });
        setLogs([]);
        setChat([]);
        enterRoom(result.code);
      } finally {
        setBusy(false);
      }
    },
    [ensureSocket, enterRoom],
  );

  const joinRoom = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const normalized = code.trim().toUpperCase();
        const result = await emitAck<JoinResult>(ensureSocket(), 'room:join', {
          code: normalized,
        });
        setLogs([]);
        setChat([]);
        enterRoom(result.code);
      } finally {
        setBusy(false);
      }
    },
    [ensureSocket, enterRoom],
  );

  /** Acción del jugador; los errores se muestran como toast y no rompen la UI. */
  const send = useCallback(
    async (event: string, payload: unknown = {}) => {
      const current = socketRef.current;
      if (!current) throw new Error('Sin conexión');
      try {
        await emitAck<undefined>(current, event, payload);
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'No se pudo completar la acción');
        throw error;
      }
    },
    [notify],
  );

  const act = useCallback(
    (action: PlayerAction) => {
      return send('game:action', action);
    },
    [send],
  );

  const exitRoom = useCallback(() => {
    const current = socketRef.current;
    if (current) {
      rejoinRef.current = false;
      void emitAck<undefined>(current, 'seat:leave', {}).catch(() => {});
    }
    forgetRoom();
    setLogs([]);
    setChat([]);
  }, [forgetRoom]);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      write(MUTED_KEY, prev ? null : '1');
      return !prev;
    });
  }, []);

  // Con sesión abierta y una sala guardada, volvemos solos a la mesa.
  useEffect(() => {
    if (!signedIn) return;
    // El lobby necesita la conexión incluso si la sala guardada ya no existe.
    const current = ensureSocket();
    const code = read(ROOM_KEY);
    if (!code) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
        if (!response.ok) throw new Error('La mesa ya no existe');
        if (cancelled) return;
        await emitAck<JoinResult>(current, 'room:join', { code });
        if (cancelled) return;
        enterRoom(code);
      } catch {
        write(ROOM_KEY, null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signedIn, ensureSocket, enterRoom]);

  // Al cerrar sesión, se corta el socket.
  useEffect(() => {
    if (signedIn) return;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocket(null);
    setConnected(false);
    setState(null);
    setScreen('lobby');
  }, [signedIn]);

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
    savedRoom,
    muted,
    socket,
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
    withdraw: () => send('player:withdraw'),
    updateSettings: (patch: Partial<TableSettings>) => send('settings:update', patch),
    sendChat: (text: string) => send('chat:send', { text }),
    dismissToast,
    toggleMuted,
    notify,
  };
}
