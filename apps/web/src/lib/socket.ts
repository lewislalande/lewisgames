import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ClientMsg, DrawOp, ServerMsg } from '@kg/shared';
import { getToken } from './identity';

export type StateMsg = Extract<ServerMsg, { t: 'state' }>;
export type PictionaryStateMsg = Extract<StateMsg, { kind: 'pictionary' }>;
type Status = 'connecting' | 'open' | 'closed';

export type RoomSocket = {
  status: Status;
  playerId: string | null;
  state: StateMsg | null;
  send(m: ClientMsg): void;
  onDraw(cb: (op: DrawOp) => void): () => void;
  onNotice(cb: (n: 'close' | 'correct') => void): () => void;
  error: string | null;
};

/** Errors after which the server closed the socket for good; the others (bad_message, no_questions, internal) are not. */
const FATAL_ERRORS: readonly string[] = ['room_full', 'bad_name', 'bad_token', 'not_found'];

const backoff = (attempt: number) => Math.min(10_000, 1000 * 2 ** attempt);
/** After this many failed connections in a row with none ever opened, ask the API if the room exists. */
const PROBE_AFTER = 3;

export function useRoomSocket(code: string, name: string): RoomSocket {
  const [status, setStatus] = useState<Status>('connecting');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<StateMsg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const drawCbs = useRef(new Set<(op: DrawOp) => void>());
  const noticeCbs = useRef(new Set<(n: 'close' | 'correct') => void>());

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fatal = false;
    let everOpened = false;
    let failures = 0;
    let probing = false;
    setStatus('connecting');
    setError(null);
    setState(null);
    setPlayerId(null);

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        everOpened = true;
        failures = 0;
        // Committed on its own, before any state of this connection (DrawingCanvas relies on it).
        flushSync(() => setStatus('open'));
        ws.send(JSON.stringify({ t: 'hello', token: getToken(), name } satisfies ClientMsg));
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        switch (m.t) {
          case 'welcome': setPlayerId(m.playerId); break;
          // Commit synchronously so state-driven resyncs (layout effects) run before the
          // next message, e.g. a draw relay, is handled.
          case 'state': flushSync(() => setState(m)); break;
          case 'draw': drawCbs.current.forEach((cb) => cb(m.op)); break;
          case 'notice': noticeCbs.current.forEach((cb) => cb(m.notice)); break;
          case 'error':
            if (FATAL_ERRORS.includes(m.code)) { fatal = true; setError(m.code); }
            break;
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        setStatus('closed');
        if (fatal) return;
        if (!everOpened && ++failures >= PROBE_AFTER && !probing) {
          probing = true;
          void probe().finally(() => { probing = false; });
        }
        timer = setTimeout(() => {
          if (disposed || fatal) return;
          setStatus('connecting');
          connect();
        }, backoff(attempt++));
      };
    };

    // The worker 404s the socket of a room it cannot route; the HTTP API tells "gone" apart from "down".
    const probe = async () => {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
        if (res.status !== 404 || disposed) return;
        fatal = true;
        clearTimeout(timer);
        setError('not_found');
      } catch {
        // Offline: keep retrying.
      }
    };
    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, name]);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  const onDraw = useCallback((cb: (op: DrawOp) => void) => {
    drawCbs.current.add(cb);
    return () => { drawCbs.current.delete(cb); };
  }, []);
  const onNotice = useCallback((cb: (n: 'close' | 'correct') => void) => {
    noticeCbs.current.add(cb);
    return () => { noticeCbs.current.delete(cb); };
  }, []);

  return { status, playerId, state, send, onDraw, onNotice, error };
}
