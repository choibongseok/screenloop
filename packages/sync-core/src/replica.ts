import { reduce } from './reducer';
import type { DeviceState, StateEvent } from './types';

export type ReceiveResult = 'applied' | 'duplicate' | 'buffered';

/**
 * 기기 쪽 사본. 서버가 보낸 이벤트를 버전 순서대로만 적용한다.
 *  - 이미 적용한 버전은 버린다(중복).
 *  - 앞 버전이 아직 안 왔으면 보관한다(순서 뒤바뀜). 앞 버전이 도착하면 이어서 적용한다.
 *  - 보관만 쌓이고 앞 버전이 오지 않으면 hasGap 이 켜진다(누락). 이때 스냅샷을 받아 applySnapshot 한다.
 * 어떤 순서·중복으로 와도, 빠진 것이 없으면 끝 상태가 서버와 같다. 빠졌으면 스냅샷으로 따라잡는다.
 */
export class Replica {
  state: DeviceState | null = null;
  private readonly pending = new Map<number, StateEvent>();
  readonly stats = { applied: 0, duplicates: 0, buffered: 0, snapshots: 0 };

  constructor(initial?: DeviceState) {
    if (initial) this.state = initial;
  }

  get version(): number {
    return this.state?.version ?? -1;
  }

  get hasGap(): boolean {
    return this.pending.size > 0;
  }

  receive(ev: StateEvent): ReceiveResult {
    if (!this.state) throw new Error('스냅샷을 먼저 받아야 한다');
    if (ev.version <= this.state.version) {
      this.stats.duplicates++;
      return 'duplicate';
    }
    if (ev.version > this.state.version + 1) {
      if (this.pending.has(ev.version)) this.stats.duplicates++;
      else this.stats.buffered++;
      this.pending.set(ev.version, ev);
      return 'buffered';
    }
    this.apply(ev);
    this.drain();
    return 'applied';
  }

  /** 서버가 준 전체 상태로 따라잡는다. 지금보다 오래된 스냅샷은 무시한다. */
  applySnapshot(snap: DeviceState): void {
    if (this.state && snap.version < this.state.version) return;
    this.state = snap;
    this.stats.snapshots++;
    for (const v of [...this.pending.keys()]) if (v <= snap.version) this.pending.delete(v);
    this.drain();
  }

  private apply(ev: StateEvent): void {
    this.state = reduce(this.state!, ev);
    this.stats.applied++;
  }

  private drain(): void {
    for (;;) {
      const nxt = this.pending.get(this.state!.version + 1);
      if (!nxt) return;
      this.pending.delete(nxt.version);
      this.apply(nxt);
    }
  }
}
