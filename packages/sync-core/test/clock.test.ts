import { describe, expect, it } from 'vitest';
import { ClockSync, DeviceAuthority, nowPlaying } from '../src/index';

describe('기기 시계 차이 보정', () => {
  it('왕복이 대칭이면 오프셋 오차가 1ms 이내다 (기기 시계가 37초 빠른 경우)', () => {
    const c = new ClockSync();
    const skew = 37_000; // 기기 = 서버 + 37초
    const serverAtReply = 1_000_000;
    // 보낸 때 서버 시각 999_960, 응답 받은 때 1_000_040 (왕복 80ms), 기기 시계는 서버 + skew
    c.addSample(999_960 + skew, serverAtReply, 1_000_040 + skew);
    expect(Math.abs(c.offsetMs + skew)).toBeLessThanOrEqual(1);
  });

  it('왕복이 가장 짧은 표본을 쓴다 (느린 왕복은 오차가 커서 버린다)', () => {
    const c = new ClockSync();
    const skew = -12_000;
    c.addSample(100_000 + skew, 100_400, 100_900 + skew); // 왕복 900ms, 응답이 한쪽으로 치우침
    c.addSample(200_000 + skew, 200_025, 200_050 + skew); // 왕복 50ms
    c.addSample(300_000 + skew, 300_300, 300_700 + skew);
    expect(Math.abs(c.offsetMs + skew)).toBeLessThanOrEqual(25);
  });

  it('시계가 전혀 다른 두 기기도 보정하면 같은 항목·같은 위치를 가리킨다', () => {
    const dev = new DeviceAuthority('d-1');
    const t0 = Date.UTC(2026, 10, 21, 0, 0, 0);
    dev.submit({ commandId: 's', type: 'schedule.replace', baseScheduleVersion: 0, items: [{ id: 'a', title: 'A', sceneId: 'grid', durationSec: 10 }, { id: 'b', title: 'B', sceneId: 'waves', durationSec: 10 }] }, t0, 'op');
    const serverNow = t0 + 13_000;
    const skewA = +90_000, skewB = -45_000; // 한 대는 90초 빠르고 한 대는 45초 느림
    const a = new ClockSync(), b = new ClockSync();
    a.addSample(serverNow - 20 + skewA, serverNow, serverNow + 20 + skewA);
    b.addSample(serverNow - 30 + skewB, serverNow, serverNow + 30 + skewB);
    const npA = nowPlaying(dev.state, a.serverNow(serverNow + skewA))!;
    const npB = nowPlaying(dev.state, b.serverNow(serverNow + skewB))!;
    expect(npA.item.id).toBe('b');
    expect(npB.item.id).toBe('b');
    expect(npA.offsetInItemMs).toBe(3000);
    expect(npB.offsetInItemMs).toBe(3000);
    // 보정하지 않으면 한 대는 엉뚱한 항목을 가리킨다
    expect(nowPlaying(dev.state, serverNow + skewA)!.item.id).not.toBe(npB.item.id);
  });
});
