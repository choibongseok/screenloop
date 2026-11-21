/**
 * 기기 시계와 서버 시계의 차이 추정. 요청을 보낸 시각 t0, 응답을 받은 시각 t1(둘 다 기기 시계), 서버가 응답에 넣은 시각 s.
 * 서버 시각이 왕복의 한가운데라고 보고 offset = s - (t0 + t1) / 2. 왕복이 가장 짧았던 표본이 오차가 가장 작아서 그것을 쓴다.
 */
export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];
  constructor(private readonly keep = 8) {}

  addSample(t0: number, serverMs: number, t1: number): ClockSample {
    const s = { offsetMs: Math.round(serverMs - (t0 + t1) / 2), rttMs: Math.max(0, t1 - t0) };
    this.samples.push(s);
    if (this.samples.length > this.keep) this.samples.shift();
    return s;
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** 서버 시각 - 기기 시각 */
  get offsetMs(): number {
    if (this.samples.length === 0) return 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rttMs < best.rttMs) best = s;
    return best.offsetMs;
  }

  /** 기기 시각을 서버 시각으로 */
  serverNow(localMs: number): number {
    return localMs + this.offsetMs;
  }
}
