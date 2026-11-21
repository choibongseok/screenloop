import { decide } from './authority';
import { ClockSync } from './clock';
import { nowPlaying, overrideActive, type NowPlaying } from './playback';
import { Replica } from './replica';
import { reduce } from './reducer';
import type { Command, CommandResult, DeviceState, Snapshot, StateEvent } from './types';

/** 네트워크 계층. 브라우저에서는 fetch·EventSource, 데모 사이트에서는 브라우저 안의 가짜 서버가 이 모양을 맞춘다. */
export interface Transport {
  fetchSnapshot(): Promise<Snapshot>;
  /** afterVersion 이후의 이벤트를 받기 시작한다. 반환값은 연결을 닫는 함수. */
  open(afterVersion: number, h: { onEvent(ev: StateEvent): void; onOpen(): void; onError(): void }): () => void;
  sendCommand?(cmd: Command): Promise<CommandResult>;
}

export type Connection = 'connecting' | 'online' | 'offline';

export interface ClientOptions {
  /** 기기 시계(ms). 시계가 틀린 기기를 흉내 낼 때 바꿔 끼운다. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  backoffMs?: number[];
}

interface Pending {
  id: string;
  cmd: Command;
}

/**
 * 한 화면의 상태를 따라오는 클라이언트(웹 콘솔·휴대폰 리모컨·플레이어 공통).
 *  - 시작: 스냅샷 → 이벤트 스트림. 스냅샷을 받을 때마다 기기와 서버의 시계 차이를 다시 잰다.
 *  - 이벤트가 중간에 빠지면(hasGap) 스냅샷을 다시 받는다. 끊기면 마지막 상태로 계속 보이고, 다시 붙을 때 스냅샷으로 따라잡는다.
 *  - 조작(send)은 서버 판정을 기다리지 않고 같은 판정 규칙(decide)을 지역에서 먼저 적용해 보여 주고(낙관적 갱신),
 *    서버가 거절하면 덮어쓴 것을 걷어낸다. 서버가 받아들였으면 이벤트가 스트림으로 와서 확정된다.
 */
export class DeviceClient {
  private replica: Replica | null = null;
  private clock = new ClockSync();
  private closeStream: (() => void) | null = null;
  private pending: Pending[] = [];
  private listeners = new Set<() => void>();
  private retryTimer: unknown = null;
  private gapTimer: unknown = null;
  private attempt = 0;
  private stopped = true;
  private gen = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly backoff: number[];
  connection: Connection = 'connecting';
  readonly stats = { snapshots: 0, reconnects: 0, rejected: 0 };

  constructor(private readonly transport: Transport, opts: ClientOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.backoff = opts.backoffMs ?? [500, 1000, 2000, 4000];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** 서버가 확정한 상태 */
  get confirmed(): DeviceState | null {
    return this.replica?.state ?? null;
  }

  /** 화면에 보여 줄 상태: 확정 상태 위에 아직 서버 답이 없는 조작을 지역 판정으로 얹은 것 */
  get view(): DeviceState | null {
    let s = this.confirmed;
    if (!s) return null;
    for (const p of this.pending) {
      const d = decide(s, p.cmd, this.serverNow());
      if (d.result === 'accepted') s = reduce(s, { ...d.event, deviceId: s.deviceId, version: s.version + 1, serverTimeMs: this.serverNow(), actor: 'local' } as StateEvent);
    }
    return s;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  get replicaStats() {
    return this.replica?.stats ?? { applied: 0, duplicates: 0, buffered: 0, snapshots: 0 };
  }

  get clockOffsetMs(): number {
    return this.clock.offsetMs;
  }

  /** 서버 시각 추정값 */
  serverNow(): number {
    return this.clock.serverNow(this.now());
  }

  nowPlaying(): NowPlaying | null {
    const s = this.view;
    return s ? nowPlaying(s, this.serverNow()) : null;
  }

  overrideActive(): boolean {
    const s = this.view;
    return s ? overrideActive(s, this.serverNow()) : false;
  }

  start(): void {
    this.stopped = false;
    void this.connect(++this.gen);
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    this.closeStream?.();
    this.closeStream = null;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    if (this.gapTimer) this.clearTimer(this.gapTimer);
  }

  private async syncSnapshot(): Promise<void> {
    const t0 = this.now();
    const snap = await this.transport.fetchSnapshot();
    const t1 = this.now();
    this.clock.addSample(t0, snap.serverTimeMs, t1);
    this.stats.snapshots++;
    if (this.replica) this.replica.applySnapshot(snap.state);
    else this.replica = new Replica(snap.state);
  }

  /** g 는 start 때 매긴 번호. stop 이나 다시 start 가 있었으면 번호가 달라져서 늦게 도착한 이전 연결 시도는 버린다. */
  private async connect(g: number): Promise<void> {
    this.connection = this.replica ? 'offline' : 'connecting';
    this.closeStream?.();
    try {
      await this.syncSnapshot();
    } catch {
      if (g === this.gen) this.scheduleRetry();
      return;
    }
    if (this.stopped || g !== this.gen) return;
    this.closeStream = this.transport.open(this.replica!.version, {
      onOpen: () => { this.attempt = 0; this.connection = 'online'; this.emit(); },
      onEvent: (ev) => this.onEvent(ev),
      onError: () => { if (this.stopped || g !== this.gen) return; this.closeStream?.(); this.closeStream = null; this.connection = 'offline'; this.stats.reconnects++; this.emit(); this.scheduleRetry(); },
    });
    this.emit();
  }

  private scheduleRetry(): void {
    this.connection = 'offline';
    this.emit();
    if (this.stopped) return;
    const wait = this.backoff[Math.min(this.attempt++, this.backoff.length - 1)]!;
    const g = this.gen;
    this.retryTimer = this.setTimer(() => { if (g === this.gen) void this.connect(g); }, wait);
  }

  private onEvent(ev: StateEvent): void {
    if (!this.replica) return;
    this.replica.receive(ev);
    if (this.replica.hasGap && !this.gapTimer) {
      // 순서가 뒤바뀐 이벤트가 곧 올 수 있어 잠깐 기다린 뒤에도 비어 있으면 스냅샷을 받는다
      this.gapTimer = this.setTimer(async () => {
        this.gapTimer = null;
        if (this.replica?.hasGap) {
          try { await this.syncSnapshot(); } catch { /* 다음 이벤트나 재연결 때 다시 시도 */ }
          this.emit();
        }
      }, 150);
    }
    this.emit();
  }

  /** 조작 한 건. 지역 판정으로 먼저 보여 주고 서버 결과로 확정하거나 되돌린다. */
  async send(cmd: Command): Promise<CommandResult> {
    if (!this.transport.sendCommand) throw new Error('이 연결은 조작을 보낼 수 없다');
    const p: Pending = { id: cmd.commandId, cmd };
    this.pending.push(p);
    this.emit();
    try {
      const r = await this.transport.sendCommand(cmd);
      if (r.result === 'rejected') this.stats.rejected++;
      return r;
    } finally {
      this.pending = this.pending.filter((x) => x !== p);
      this.emit();
    }
  }
}
