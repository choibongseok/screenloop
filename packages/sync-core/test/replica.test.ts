import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Replica, initialState, reduce, type Command, type StateEvent } from '../src/index';
import { DeviceAuthority } from './fakeServer';

const T0 = Date.UTC(2026, 10, 21, 0, 0, 0);
const items = [
  { id: 'i1', title: 'A', sceneId: 'aurora' as const, durationSec: 10 },
  { id: 'i2', title: 'B', sceneId: 'waves' as const, durationSec: 20 },
  { id: 'i3', title: 'C', sceneId: 'grid' as const, durationSec: 30 },
];

/** 명령 목록을 서버에 넣어 이벤트 로그를 만든다 */
function run(cmds: Command[]) {
  const dev = new DeviceAuthority('d-1');
  dev.submit({ commandId: 'seed', type: 'schedule.replace', baseScheduleVersion: 0, items }, T0, 'seed');
  cmds.forEach((c, i) => dev.submit(c, T0 + (i + 1) * 1500, i % 2 ? 'op-b' : 'op-a'));
  return dev;
}

let seq = 0;
const arbCommand: fc.Arbitrary<Command> = fc
  .oneof(
    fc.constantFrom('i1', 'i2', 'i3', 'zz').map((f): Command => ({ commandId: '', type: 'playback.next', fromItemId: f })),
    fc.constantFrom('i1', 'i2', 'i3', 'zz').map((f): Command => ({ commandId: '', type: 'playback.jump', itemId: f })),
    fc.constant<Command>({ commandId: '', type: 'playback.pause' }),
    fc.constant<Command>({ commandId: '', type: 'playback.resume' }),
    fc.integer({ min: -5000, max: 61000 }).map((p): Command => ({ commandId: '', type: 'playback.seek', positionMs: p })),
    fc.integer({ min: -3, max: 104 }).map((v): Command => ({ commandId: '', type: 'volume.set', volume: v })),
    fc.tuple(fc.constantFrom('점심 안내', ' ', '긴급'), fc.constantFrom(null, 5, 90)).map(([t, d]): Command => ({ commandId: '', type: 'override.set', text: t, durationSec: d })),
    fc.constant<Command>({ commandId: '', type: 'override.clear' }),
    fc.integer({ min: 0, max: 3 }).map((b): Command => ({ commandId: '', type: 'schedule.replace', baseScheduleVersion: b, items: items.slice(0, 2) })),
  )
  .map((c): Command => ({ ...c, commandId: `c-${++seq}` }));

const arbLog = fc.array(arbCommand, { minLength: 1, maxLength: 40 }).map((cmds) => run(cmds));

function deliver(log: StateEvent[], order: number[]): Replica {
  const r = new Replica(initialState('d-1'));
  for (const i of order) r.receive(log[i]!);
  return r;
}

describe('Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트', () => {
  it('앞 버전이 늦게 와도 보관했다가 이어서 적용한다 (순서 뒤바뀜)', () => {
    const dev = run([
      { commandId: 'a', type: 'volume.set', volume: 10 },
      { commandId: 'b', type: 'volume.set', volume: 20 },
      { commandId: 'c', type: 'volume.set', volume: 30 },
    ]);
    const r = new Replica(initialState('d-1'));
    expect(r.receive(dev.log[3]!)).toBe('buffered');
    expect(r.receive(dev.log[2]!)).toBe('buffered');
    expect(r.hasGap).toBe(true);
    expect(r.receive(dev.log[0]!)).toBe('applied');
    expect(r.receive(dev.log[1]!)).toBe('applied');
    expect(r.hasGap).toBe(false);
    expect(r.state).toEqual(dev.state);
  });

  it('이미 적용한 버전과 보관 중인 버전이 또 오면 버린다 (중복)', () => {
    const dev = run([
      { commandId: 'a', type: 'volume.set', volume: 10 },
      { commandId: 'b', type: 'volume.set', volume: 20 },
    ]);
    const r = new Replica(initialState('d-1'));
    r.receive(dev.log[0]!);
    expect(r.receive(dev.log[0]!)).toBe('duplicate');
    r.receive(dev.log[2]!);
    expect(r.receive(dev.log[2]!)).toBe('buffered');
    expect(r.stats.duplicates).toBe(2);
    r.receive(dev.log[1]!);
    expect(r.state).toEqual(dev.state);
  });

  it('중간이 빠지면 hasGap 이 켜지고, 스냅샷을 받으면 따라잡아 보관분까지 이어 적용한다 (누락)', () => {
    const dev = run([
      { commandId: 'a', type: 'volume.set', volume: 10 },
      { commandId: 'b', type: 'volume.set', volume: 20 },
      { commandId: 'c', type: 'volume.set', volume: 30 },
      { commandId: 'd', type: 'volume.set', volume: 40 },
    ]);
    const r = new Replica(initialState('d-1'));
    r.receive(dev.log[0]!);
    r.receive(dev.log[3]!);
    r.receive(dev.log[4]!);
    expect(r.hasGap).toBe(true);
    expect(r.version).toBe(1);
    const snapAt3 = dev.log.slice(0, 3).reduce(reduce, initialState('d-1')); // 서버가 v3 시점에 준 스냅샷
    expect(snapAt3.version).toBe(3);
    r.applySnapshot(snapAt3);
    expect(r.version).toBe(5);
    expect(r.hasGap).toBe(false);
    expect(r.state?.volume).toBe(40);
  });

  it('더 오래된 스냅샷은 무시한다', () => {
    const dev = run([{ commandId: 'a', type: 'volume.set', volume: 10 }]);
    const r = new Replica(dev.state);
    r.applySnapshot(initialState('d-1'));
    expect(r.state).toEqual(dev.state);
    expect(r.stats.snapshots).toBe(0);
  });

  it('속성: 이벤트가 어떤 순서·중복으로 와도(빠짐 없음) 끝 상태가 서버와 같다', () => {
    fc.assert(
      fc.property(arbLog, fc.infiniteStream(fc.nat()), (dev, rnd) => {
        const log = dev.log;
        const idx = log.map((_, i) => i);
        const dup = [...idx, ...idx.filter(() => rnd.next().value % 3 === 0)];
        for (let i = dup.length - 1; i > 0; i--) {
          const j = rnd.next().value % (i + 1);
          [dup[i], dup[j]] = [dup[j]!, dup[i]!];
        }
        const r = deliver(log, dup);
        expect(r.hasGap).toBe(false);
        expect(r.state).toEqual(dev.state);
      }),
      { numRuns: 300 },
    );
  });

  it('속성: 일부가 빠져도 스냅샷을 받으면 끝 상태가 서버와 같다', () => {
    fc.assert(
      fc.property(arbLog, fc.infiniteStream(fc.nat()), (dev, rnd) => {
        const log = dev.log;
        const kept = log.map((_, i) => i).filter(() => rnd.next().value % 4 !== 0);
        for (let i = kept.length - 1; i > 0; i--) {
          const j = rnd.next().value % (i + 1);
          [kept[i], kept[j]] = [kept[j]!, kept[i]!];
        }
        const r = deliver(log, kept);
        if (r.state!.version !== dev.state.version || r.hasGap) r.applySnapshot(dev.state);
        expect(r.hasGap).toBe(false);
        expect(r.state).toEqual(dev.state);
      }),
      { numRuns: 300 },
    );
  });

  it('속성: 서버 쪽 명령이 같은 commandId 로 여러 번 와도 이벤트는 한 번만 생긴다', () => {
    fc.assert(
      fc.property(fc.array(arbCommand, { minLength: 1, maxLength: 20 }), (cmds) => {
        const once = run(cmds);
        const twice = new DeviceAuthority('d-1');
        twice.submit({ commandId: 'seed', type: 'schedule.replace', baseScheduleVersion: 0, items }, T0, 'seed');
        cmds.forEach((c, i) => {
          twice.submit(c, T0 + (i + 1) * 1500, i % 2 ? 'op-b' : 'op-a');
          twice.submit(c, T0 + (i + 1) * 1500 + 7, 'op-z');
        });
        expect(twice.log).toEqual(once.log);
      }),
      { numRuns: 100 },
    );
  });
});
