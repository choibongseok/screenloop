import {
  DeviceAuthority,
  DeviceClient,
  PlayerEngine,
  RecordLedger,
  type Command,
  type CommandResult,
  type KeyValueStore,
  type PlayRecordBatch,
  type PlayRecordResult,
  type Snapshot,
  type StateEvent,
  type SyncTrace,
  type Transport,
} from '@screenloop/sync-core';

/** 가짜 서버가 쓰는 시계. speed 로 시간을 빠르게 돌릴 수 있다(항목이 바뀌는 속도와 재생 기록이 쌓이는 속도가 같이 빨라진다). */
export class SimClock {
  private realBase = performance.now();
  private simBase: number;
  speed = 1;
  constructor(start = Date.UTC(2026, 10, 21, 3, 0, 0)) {
    this.simBase = start;
  }
  now(): number {
    return Math.floor(this.simBase + (performance.now() - this.realBase) * this.speed);
  }
  setSpeed(s: number): void {
    this.simBase = this.now();
    this.realBase = performance.now();
    this.speed = s;
  }
}

export type RecvMode = 'normal' | 'reorder' | 'duplicate' | 'drop' | 'delay';
export const RECV_LABEL: Record<RecvMode, string> = { normal: '정상', reorder: '순서 뒤바뀜', duplicate: '중복', drop: '누락', delay: '지연' };

type Handlers = { onEvent(ev: StateEvent): void; onOpen(): void; onError(): void; onHeartbeat?(version: number): void };

/** 기기 하나와 가짜 서버 사이의 길. 끊기, 이벤트 순서 뒤바꿈·중복·누락·지연을 일부러 만든다. */
export class Channel {
  connected = true;
  mode: RecvMode = 'normal';
  private handlers: Handlers | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private held: StateEvent[] = [];
  private heldTimer: ReturnType<typeof setTimeout> | null = null;
  readonly counts = { delivered: 0, duplicated: 0, reordered: 0, dropped: 0, delayed: 0 };
  constructor(
    private readonly server: FakeServer,
    readonly latencyMs = 90,
  ) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  transport(canSend: boolean, actor: string): Transport {
    return {
      fetchSnapshot: async (): Promise<Snapshot> => {
        if (!this.connected) throw new Error('offline');
        await this.sleep(this.latencyMs / 2);
        const snap = this.server.snapshot(); // 서버 시각은 왕복의 한가운데에서 찍는다
        await this.sleep(this.latencyMs / 2);
        if (!this.connected) throw new Error('offline');
        return snap;
      },
      open: (after, h) => {
        if (!this.connected) {
          setTimeout(() => h.onError(), 50);
          return () => undefined;
        }
        this.handlers = h;
        setTimeout(() => {
          if (this.handlers !== h || !this.connected) return;
          h.onOpen();
          if (this.beat) clearInterval(this.beat);
          // 서버는 일정 간격으로 하트비트에 최신 버전을 실어 보낸다
          this.beat = setInterval(() => {
            if (this.handlers === h && this.connected) h.onHeartbeat?.(this.server.auth.state.version);
          }, 1500);
          for (const ev of this.server.auth.eventsAfter(after)) h.onEvent(ev); // Last-Event-ID 이후는 서버가 먼저 채워 준다
        }, this.latencyMs);
        return () => {
          if (this.handlers === h) this.handlers = null;
        };
      },
      sendCommand: canSend
        ? async (cmd: Command): Promise<CommandResult> => {
            if (!this.connected) throw new Error('offline');
            await this.sleep(this.latencyMs);
            return this.server.submit(cmd, actor);
          }
        : undefined,
    };
  }

  deliver(ev: StateEvent): void {
    const h = this.handlers;
    if (!this.connected || !h) return; // 끊긴 동안의 이벤트는 놓친다
    const send = (e: StateEvent, after: number) =>
      setTimeout(() => {
        if (this.handlers === h && this.connected) {
          this.counts.delivered++;
          h.onEvent(e);
        }
      }, after);
    switch (this.mode) {
      case 'normal':
        send(ev, this.latencyMs);
        break;
      case 'duplicate':
        send(ev, this.latencyMs);
        send(ev, this.latencyMs + 250);
        this.counts.duplicated++;
        break;
      case 'drop':
        if (ev.version % 2 === 0) this.counts.dropped++;
        else send(ev, this.latencyMs);
        break;
      case 'delay':
        this.counts.delayed++;
        send(ev, 1800);
        break;
      case 'reorder': {
        this.held.push(ev);
        const flush = () => {
          if (this.heldTimer) {
            clearTimeout(this.heldTimer);
            this.heldTimer = null;
          }
          const batch = this.held.splice(0).reverse(); // 모았다가 거꾸로 보낸다
          if (batch.length > 1) this.counts.reordered += batch.length;
          batch.forEach((e, i) => send(e, this.latencyMs + i * 30));
        };
        if (this.held.length >= 3) flush();
        else if (!this.heldTimer) this.heldTimer = setTimeout(flush, 1200);
        break;
      }
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.beat) {
      clearInterval(this.beat);
      this.beat = null;
    }
    const h = this.handlers;
    this.handlers = null;
    h?.onError();
  }
  connect(): void {
    this.connected = true;
  }
}

export interface LogLine {
  at: number;
  who: string;
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}

/** 서버 흉내: 서버 쪽 판정 규칙(sync-core 의 권한자)과 재생 기록 수집 장치를 브라우저 안에서 돌린다. */
export class FakeServer {
  readonly auth = new DeviceAuthority('d-demo');
  readonly ledger = new RecordLedger();
  readonly channels = new Map<string, Channel>();
  readonly commandLog: LogLine[] = [];
  duplicatesFiltered = 0;
  loseNextReply = false;
  repliesLost = 0;

  constructor(readonly clock: SimClock) {
    this.submit(
      {
        commandId: 'seed',
        type: 'schedule.replace',
        baseScheduleVersion: 0,
        items: [
          { id: 'welcome', title: '환영 인사', sceneId: 'aurora', durationSec: 8 },
          { id: 'menu', title: '오늘의 메뉴', sceneId: 'waves', durationSec: 12 },
          { id: 'event', title: '이벤트 안내', sceneId: 'grid', durationSec: 10 },
        ],
      },
      'system',
    );
  }

  snapshot(): Snapshot {
    return { state: structuredClone(this.auth.state), serverTimeMs: this.clock.now() };
  }

  submit(cmd: Command, actor: string): CommandResult {
    const r = this.auth.submit(cmd, this.clock.now(), actor);
    if (r.event && !r.replayed) for (const ch of this.channels.values()) ch.deliver(r.event);
    return r;
  }

  ingest(deviceId: string, batch: PlayRecordBatch): PlayRecordResult {
    const r = this.ledger.ingest(deviceId, batch.clockOffsetMs, batch.records, this.clock.now());
    this.duplicatesFiltered += r.duplicates;
    if (this.loseNextReply) {
      this.loseNextReply = false;
      this.repliesLost++;
      throw new Error('reply lost');
    } // 서버는 받았는데 응답이 유실
    return r;
  }
}

export class MemStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

export type DeviceKind = 'web' | 'phone' | 'tv' | 'pc';
export const KIND_LABEL: Record<DeviceKind, string> = { web: '운영 웹', phone: '휴대폰 리모컨', tv: 'TV 플레이어', pc: 'PC 플레이어' };

export interface SimDevice {
  kind: DeviceKind;
  label: string;
  recordId: string;
  skewMs: number;
  channel: Channel;
  client: DeviceClient;
  engine: PlayerEngine | null;
  trace: LogLine[];
}

export class World {
  readonly clock = new SimClock();
  readonly server = new FakeServer(this.clock);
  readonly devices: SimDevice[] = [];

  constructor() {
    for (const kind of ['web', 'phone', 'tv', 'pc'] as DeviceKind[]) this.devices.push(this.make(kind));
    for (const d of this.devices) {
      if (d.engine) d.engine.start();
      else d.client.start();
    }
  }

  device(kind: DeviceKind): SimDevice {
    return this.devices.find((d) => d.kind === kind)!;
  }

  private make(kind: DeviceKind): SimDevice {
    const channel = new Channel(this.server);
    this.server.channels.set(kind, channel);
    const trace: LogLine[] = [];
    const label = KIND_LABEL[kind];
    const dev = { kind, label, recordId: `${kind}-1`, skewMs: 0, channel, trace } as SimDevice;
    const now = () => this.clock.now() + dev.skewMs;
    const onTrace = (t: SyncTrace) => {
      const at = this.clock.now();
      const line = (text: string, tone: LogLine['tone']) => {
        trace.push({ at, who: label, text, tone });
        if (trace.length > 60) trace.shift();
      };
      if (t.kind === 'applied') line(`#${t.version} 적용`, 'ok');
      else if (t.kind === 'duplicate') line(`#${t.version} 이미 받아서 버림`, 'warn');
      else if (t.kind === 'buffered') line(`#${t.version} 먼저 도착해서 보관(앞 번호 기다리는 중)`, 'warn');
      else if (t.kind === 'snapshot')
        line(
          t.why === 'gap'
            ? `빠진 번호가 있어 현재 상태를 다시 받음: #${t.from} → #${t.to}`
            : t.why === 'reconnect'
              ? `다시 연결해서 현재 상태를 받아 따라잡음: #${t.from} → #${t.to}`
              : t.why === 'clock'
                ? '시계 차이를 다시 잼'
                : `처음 상태를 받음 #${t.to}`,
          t.why === 'gap' || t.why === 'reconnect' ? 'warn' : 'info',
        );
      else line('연결 끊김: 마지막 상태로 계속 재생', 'bad');
    };
    if (kind === 'web' || kind === 'phone') {
      dev.client = new DeviceClient(channel.transport(true, kind === 'web' ? 'op-web' : 'op-phone'), { now, onTrace });
      dev.engine = null;
    } else {
      dev.engine = new PlayerEngine({
        deviceId: dev.recordId,
        store: new MemStore(),
        now,
        flushMs: 2500,
        transport: channel.transport(false, dev.recordId),
        post: async (batch) => {
          if (!channel.connected) throw new Error('offline');
          await new Promise((r) => setTimeout(r, channel.latencyMs));
          return this.server.ingest(dev.recordId, batch);
        },
        onTrace,
      });
      dev.client = dev.engine.client;
    }
    return dev;
  }

  stop(): void {
    for (const d of this.devices) {
      if (d.engine) d.engine.stop();
      else d.client.stop();
    }
  }
}
