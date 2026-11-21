import type { PlayRecordInput } from './types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 기기 안에 쌓는 재생 기록 대기열. 일련번호는 저장소에 남겨서 새로고침해도 이어지고,
 * 서버가 ackSeq 로 받았다고 알려 줄 때까지 지우지 않는다. 그래서 다시 보내도 안전하다(서버가 seq 로 중복을 거른다).
 */
export class RecordQueue {
  private rows: PlayRecordInput[] = [];
  private nextSeq = 1;

  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
  ) {
    try {
      const raw = store.getItem(key);
      if (raw) {
        const v = JSON.parse(raw) as { rows: PlayRecordInput[]; nextSeq: number };
        this.rows = v.rows;
        this.nextSeq = v.nextSeq;
      }
    } catch {
      /* 저장소가 비었거나 깨졌으면 빈 대기열로 시작 */
    }
  }

  get size(): number {
    return this.rows.length;
  }

  append(itemId: string, startedAtMs: number, endedAtMs: number): number {
    const seq = this.nextSeq++;
    this.rows.push({ seq, itemId, startedAtMs, endedAtMs });
    this.save();
    return seq;
  }

  pending(max = 500): PlayRecordInput[] {
    return this.rows.slice(0, max);
  }

  ack(ackSeq: number): void {
    this.rows = this.rows.filter((r) => r.seq > ackSeq);
    this.save();
  }

  private save(): void {
    try {
      this.store.setItem(this.key, JSON.stringify({ rows: this.rows, nextSeq: this.nextSeq }));
    } catch {
      /* 저장 실패는 다음 저장 때 다시 시도 */
    }
  }
}

/**
 * 재생 중인 항목이 바뀌는 순간마다 지나간 항목의 기록을 만든다. 시각은 기기 시계(서버 시각으로 맞추는 것은 서버 몫).
 * 한 항목만 계속 도는 경우에도 기록이 쌓이도록 maxSegmentMs 마다 끊어서 낸다.
 * boundaryMs 는 항목이 실제로 바뀐 시각이다(관측이 늦었을 때 "지금"이 아니라 경계로 끊는다).
 */
export class PlayTracker {
  private current: { itemId: string; startedAtMs: number } | null = null;
  constructor(
    private readonly emit: (itemId: string, startedAtMs: number, endedAtMs: number) => void,
    private readonly maxSegmentMs = 10 * 60 * 1000,
  ) {}

  get active(): boolean {
    return this.current !== null;
  }
  get activeStartMs(): number {
    return this.current?.startedAtMs ?? 0;
  }

  observe(itemId: string | null, localMs: number, boundaryMs: number = localMs): void {
    const cur = this.current;
    if (cur && cur.itemId === itemId) {
      if (localMs - cur.startedAtMs >= this.maxSegmentMs) {
        this.emit(cur.itemId, cur.startedAtMs, localMs);
        this.current = { itemId: cur.itemId, startedAtMs: localMs };
      }
      return;
    }
    const at = cur ? Math.max(cur.startedAtMs, Math.min(boundaryMs, localMs)) : localMs;
    if (cur && at > cur.startedAtMs) this.emit(cur.itemId, cur.startedAtMs, at);
    this.current = itemId ? { itemId, startedAtMs: at } : null;
  }

  /** 일시정지·화면 종료처럼 재생이 멈출 때 지금까지를 끊는다 */
  stop(localMs: number): void {
    this.observe(null, localMs);
  }
}
