// 시험 전용 서버 흉내. 실제 서버(Kotlin)의 판정·수집 규칙과 같은지는 공유 벡터와 kotlin-js.test.ts 로 따로 확인한다.
import { decide, initialState, reduce } from '../src/index';
import type { Command, CommandResult, DeviceState, PlayRecordInput, PlayRecordResult, StateEvent } from '../src/index';

/** 한 화면의 서버 흉내: 이벤트 로그, 현재 상태, commandId 중복 방지. */
export class DeviceAuthority {
  state: DeviceState;
  readonly log: StateEvent[] = [];
  private readonly seen = new Map<string, CommandResult>();

  constructor(deviceId: string, state?: DeviceState) {
    this.state = state ?? initialState(deviceId);
  }

  submit(cmd: Command, nowMs: number, actor: string): CommandResult {
    const prev = this.seen.get(cmd.commandId);
    if (prev) return { ...prev, replayed: true };
    const d = decide(this.state, cmd, nowMs);
    let out: CommandResult;
    if (d.result === 'accepted') {
      const event = { ...d.event, deviceId: this.state.deviceId, version: this.state.version + 1, serverTimeMs: nowMs, actor } as StateEvent;
      this.state = reduce(this.state, event);
      this.log.push(event);
      out = { result: 'accepted', version: this.state.version, replayed: false, event };
    } else {
      out = { result: 'rejected', reason: d.reason, version: this.state.version, replayed: false };
    }
    this.seen.set(cmd.commandId, out);
    return out;
  }

  eventsAfter(version: number): StateEvent[] {
    return this.log.filter((e) => e.version > version);
  }
}

/** 재생 기록 한 건을 검사하는 기준. 서버(Kotlin)도 같은 값을 쓴다(spec/vectors/records-ingest.json 으로 확인). */
export const MAX_RECORD_MS = 6 * 3600 * 1000;
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type Quarantine = 'non_positive' | 'too_long' | 'in_future';
export interface Classified {
  status: 'accepted' | 'quarantined';
  reason: Quarantine | null;
}

export function classifyRecord(rec: PlayRecordInput, clockOffsetMs: number, receivedAtMs: number): Classified {
  if (rec.endedAtMs <= rec.startedAtMs) return { status: 'quarantined', reason: 'non_positive' };
  if (rec.endedAtMs - rec.startedAtMs > MAX_RECORD_MS) return { status: 'quarantined', reason: 'too_long' };
  if (rec.endedAtMs + clockOffsetMs > receivedAtMs + FUTURE_TOLERANCE_MS) return { status: 'quarantined', reason: 'in_future' };
  return { status: 'accepted', reason: null };
}

export interface StoredRecord extends PlayRecordInput {
  deviceId: string;
  status: Classified['status'];
  reason: Quarantine | null;
  receivedAtMs: number;
  serverStartedAtMs: number;
  serverEndedAtMs: number;
}

/** 수집 장치 흉내. (deviceId, seq) 가 같은 기록은 처음 것만 남긴다. */
export class RecordLedger {
  readonly rows: StoredRecord[] = [];
  private readonly keys = new Set<string>();
  private readonly ack = new Map<string, number>();

  ingest(deviceId: string, clockOffsetMs: number, records: PlayRecordInput[], receivedAtMs: number): PlayRecordResult {
    let accepted = 0,
      duplicates = 0,
      quarantined = 0;
    for (const r of records) {
      const key = `${deviceId}#${r.seq}`;
      if (this.keys.has(key)) {
        duplicates++;
        continue;
      }
      this.keys.add(key);
      const c = classifyRecord(r, clockOffsetMs, receivedAtMs);
      this.rows.push({
        ...r,
        deviceId,
        status: c.status,
        reason: c.reason,
        receivedAtMs,
        serverStartedAtMs: r.startedAtMs + clockOffsetMs,
        serverEndedAtMs: r.endedAtMs + clockOffsetMs,
      });
      if (c.status === 'accepted') accepted++;
      else quarantined++;
      this.ack.set(deviceId, Math.max(this.ack.get(deviceId) ?? 0, r.seq));
    }
    return { accepted, duplicates, quarantined, ackSeq: this.ack.get(deviceId) ?? 0 };
  }
}
