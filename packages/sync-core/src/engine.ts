import { DeviceClient, type ClientOptions, type Transport } from './client';
import { PlayTracker, RecordQueue, type KeyValueStore } from './records';
import type { PlayRecordBatch, PlayRecordResult } from './types';

export interface EngineDeps {
  transport: Transport;
  /** 재생 기록 묶음을 서버로 보낸다. 실패하면 던진다. */
  post(batch: PlayRecordBatch): Promise<PlayRecordResult>;
  store: KeyValueStore;
  deviceId: string;
  /** 기기 시계(ms). 시계가 틀린 기기를 흉내 낼 때 바꿔 끼운다. */
  now?: () => number;
  flushMs?: number;
  onTrace?: ClientOptions['onTrace'];
  setTimer?: ClientOptions['setTimer'];
  clearTimer?: ClientOptions['clearTimer'];
}

/**
 * 플레이어의 재생 장치(화면과 무관한 부분).
 *  - 상태 동기화는 DeviceClient. 끊겨도 마지막 상태로 계속 재생하고, 다시 붙으면 따라잡는다.
 *  - 지금 재생 항목이 바뀔 때마다 지나간 항목의 재생 기록을 만들어 기기 안 대기열(RecordQueue)에 쌓는다.
 *  - 대기열은 주기적으로, 그리고 다시 연결됐을 때 서버로 보낸다. 서버가 받았다고 알려 준 번호(ackSeq)까지만 지운다.
 *    응답이 유실돼 같은 기록을 또 보내도 서버가 (기기, 일련번호)로 걸러 낸다.
 *  - 일시정지 중이거나 긴급 공지가 화면을 덮고 있는 동안은 편성 항목을 재생한 것으로 세지 않는다.
 */
export class PlayerEngine {
  readonly client: DeviceClient;
  readonly queue: RecordQueue;
  readonly tracker: PlayTracker;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<ClientOptions['setTimer']>;
  private readonly clearTimer: NonNullable<ClientOptions['clearTimer']>;
  private flushTimer: unknown = null;
  private tickTimer: unknown = null;
  private flushing = false;
  private wasOnline = false;
  private unsubscribe: (() => void) | null = null;
  readonly stats = { flushes: 0, flushFailures: 0, sent: 0, acked: 0, duplicatesReported: 0, lastAckSeq: 0 };

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.client = new DeviceClient(deps.transport, { now: this.now, setTimer: this.setTimer, clearTimer: this.clearTimer, onTrace: deps.onTrace });
    this.queue = new RecordQueue(deps.store, `sl_queue_${deps.deviceId}`);
    this.tracker = new PlayTracker((itemId, s, e) => this.queue.append(itemId, s, e));
  }

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.client.subscribe(() => this.onChange());
    this.client.start();
    const tick = () => { this.track(); this.tickTimer = this.setTimer(tick, 500); };
    tick();
    const flushLoop = () => { void this.flush(); this.flushTimer = this.setTimer(flushLoop, this.deps.flushMs ?? 5000); };
    this.flushTimer = this.setTimer(flushLoop, this.deps.flushMs ?? 5000);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client.stop();
    if (this.flushTimer) this.clearTimer(this.flushTimer);
    if (this.tickTimer) this.clearTimer(this.tickTimer);
    this.tracker.stop(this.now());
  }

  private onChange(): void {
    this.track();
    const online = this.client.connection === 'online';
    if (online && !this.wasOnline) void this.flush(); // 다시 붙으면 쌓아 둔 기록을 바로 보낸다
    this.wasOnline = online;
  }

  /** 지금 무엇을 재생 중인지 보고 기록을 끊거나 시작한다 */
  track(): void {
    const view = this.client.view;
    const local = this.now();
    if (!view) return;
    const np = this.client.nowPlaying();
    const counting = np && !view.playback.paused && !this.client.overrideActive();
    if (!counting) { this.tracker.observe(null, local); return; }
    // 재생 중에 항목이 바뀐 것이면 실제로 바뀐 시각(지금 - 항목 안 위치)으로 끊는다
    const boundary = this.tracker.active ? Math.max(this.tracker.activeStartMs, local - np.offsetInItemMs) : local;
    this.tracker.observe(np.item.id, local, boundary);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.size === 0) return;
    this.flushing = true;
    try {
      const records = this.queue.pending(500);
      const r = await this.deps.post({ clockOffsetMs: this.client.clockOffsetMs, records });
      this.stats.flushes++;
      this.stats.sent += records.length;
      this.stats.duplicatesReported += r.duplicates;
      this.stats.lastAckSeq = r.ackSeq;
      this.queue.ack(r.ackSeq);
    } catch {
      this.stats.flushFailures++;
    } finally {
      this.flushing = false;
    }
  }
}
