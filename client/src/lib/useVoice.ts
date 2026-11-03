import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import type { Ack, IceConfig, VoicePeer } from '@puker/shared';

/**
 * Voz por WebRTC en malla.
 *
 * Cada navegador se conecta directo con cada otro: el audio nunca pasa por el
 * servidor, que solo hace de cartero para que se encuentren. Eso da la mínima
 * latencia posible y casi cero costo de ancho de banda del servidor.
 *
 * Funciona bien hasta unas 6-8 personas. Con 6, cada uno sube unos 200 kbps
 * (cinco streams); más arriba habría que pasar a un servidor de medios (SFU).
 *
 * Para evitar el "glare" (que los dos manden oferta a la vez) hay una regla
 * simple: el que llega después es el que ofrece. Así cada par tiene siempre un
 * único iniciador y no hace falta negociación educada.
 */

/** Si no se habla por más de este tiempo, se apaga el indicador. */
const SPEAKING_DECAY_MS = 250;
const SPEAKING_THRESHOLD = 0.018;

/**
 * Un micrófono vivo siempre trae algo de ruido de fondo. Por debajo de esto no
 * hay ni eso: la pista está muerta aunque el navegador la muestre abierta.
 */
const DEAD_MIC_LEVEL = 0.0006;
/** Cuánto silencio absoluto hace falta para avisar que no sale nada. */
const DEAD_MIC_MS = 20_000;

interface AckEmitter {
  emit(event: string, payload: unknown, ack: (res: Ack<unknown>) => void): void;
}

function request<T>(socket: Socket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en ${event}`)), 10_000);
    (socket as unknown as AckEmitter).emit(event, payload, (res) => {
      clearTimeout(timer);
      if (res && res.ok) resolve(res.data as T);
      else reject(new Error(res?.ok === false ? res.error : 'error desconocido'));
    });
  });
}

interface PeerConnection {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  stream: MediaStream;
  analyser: AnalyserNode | null;
  name: string;
  /** Fuimos nosotros los que ofrecimos: nos toca a nosotros reintentar. */
  initiator: boolean;
  /** Reintentos de rehacer el camino antes de dar el par por perdido. */
  retries: number;
}

/** Cuántas veces se rehace el camino con un par antes de rendirse. */
const ICE_RETRIES = 2;

/** El sistema operativo o un botón del auricular lo tienen mudo. */
const MUTED_BY_SYSTEM =
  'Tu micrófono está silenciado por el sistema: fijate el botón de mute del auricular, o Configuración de Windows → Sonido → Entrada. Nadie te escucha hasta destrabarlo.';

export interface VoiceApi {
  /** El micrófono está activo y estás en la conversación. */
  active: boolean;
  /** Silenciado: seguís conectado, pero no te escuchan. */
  muted: boolean;
  connecting: boolean;
  /** playerIds que están hablando ahora (incluye el tuyo). */
  speaking: Set<string>;
  /** playerIds conectados por voz, incluido el tuyo. */
  participants: Set<string>;
  /** Están en el audio pero no se pudo armar el camino hasta ellos. */
  unreachable: Set<string>;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  toggleMute(): void;
  /** Abre el micrófono, mide qué entra y lo cuenta en castellano. */
  test(): Promise<{ ok: boolean; message: string }>;
}

/**
 * Las razones por las que un navegador no deja usar el micrófono, en orden de
 * probabilidad. Devuelve el problema encontrado, o cadena vacía si no hay.
 */
async function findBlocker(): Promise<string> {
  if (!window.isSecureContext) {
    return 'La página no está en HTTPS y el navegador no deja usar el micrófono. Entrá por la dirección con https://';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Este navegador no permite usar el micrófono. Probá con Chrome, Edge o Safari actualizados.';
  }
  try {
    const permission = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (permission?.state === 'denied') {
      return 'El micrófono está bloqueado para este sitio. Tocá el candado al lado de la dirección, permitilo y recargá la página.';
    }
  } catch {
    // Firefox y Safari no siempre saben responder por el micrófono.
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.length > 0 && !devices.some((device) => device.kind === 'audioinput')) {
      return 'No hay ningún micrófono conectado a este dispositivo.';
    }
  } catch {
    // Sin permiso todavía, la lista puede venir vacía: no es un problema.
  }
  return '';
}

export function useVoice(options: {
  socket: Socket | null;
  youId: string;
  /** Nombre visible de un jugador, para los mensajes de la UI. */
  nameOf: (playerId: string) => string;
  notify: (kind: 'info' | 'error' | 'success', text: string) => void;
}): VoiceApi {
  const { socket, youId, nameOf, notify } = options;

  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [unreachable, setUnreachable] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const localStream = useRef<MediaStream | null>(null);
  const localAnalyser = useRef<AnalyserNode | null>(null);
  const peers = useRef(new Map<string, PeerConnection>());
  const iceConfig = useRef<IceConfig | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const activeRef = useRef(false);
  /** Desde cuándo no entra ni ruido de fondo, y si ya se avisó. */
  const quietSince = useRef(0);
  const warnedQuiet = useRef(false);
  // `nameOf` cambia en cada render; se guarda en un ref para no reconstruir
  // los callbacks (y con ellos las conexiones) a cada rato.
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;

  /** Medidor de volumen para marcar quién habla. Decorativo: si falla, sigue. */
  const makeAnalyser = useCallback((stream: MediaStream): AnalyserNode | null => {
    try {
      if (!audioContext.current) {
        const Ctor =
          window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        audioContext.current = new Ctor();
      }
      const ctx = audioContext.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  }, []);

  const dropPeer = useCallback((playerId: string) => {
    const peer = peers.current.get(playerId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peers.current.delete(playerId);

    setParticipants((prev) => {
      if (!prev.has(playerId)) return prev;
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
    setSpeaking((prev) => {
      if (!prev.has(playerId)) return prev;
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
  }, []);

  const ensurePeer = useCallback(
    (playerId: string): PeerConnection => {
      const existing = peers.current.get(playerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: iceConfig.current?.iceServers ?? [] });

      // Un <audio> por par: cada uno suena independiente.
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.dataset.peer = playerId;
      document.body.appendChild(audio);

      const stream = new MediaStream();
      audio.srcObject = stream;

      const peer: PeerConnection = {
        pc, audio, stream, analyser: null, name: nameRef.current(playerId), initiator: false, retries: 0,
      };
      peers.current.set(playerId, peer);

      for (const track of localStream.current?.getTracks() ?? []) {
        pc.addTrack(track, localStream.current!);
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate || !socket) return;
        void request(socket, 'voice:signal', {
          to: playerId,
          data: { kind: 'ice', candidate: event.candidate.toJSON() },
        }).catch(() => {
          /* el par pudo haberse ido justo */
        });
      };

      pc.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
        }
        // Safari e iOS pueden bloquear la reproducción hasta que haya un gesto.
        void audio.play().catch(() => {
          notify('info', 'Tocá la pantalla para habilitar el audio');
        });
        peer.analyser = makeAnalyser(stream);
      };

      /** Rehace el camino con este par sin tirar la conexión (ICE restart). */
      const retryPath = async () => {
        if (!socket) return;
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          await request(socket, 'voice:signal', {
            to: playerId,
            data: { kind: 'offer', sdp: pc.localDescription, restart: true },
          });
        } catch {
          dropPeer(playerId);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          peer.retries = 0;
          setUnreachable((prev) => {
            if (!prev.has(playerId)) return prev;
            const next = new Set(prev);
            next.delete(playerId);
            return next;
          });
          return;
        }
        if (pc.connectionState !== 'failed') return;

        // Un corte puede ser pasajero (saltar de wifi a datos, por ejemplo): se
        // reintenta el camino antes de dar el par por perdido. Reintenta quien
        // ofreció, para que los dos lados no se pisen.
        if (peer.initiator && peer.retries < ICE_RETRIES) {
          peer.retries++;
          void retryPath();
          return;
        }

        // Casi siempre es NAT estricto (datos móviles) sin TURN disponible.
        notify(
          'error',
          iceConfig.current?.hasTurn
            ? `Se cortó el audio con ${peer.name}`
            : `No se pudo conectar el audio con ${peer.name}: falta un servidor TURN.`,
        );
        setUnreachable((prev) => new Set(prev).add(playerId));
        dropPeer(playerId);
      };

      setParticipants((prev) => new Set(prev).add(playerId));
      return peer;
    },
    [socket, notify, dropPeer, makeAnalyser],
  );

  /**
   * Le ofrece conexión a cada uno de los que ya estaban. El que llega es el que
   * ofrece: así cada par tiene un único iniciador y no hay ofertas cruzadas.
   */
  const offerTo = useCallback(
    async (existing: VoicePeer[]) => {
      if (!socket) return;
      for (const remote of existing) {
        const connection = ensurePeer(remote.playerId);
        connection.name = remote.name;
        connection.initiator = true;
        const offer = await connection.pc.createOffer();
        await connection.pc.setLocalDescription(offer);
        await request(socket, 'voice:signal', {
          to: remote.playerId,
          data: { kind: 'offer', sdp: connection.pc.localDescription },
        });
      }
    },
    [socket, ensurePeer],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    for (const playerId of [...peers.current.keys()]) dropPeer(playerId);
    for (const track of localStream.current?.getTracks() ?? []) track.stop();
    localStream.current = null;
    localAnalyser.current = null;
    setActive(false);
    setMuted(false);
    setSpeaking(new Set());
    setParticipants(new Set());
    setUnreachable(new Set());
    if (socket) void request(socket, 'voice:leave').catch(() => {});
  }, [socket, dropPeer]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    // Antes se volvía en silencio y el botón no hacía nada: imposible saber
    // que lo que faltaba era la conexión con la mesa.
    if (!socket) {
      const message = 'Todavía no hay conexión con la mesa. Esperá a que vuelva y probá de nuevo.';
      setError(message);
      notify('error', message);
      return;
    }
    setConnecting(true);
    setError(null);

    try {
      const blocker = await findBlocker();
      if (blocker) throw new Error(blocker);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      localStream.current = stream;
      localAnalyser.current = makeAnalyser(stream);
      quietSince.current = Date.now();
      warnedQuiet.current = false;

      // Si otra aplicación se queda con el micrófono, o cambia el dispositivo,
      // la pista muere: seguís escuchando a todos y nadie te escucha a vos.
      const [track] = stream.getAudioTracks();
      if (track) {
        track.onended = () => {
          const message = 'Se cortó tu micrófono: otra aplicación se lo quedó o cambió el dispositivo. Tocá el micrófono para volver a abrirlo.';
          setError(message);
          notify('error', message);
          stop();
        };
        // `muted` en la pista no es el silencio de Puker: es el sistema o un
        // botón del auricular. El navegador la da por viva y no entra nada.
        track.onmute = () => {
          setError(MUTED_BY_SYSTEM);
          notify('error', MUTED_BY_SYSTEM);
        };
        track.onunmute = () => {
          setError(null);
          notify('success', 'Volvió tu micrófono: ya te escuchan.');
        };
        if (track.muted) {
          setError(MUTED_BY_SYSTEM);
          notify('error', MUTED_BY_SYSTEM);
        }
      }

      iceConfig.current = await request<IceConfig>(socket, 'voice:config');

      const existing = await request<VoicePeer[]>(socket, 'voice:join');
      activeRef.current = true;
      setActive(true);
      setParticipants(new Set([youId]));
      await offerTo(existing);

      // Sin esto, entrar solo al audio no se distingue de que no funcione.
      notify(
        existing.length > 0 ? 'success' : 'info',
        existing.length > 0
          ? `Estás hablando con ${existing.map((peer) => peer.name).join(', ')}`
          : 'Micrófono abierto. Todavía no hay nadie más: decíles que toquen el suyo.',
      );
    } catch (caught) {
      const message = describeMicError(caught);
      setError(message);
      notify('error', message);
      stop();
    } finally {
      setConnecting(false);
    }
  }, [socket, youId, offerTo, makeAnalyser, notify, stop]);

  /**
   * Al cortarse el socket el servidor te saca del audio, y al reconectar nada
   * te vuelve a anotar: el micrófono quedaba encendido en pantalla pero nadie
   * podía llamarte nunca más. Acá se rehace la conversación entera.
   */
  const rejoin = useCallback(async () => {
    if (!socket || !activeRef.current) return;
    for (const playerId of [...peers.current.keys()]) dropPeer(playerId);
    setParticipants(new Set([youId]));
    setUnreachable(new Set());

    // La sala se rearma un instante después de reconectar, así que se reintenta
    // hasta que el servidor vuelva a reconocernos adentro.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        iceConfig.current = await request<IceConfig>(socket, 'voice:config');
        await offerTo(await request<VoicePeer[]>(socket, 'voice:join'));
        return;
      } catch {
        await new Promise((resume) => setTimeout(resume, 600));
      }
    }
    notify('error', 'Se perdió el audio al reconectar. Tocá el micrófono para volver.');
    stop();
  }, [socket, youId, dropPeer, offerTo, notify, stop]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      if (activeRef.current) void rejoin();
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, rejoin]);

  /**
   * Prueba a solas, sin molestar a la mesa: abre el micrófono y mide tres
   * segundos. Distingue "no abre" de "abre pero no entra nada", que es lo que
   * uno necesita saber para arreglarlo.
   */
  const test = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const blocker = await findBlocker();
    if (blocker) return { ok: false, message: blocker };

    let own: MediaStream | null = null;
    try {
      const stream = localStream.current ?? (own = await navigator.mediaDevices.getUserMedia({ audio: true }));
      if (stream.getAudioTracks().some((track) => track.muted)) {
        return { ok: false, message: MUTED_BY_SYSTEM };
      }
      const analyser = makeAnalyser(stream);
      if (!analyser) {
        return { ok: true, message: 'El micrófono abre bien, pero este navegador no deja medir el nivel.' };
      }

      const buffer = new Float32Array(256);
      let peak = 0;
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
        await new Promise((resume) => setTimeout(resume, 60));
      }

      if (peak < 0.004) {
        return {
          ok: false,
          message: 'El micrófono abre pero no entra nada de sonido. Fijate que el navegador no haya tomado otro micrófono y que no esté silenciado por el sistema.',
        };
      }
      return {
        ok: true,
        message: peak > 0.05
          ? 'El micrófono anda: se te escucha fuerte y claro.'
          : 'El micrófono anda, pero se te escucha bajito. Probá hablar más cerca.',
      };
    } catch (caught) {
      return { ok: false, message: describeMicError(caught) };
    } finally {
      for (const track of own?.getTracks() ?? []) track.stop();
    }
  }, [makeAnalyser]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    for (const track of localStream.current?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
  }, [muted]);

  // ----------------------------------------- indicador de quién está hablando

  useEffect(() => {
    if (!active) return;

    const buffer = new Float32Array(256);
    const lastHeard = new Map<string, number>();

    /** Volumen medio ahora mismo, o -1 si no se puede medir. */
    const levelOf = (analyser: AnalyserNode | null): number => {
      if (!analyser) return -1;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      return Math.sqrt(sum / buffer.length);
    };

    const mark = (id: string, level: number, now: number, loud: Set<string>) => {
      if (level < 0) return;
      if (level > SPEAKING_THRESHOLD) lastHeard.set(id, now);
      if (now - (lastHeard.get(id) ?? 0) < SPEAKING_DECAY_MS) loud.add(id);
    };

    const timer = setInterval(() => {
      const now = Date.now();
      const loud = new Set<string>();
      for (const [id, peer] of peers.current) mark(id, levelOf(peer.analyser), now, loud);

      const own = levelOf(localAnalyser.current);
      // Silenciado no debería figurar como hablando.
      if (!muted) mark(youId, own, now, loud);

      // Silencio absoluto sostenido es el clásico "yo los escucho pero ellos a
      // mí no": el micrófono figura abierto y no manda nada.
      if (muted || own < 0 || own > DEAD_MIC_LEVEL) {
        quietSince.current = now;
      } else if (!warnedQuiet.current && now - quietSince.current > DEAD_MIC_MS) {
        warnedQuiet.current = true;
        const message = localStream.current?.getAudioTracks().some((track) => track.muted)
          ? MUTED_BY_SYSTEM
          : 'Hace rato que no entra nada por tu micrófono: nadie te está escuchando. Probalo desde el menú ⋯ → Probar mi micrófono.';
        setError(message);
        notify('error', message);
      }

      setSpeaking((prev) => {
        if (prev.size === loud.size && [...loud].every((id) => prev.has(id))) return prev;
        return loud;
      });
    }, 120);

    return () => clearInterval(timer);
  }, [active, muted, youId, notify]);

  // --------------------------------------------------- señalización entrante

  useEffect(() => {
    if (!socket) return;

    const onPeerJoined = (peer: VoicePeer) => {
      // El recién llegado es el que ofrece: acá solo avisamos y esperamos.
      if (!activeRef.current || peer.playerId === youId) return;
      notify('info', `${peer.name} se sumó al audio`);
    };

    const onPeerLeft = ({ playerId }: { playerId: string }) => dropPeer(playerId);

    const onSignal = async ({ from, data }: { from: string; data: unknown }) => {
      if (!activeRef.current) return;
      const message = data as
        | { kind: 'offer'; sdp: RTCSessionDescriptionInit; restart?: boolean }
        | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
        | { kind: 'ice'; candidate: RTCIceCandidateInit };

      try {
        if (message.kind === 'offer') {
          // Con `restart` es el mismo par rehaciendo el camino: se conserva la
          // conexión y se renegocia. Sin `restart` es alguien que entra o que
          // volvió de una caída, y ahí la conexión vieja se tira.
          if (peers.current.has(from) && !message.restart) dropPeer(from);
          const connection = ensurePeer(from);
          await connection.pc.setRemoteDescription(message.sdp);
          const answer = await connection.pc.createAnswer();
          await connection.pc.setLocalDescription(answer);
          await request(socket, 'voice:signal', {
            to: from,
            data: { kind: 'answer', sdp: connection.pc.localDescription },
          });
          return;
        }

        const peer = peers.current.get(from);
        if (!peer) return;

        if (message.kind === 'answer') {
          await peer.pc.setRemoteDescription(message.sdp);
        } else if (message.kind === 'ice') {
          await peer.pc.addIceCandidate(message.candidate);
        }
      } catch {
        // Una negociación fallida con un par no debe romper el resto.
      }
    };

    socket.on('voice:peer-joined', onPeerJoined);
    socket.on('voice:peer-left', onPeerLeft);
    socket.on('voice:signal', onSignal);

    return () => {
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('voice:peer-left', onPeerLeft);
      socket.off('voice:signal', onSignal);
    };
  }, [socket, youId, ensurePeer, dropPeer, notify]);

  // Al desmontar: soltar micrófono y conexiones sí o sí.
  useEffect(() => {
    const open = peers.current;
    return () => {
      for (const peer of open.values()) {
        peer.pc.close();
        peer.audio.remove();
      }
      open.clear();
      for (const track of localStream.current?.getTracks() ?? []) track.stop();
      void audioContext.current?.close().catch(() => {});
    };
  }, []);

  return {
    active,
    muted,
    connecting,
    speaking,
    participants,
    unreachable,
    error,
    start,
    stop,
    toggleMute,
    test,
  };
}

function describeMicError(caught: unknown): string {
  if (!(caught instanceof Error)) return 'No se pudo activar el micrófono';
  switch (caught.name) {
    case 'NotAllowedError':
      return 'Bloqueaste el micrófono. Habilitalo desde el candado de la barra de direcciones.';
    case 'NotFoundError':
      return 'No encontramos ningún micrófono conectado';
    case 'NotReadableError':
      return 'Otra aplicación está usando el micrófono';
    default:
      return caught.message;
  }
}

