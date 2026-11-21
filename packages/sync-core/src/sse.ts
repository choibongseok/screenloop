import type { StateEvent } from './types';

/** 브라우저 EventSource 중 우리가 쓰는 부분. 시험에서는 가짜로 바꿔 끼운다. */
export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  addEventListener(type: string, listener: (ev: { data: string }) => void): void;
  close(): void;
}

export interface StreamHandlers {
  onEvent(ev: StateEvent): void;
  onOpen(): void;
  onError(): void;
}

export interface StreamOptions {
  /** 이 시간 동안 아무 메시지(이벤트·하트비트)도 없으면 끊긴 것으로 본다. 서버는 5초마다 hb 를 보낸다. */
  watchdogMs?: number;
  create?: (url: string) => EventSourceLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * 서버가 보내는 이벤트 스트림(SSE)을 연다. 연결이 한쪽에서만 끊겨(반쯤 열린 연결) 오류 알림이 안 오는 경우를 위해,
 * 서버 하트비트(hb)가 일정 시간 안 오면 스스로 닫고 onError 를 부른다.
 */
export function openEventStream(url: string, h: StreamHandlers, opts: StreamOptions = {}): () => void {
  const create = opts.create ?? ((u: string) => new EventSource(u) as unknown as EventSourceLike);
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const watchdogMs = opts.watchdogMs ?? 15_000;
  const es = create(url);
  let timer: unknown = null;
  let closed = false;
  const fail = () => {
    if (closed) return;
    close();
    h.onError();
  };
  const arm = () => {
    if (timer) clearTimer(timer);
    timer = setTimer(fail, watchdogMs);
  };
  const close = () => {
    closed = true;
    if (timer) clearTimer(timer);
    es.close();
  };
  es.onopen = () => { arm(); h.onOpen(); };
  es.addEventListener('hb', () => arm());
  es.addEventListener('state', (m) => {
    arm();
    try { h.onEvent(JSON.parse(m.data) as StateEvent); } catch { /* 깨진 메시지는 버린다. 빠진 버전은 Replica 가 스냅샷으로 메운다 */ }
  });
  es.onerror = fail;
  arm();
  return close;
}
