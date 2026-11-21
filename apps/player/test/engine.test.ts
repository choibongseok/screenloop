import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAuthority, RecordLedger, type Command, type StateEvent, type Transport } from '@screenloop/sync-core';
import { PlayerEngine } from '../src/engine';

const T0 = Date.UTC(2026, 10, 21, 0, 0, 0);
let n = 0;
const c = (o: object) => ({ commandId: `p${++n}`, ...o }) as Command;
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

/** 서버 흉내(권한자 + 기록 수집 장치). 서버 시계는 가짜 타이머의 Date.now() 를 쓴다. */
class FakeServer {
  auth = new DeviceAuthority('d-1');
  ledger = new RecordLedger();
  handlers: { onEvent(ev: StateEvent): void; onOpen(): void; onError(): void } | null = null;
  down = false;
  loseReplies = 0; // 서버는 기록을 받았는데 응답이 유실되는 횟수
  constructor() {
    this.auth.submit(c({ type: 'schedule.replace', baseScheduleVersion: 0, items: [
      { id: 'a', title: 'A', sceneId: 'aurora', durationSec: 10 },
      { id: 'b', title: 'B', sceneId: 'waves', durationSec: 20 },
    ] }), Date.now(), 'seed');
  }
  command(cmd: Command) { const r = this.auth.submit(cmd, Date.now(), 'op'); if (r.event) this.handlers?.onEvent(r.event); return r; }
  drop() { this.down = true; this.handlers?.onError(); }
  transport(): Transport {
    return {
      fetchSnapshot: async () => { if (this.down) throw new Error('offline'); return { state: structuredClone(this.auth.state), serverTimeMs: Date.now() }; },
      open: (after, h) => {
        this.handlers = h;
        // 서버는 Last-Event-ID 이후 이벤트를 먼저 보낸다
        queueMicrotask(() => { if (this.down) return; h.onOpen(); for (const e of this.auth.eventsAfter(after)) h.onEvent(e); });
        return () => { if (this.handlers === h) this.handlers = null; };
      },
    };
  }
  post = async (deviceId: string, batch: { clockOffsetMs: number; records: never[] }) => {
    if (this.down) throw new Error('offline');
    const r = this.ledger.ingest(deviceId, batch.clockOffsetMs, batch.records, Date.now());
    if (this.loseReplies > 0) { this.loseReplies--; throw new Error('reply lost'); }
    return r;
  };
}

function make(s: FakeServer, skew = 0) {
  return new PlayerEngine({ deviceId: 'd-1', store: new Mem(), now: () => Date.now() + skew, flushMs: 5000, transport: s.transport(), post: (b) => s.post('d-1', b as never) });
}
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('PlayerEngine: 재생 기록 만들기·보내기', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => vi.useRealTimers());

  it('항목이 바뀐 시각을 경계로 빠짐없이 이어지는 재생 기록을 만든다', async () => {
    const s = new FakeServer();
    const e = make(s);
    e.start(); await run(100);
    await run(65_000);
    await e.flush();
    const rows = s.ledger.rows.slice().sort((x, y) => x.seq - y.seq);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // 이어 붙으면 틈이 없다: 앞 기록의 끝 = 다음 기록의 시작
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.startedAtMs).toBe(rows[i - 1]!.endedAtMs);
    // 첫 기록(플레이어를 켠 시점부터)을 빼면 모든 기록의 길이가 항목 길이(a 10초, b 20초)와 정확히 같다
    for (const r of rows.slice(1)) expect(r.endedAtMs - r.startedAtMs).toBe(r.itemId === 'a' ? 10_000 : 20_000);
    e.stop();
  });

  it('응답이 유실돼 같은 기록을 다시 보내도 서버에는 한 번만 쌓이고, 받았다는 번호로 대기열을 비운다', async () => {
    const s = new FakeServer();
    s.loseReplies = 1;
    const e = make(s);
    e.start(); await run(100);
    await run(45_000); // 기록 3~4건이 쌓이고 첫 전송은 응답이 유실됨
    await e.flush();
    const stored = s.ledger.rows.length;
    expect(e.stats.flushFailures).toBeGreaterThanOrEqual(1);
    expect(e.stats.duplicatesReported).toBeGreaterThanOrEqual(1);
    await e.flush();
    expect(s.ledger.rows.length).toBeGreaterThanOrEqual(stored);
    expect(new Set(s.ledger.rows.map((r) => r.seq)).size).toBe(s.ledger.rows.length);
    expect(e.queue.size).toBe(0);
    e.stop();
  });

  it('끊긴 동안에도 마지막 편성으로 계속 재생하며 기록을 쌓고, 다시 붙으면 한꺼번에 보낸다', async () => {
    const s = new FakeServer();
    const e = make(s);
    e.start(); await run(100);
    s.drop();
    await run(60_000); // 1분 동안 오프라인
    expect(e.client.connection).toBe('offline');
    expect(e.queue.size).toBeGreaterThanOrEqual(2);
    expect(s.ledger.rows.length).toBe(0);
    const queued = e.queue.size;
    s.down = false;
    await run(8_000); // 재연결 + 전송
    expect(e.client.connection).toBe('online');
    expect(s.ledger.rows.length).toBeGreaterThanOrEqual(queued);
    expect(e.queue.size).toBeLessThanOrEqual(1);
    e.stop();
  });

  it('일시정지 중과 긴급 공지가 덮는 동안은 재생 기록을 쌓지 않는다', async () => {
    const s = new FakeServer();
    const e = make(s);
    e.start(); await run(100);
    s.command(c({ type: 'playback.pause' })); await run(100);
    const total = () => s.ledger.rows.length + e.queue.size; // 보낸 것과 아직 대기 중인 것의 합
    const before = total();
    await run(30_000);
    expect(total()).toBe(before); // 멈춘 동안 새 기록 없음
    s.command(c({ type: 'playback.resume' })); await run(100);
    s.command(c({ type: 'override.set', text: '긴급', durationSec: 60 })); await run(100);
    const mid = total();
    await run(30_000);
    expect(total()).toBe(mid);
    e.stop();
  });

  it('기기 시계가 90초 빨라도 오프셋을 같이 보내 서버 시각으로 맞춘 기록이 정확하다', async () => {
    const s = new FakeServer();
    const e = make(s, 90_000);
    e.start(); await run(100);
    await run(40_000);
    await e.flush();
    expect(s.ledger.rows.length).toBeGreaterThan(0);
    for (const r of s.ledger.rows) {
      expect(r.status).toBe('accepted');
      expect(Math.abs(r.serverStartedAtMs - (r.startedAtMs - 90_000))).toBeLessThanOrEqual(1);
      expect(r.serverEndedAtMs).toBeLessThanOrEqual(Date.now() + 1);
    }
    e.stop();
  });
});
