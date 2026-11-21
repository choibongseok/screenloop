import { describe, expect, it } from 'vitest';
import { PlayTracker, RecordLedger, RecordQueue } from '../src/index';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('재생 기록 대기열과 중복 방지', () => {
  it('새로고침해도 일련번호가 이어지고, 받았다는 알림(ackSeq) 전에는 지우지 않는다', () => {
    const store = new MemStore();
    const q1 = new RecordQueue(store, 'q');
    q1.append('i1', 1000, 2000);
    q1.append('i2', 2000, 3000);
    const q2 = new RecordQueue(store, 'q'); // 새로고침
    expect(q2.pending().map((r) => r.seq)).toEqual([1, 2]);
    expect(q2.append('i3', 3000, 4000)).toBe(3);
    q2.ack(2);
    expect(q2.pending().map((r) => r.seq)).toEqual([3]);
  });

  it('응답을 못 받아 같은 배치를 다시 보내도 서버에는 한 번만 쌓인다', () => {
    const q = new RecordQueue(new MemStore(), 'q');
    const ledger = new RecordLedger();
    const now = Date.UTC(2026, 10, 21, 3, 0, 0);
    for (let i = 0; i < 5; i++) q.append('i1', now - 100_000 + i * 1000, now - 99_000 + i * 1000);
    ledger.ingest('d-1', 0, q.pending(), now); // 응답이 유실돼 ack 를 못 받았다고 가정
    const retry = ledger.ingest('d-1', 0, q.pending(), now + 3000);
    expect(retry).toEqual({ accepted: 0, duplicates: 5, quarantined: 0, ackSeq: 5 });
    expect(ledger.rows).toHaveLength(5);
    q.ack(retry.ackSeq);
    expect(q.size).toBe(0);
  });

  it('PlayTracker 는 항목이 바뀔 때마다 지나간 항목의 기록을 낸다', () => {
    const out: [string, number, number][] = [];
    const t = new PlayTracker((id, s, e) => out.push([id, s, e]));
    t.observe('i1', 1000);
    t.observe('i1', 5000);
    t.observe('i2', 11_000);
    t.observe(null, 20_000);
    t.observe('i3', 21_000);
    expect(out).toEqual([
      ['i1', 1000, 11_000],
      ['i2', 11_000, 20_000],
    ]);
  });

  it('관측이 늦어도 항목이 실제로 바뀐 시각(boundary)으로 끊는다', () => {
    const out: [string, number, number][] = [];
    const t = new PlayTracker((id, s, e) => out.push([id, s, e]));
    t.observe('i1', 0);
    t.observe('i2', 10_400, 10_000); // 10초에 바뀌었는데 10.4초에 알아챔
    t.observe('i3', 31_000, 30_000);
    expect(out).toEqual([
      ['i1', 0, 10_000],
      ['i2', 10_000, 30_000],
    ]);
    expect(t.activeStartMs).toBe(30_000);
  });

  it('한 항목만 계속 돌아도 maxSegmentMs 마다 기록을 낸다', () => {
    const out: [string, number, number][] = [];
    const t = new PlayTracker((id, s, e) => out.push([id, s, e]), 60_000);
    for (let ms = 0; ms <= 150_000; ms += 5_000) t.observe('only', ms);
    expect(out).toEqual([
      ['only', 0, 60_000],
      ['only', 60_000, 120_000],
    ]);
  });
});
