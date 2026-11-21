import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openEventStream, type EventSourceLike, type StateEvent } from '../src/index';

class FakeES implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  private l = new Map<string, (ev: { data: string }) => void>();
  addEventListener(type: string, fn: (ev: { data: string }) => void) { this.l.set(type, fn); }
  close() { this.closed = true; }
  emit(type: string, data: string) { this.l.get(type)?.({ data }); }
}
const ev = (v: number): StateEvent => ({ type: 'volume.changed', deviceId: 'd', version: v, serverTimeMs: 1, actor: 'a', volume: 10 });

describe('openEventStream: 이벤트 스트림과 하트비트 감시', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('state 메시지는 이벤트로 넘기고, 깨진 메시지는 버린다', () => {
    const es = new FakeES();
    const got: number[] = [];
    openEventStream('/s', { onEvent: (e) => got.push(e.version), onOpen: () => undefined, onError: () => undefined }, { create: () => es });
    es.emit('state', JSON.stringify(ev(1)));
    es.emit('state', '{깨짐');
    es.emit('state', JSON.stringify(ev(2)));
    expect(got).toEqual([1, 2]);
  });

  it('하트비트가 오는 동안은 유지하고, 15초 동안 아무것도 안 오면 끊긴 것으로 보고 닫는다', async () => {
    const es = new FakeES();
    let errors = 0;
    openEventStream('/s', { onEvent: () => undefined, onOpen: () => undefined, onError: () => errors++ }, { create: () => es });
    es.onopen?.({});
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(5000); es.emit('hb', 'hb'); }
    expect(errors).toBe(0);
    await vi.advanceTimersByTimeAsync(15_100); // 반쯤 열린 연결: 오류 알림 없이 조용해짐
    expect(errors).toBe(1);
    expect(es.closed).toBe(true);
  });

  it('직접 닫으면 감시 타이머도 멈춰 오류를 부르지 않는다', async () => {
    const es = new FakeES();
    let errors = 0;
    const close = openEventStream('/s', { onEvent: () => undefined, onOpen: () => undefined, onError: () => errors++ }, { create: () => es });
    close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toBe(0);
  });

  it('브라우저가 오류를 알리면 즉시 닫고 onError 를 한 번만 부른다', () => {
    const es = new FakeES();
    let errors = 0;
    openEventStream('/s', { onEvent: () => undefined, onOpen: () => undefined, onError: () => errors++ }, { create: () => es });
    es.onerror?.({});
    es.onerror?.({});
    expect(errors).toBe(1);
    expect(es.closed).toBe(true);
  });
});
