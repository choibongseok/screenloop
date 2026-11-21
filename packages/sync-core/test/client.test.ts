import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceClient, type Command, type CommandResult, type StateEvent, type Transport } from '../src/index';
import { DeviceAuthority } from './fakeServer';

const T0 = Date.UTC(2026, 10, 21, 0, 0, 0);
const items = [
  { id: 'a', title: 'A', sceneId: 'aurora' as const, durationSec: 10 },
  { id: 'b', title: 'B', sceneId: 'waves' as const, durationSec: 20 },
];
let n = 0;
const c = (o: object) => ({ commandId: `k${++n}`, ...o }) as Command;

/** 서버 흉내: 권한자 + 이벤트를 클라이언트로 흘려보내는 통로(끊기·지연·순서 바꾸기를 시험이 조절한다) */
class FakeServer {
  auth = new DeviceAuthority('d-1');
  clock = T0;
  handlers: { onEvent(ev: StateEvent): void; onOpen(): void; onError(): void } | null = null;
  down = false;
  skew = 0; // 기기 시계 - 서버 시계
  constructor() {
    this.auth.submit(c({ type: 'schedule.replace', baseScheduleVersion: 0, items }), this.clock, 'seed');
  }
  transport(): Transport {
    return {
      fetchSnapshot: async () => {
        if (this.down) throw new Error('offline');
        return { state: structuredClone(this.auth.state), serverTimeMs: this.clock };
      },
      open: (_after, h) => {
        this.handlers = h;
        if (!this.down) queueMicrotask(() => h.onOpen());
        return () => {
          if (this.handlers === h) this.handlers = null;
        };
      },
      sendCommand: async (cmd): Promise<CommandResult> => {
        await Promise.resolve();
        const r = this.auth.submit(cmd, this.clock, 'op');
        if (r.event) this.handlers?.onEvent(r.event);
        return r;
      },
    };
  }
  push(ev: StateEvent) {
    this.handlers?.onEvent(ev);
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('스냅샷으로 시작하고 스트림 이벤트로 상태를 따라간다', async () => {
    const s = new FakeServer();
    const cl = new DeviceClient(s.transport(), { now: () => s.clock + s.skew });
    cl.start();
    await flush();
    expect(cl.connection).toBe('online');
    expect(cl.confirmed?.schedule.items).toHaveLength(2);
    s.clock += 1000;
    s.auth.submit(c({ type: 'volume.set', volume: 70 }), s.clock, 'op');
    s.push(s.auth.log.at(-1)!);
    expect(cl.confirmed?.volume).toBe(70);
    cl.stop();
  });

  it('이벤트가 빠지면 잠시 뒤 스냅샷을 다시 받아 따라잡는다', async () => {
    const s = new FakeServer();
    const cl = new DeviceClient(s.transport(), { now: () => s.clock });
    cl.start();
    await flush();
    for (const v of [11, 12, 13]) {
      s.clock += 100;
      s.auth.submit(c({ type: 'volume.set', volume: v }), s.clock, 'op');
    }
    s.push(s.auth.log.at(-1)!); // 마지막 것만 도착, 앞 둘은 유실
    expect(cl.confirmed?.volume).toBe(50);
    expect(cl.replicaStats.buffered).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(cl.confirmed?.volume).toBe(13);
    expect(cl.stats.snapshots).toBe(2);
    cl.stop();
  });

  it('끊기면 마지막 상태를 유지하고, 다시 붙으면 스냅샷으로 따라잡는다', async () => {
    const s = new FakeServer();
    const cl = new DeviceClient(s.transport(), { now: () => s.clock, backoffMs: [100] });
    cl.start();
    await flush();
    s.down = true;
    s.handlers!.onError();
    expect(cl.connection).toBe('offline');
    const before = cl.confirmed!.volume;
    s.clock += 5000;
    s.auth.submit(c({ type: 'volume.set', volume: 33 }), s.clock, 'op'); // 끊긴 동안 일어난 변경
    await vi.advanceTimersByTimeAsync(150); // 재시도: 아직 서버 응답 불가
    expect(cl.connection).toBe('offline');
    expect(cl.confirmed!.volume).toBe(before);
    s.down = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(cl.connection).toBe('online');
    expect(cl.confirmed!.volume).toBe(33);
    expect(cl.stats.reconnects).toBe(1);
    cl.stop();
  });

  it('조작은 서버 답 전에 지역 판정으로 먼저 보이고, 서버가 거절하면 걷어낸다', async () => {
    const s = new FakeServer();
    const cl = new DeviceClient(s.transport(), { now: () => s.clock });
    cl.start();
    await flush();
    // 다른 운영자가 먼저 음량을 바꿔 둠(이 클라이언트는 아직 모름)
    s.auth.submit(c({ type: 'playback.pause' }), s.clock, 'other');
    expect(cl.view!.playback.paused).toBe(false);
    const p = cl.send(c({ type: 'playback.pause' })); // 지역에서는 아직 안 멈춘 줄 알고 받아들여질 것으로 판정
    expect(cl.view!.playback.paused).toBe(true); // 낙관적으로 보임
    const r = await p;
    expect(r.result).toBe('rejected'); // 서버는 이미 멈춰 있어 unchanged
    expect(r.reason).toBe('unchanged');
    expect(cl.hasPending).toBe(false);
    cl.stop();
  });

  it('기기 시계가 90초 빨라도 서버 시각으로 보정해 같은 항목을 가리킨다', async () => {
    const s = new FakeServer();
    s.skew = 90_000;
    const cl = new DeviceClient(s.transport(), { now: () => s.clock + s.skew });
    cl.start();
    await flush();
    s.clock += 12_000; // 서버 기준 편성 후 12초
    expect(Math.abs(cl.clockOffsetMs + 90_000)).toBeLessThanOrEqual(1);
    const np = cl.nowPlaying()!;
    expect(np.item.id).toBe('b');
    expect(np.offsetInItemMs).toBe(2000);
    cl.stop();
  });

  it('시작-중지-시작을 빠르게 반복해도 스트림은 하나만 열린다 (개발 모드의 이중 마운트)', async () => {
    const s = new FakeServer();
    let opens = 0;
    const base = s.transport();
    const t: Transport = {
      ...base,
      open: (a, h) => {
        opens++;
        return base.open(a, h);
      },
    };
    const cl = new DeviceClient(t, { now: () => s.clock });
    cl.start();
    cl.stop();
    cl.start();
    await flush();
    expect(opens).toBe(1);
    expect(cl.connection).toBe('online');
    cl.stop();
  });

  it('기기 시계가 바뀐 뒤 resync 하면 시계 차이를 다시 재서 보정한다', async () => {
    const s = new FakeServer();
    const cl = new DeviceClient(s.transport(), { now: () => s.clock + s.skew });
    cl.start();
    await flush();
    expect(Math.abs(cl.clockOffsetMs)).toBeLessThanOrEqual(1);
    s.skew = 45_000; // 기기 시계가 갑자기 45초 빨라짐(예: 수동 설정)
    expect(cl.nowPlaying()!.item.id).not.toBe('a'); // 보정이 낡아서 엉뚱한 위치를 가리킨다
    await cl.resync();
    expect(Math.abs(cl.clockOffsetMs + 45_000)).toBeLessThanOrEqual(1);
    expect(cl.nowPlaying()!.item.id).toBe('a');
    cl.stop();
  });

  it('마지막 이벤트가 유실돼 빠진 구간이 안 보여도, 하트비트가 알려 준 서버 버전으로 뒤처진 것을 알아채고 따라잡는다', async () => {
    const s = new FakeServer();
    let beat: ((v: number) => void) | undefined;
    const base = s.transport();
    const t: Transport = {
      ...base,
      open: (a, h) => {
        beat = h.onHeartbeat;
        return base.open(a, h);
      },
    };
    const cl = new DeviceClient(t, { now: () => s.clock });
    cl.start();
    await flush();
    s.clock += 100;
    s.auth.submit(c({ type: 'volume.set', volume: 61 }), s.clock, 'op'); // 이 이벤트는 기기에 오지 않는다(유실)
    expect(cl.confirmed?.volume).toBe(50);
    expect(cl.replicaStats.buffered).toBe(0); // 빠진 구간이 보이지 않는다
    beat!(s.auth.state.version);
    await vi.advanceTimersByTimeAsync(700);
    expect(cl.confirmed?.volume).toBe(61);
    cl.stop();
  });
});
