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
}

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
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  toggleMute(): void;
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
  const [error, setError] = useState<string | null>(null);

  const localStream = useRef<MediaStream | null>(null);
  const localAnalyser = useRef<AnalyserNode | null>(null);
  const peers = useRef(new Map<string, PeerConnection>());
  const iceConfig = useRef<IceConfig | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const activeRef = useRef(false);
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

      const peer: PeerConnection = { pc, audio, stream, analyser: null, name: nameRef.current(playerId) };
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

      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return;
        // Casi siempre es NAT estricto (datos móviles) sin TURN disponible.
        notify(
          'error',
          iceConfig.current?.hasTurn
            ? `Se cortó el audio con ${peer.name}`
            : `No se pudo conectar el audio con ${peer.name}: falta un servidor TURN.`,
        );
        dropPeer(playerId);
      };

      setParticipants((prev) => new Set(prev).add(playerId));
      return peer;
    },
    [socket, notify, dropPeer, makeAnalyser],
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
    if (socket) void request(socket, 'voice:leave').catch(() => {});
  }, [socket, dropPeer]);

  const start = useCallback(async () => {
    if (!socket || activeRef.current) return;
    setConnecting(true);
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          window.isSecureContext
            ? 'Tu navegador no permite usar el micrófono'
            : 'El micrófono necesita HTTPS. Abrilo con https:// o desde localhost.',
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      localStream.current = stream;
      localAnalyser.current = makeAnalyser(stream);

      iceConfig.current = await request<IceConfig>(socket, 'voice:config');

      // El que llega ofrece a todos los que ya estaban: un único iniciador
      // por par, sin riesgo de ofertas cruzadas.
      const existing = await request<VoicePeer[]>(socket, 'voice:join');
      activeRef.current = true;
      setActive(true);
      setParticipants(new Set([youId]));

      for (const remote of existing) {
        const connection = ensurePeer(remote.playerId);
        connection.name = remote.name;
        const offer = await connection.pc.createOffer();
        await connection.pc.setLocalDescription(offer);
        await request(socket, 'voice:signal', {
          to: remote.playerId,
          data: { kind: 'offer', sdp: connection.pc.localDescription },
        });
      }
    } catch (caught) {
      const message = describeMicError(caught);
      setError(message);
      notify('error', message);
      stop();
    } finally {
      setConnecting(false);
    }
  }, [socket, youId, ensurePeer, makeAnalyser, notify, stop]);

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

    const measure = (id: string, analyser: AnalyserNode | null, now: number, loud: Set<string>) => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      if (Math.sqrt(sum / buffer.length) > SPEAKING_THRESHOLD) lastHeard.set(id, now);
      if (now - (lastHeard.get(id) ?? 0) < SPEAKING_DECAY_MS) loud.add(id);
    };

    const timer = setInterval(() => {
      const now = Date.now();
      const loud = new Set<string>();
      for (const [id, peer] of peers.current) measure(id, peer.analyser, now, loud);
      // Silenciado no debería figurar como hablando.
      if (!muted) measure(youId, localAnalyser.current, now, loud);

      setSpeaking((prev) => {
        if (prev.size === loud.size && [...loud].every((id) => prev.has(id))) return prev;
        return loud;
      });
    }, 120);

    return () => clearInterval(timer);
  }, [active, muted, youId]);

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
        | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
        | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
        | { kind: 'ice'; candidate: RTCIceCandidateInit };

      try {
        if (message.kind === 'offer') {
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
    error,
    start,
    stop,
    toggleMute,
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

