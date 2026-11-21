import type { DeviceState, Schedule, ScheduleItem } from './types';

/** 기본 시간대 기준: 한국 표준시(UTC+9). 시간대 편성(window)은 이 시계의 하루 분(0~1440)으로 읽는다. */
export const TZ_OFFSET_MIN = 540;

export function minuteOfDay(serverMs: number, tzOffsetMin = TZ_OFFSET_MIN): number {
  const m = Math.floor(serverMs / 60000) + tzOffsetMin;
  return ((m % 1440) + 1440) % 1440;
}

function inWindow(item: ScheduleItem, minute: number): boolean {
  const w = item.window;
  if (!w) return true;
  return w.fromMin <= w.toMin ? minute >= w.fromMin && minute < w.toMin : minute >= w.fromMin || minute < w.toMin;
}

/** 그 시각에 재생 대상인 항목(시간대 편성을 적용). 순서는 편성표 순서. */
export function playableItems(schedule: Schedule, serverMs: number): ScheduleItem[] {
  const minute = minuteOfDay(serverMs);
  return schedule.items.filter((it) => inWindow(it, minute));
}

export function loopLengthMs(items: ScheduleItem[]): number {
  return items.reduce((n, it) => n + it.durationSec * 1000, 0);
}

export interface NowPlaying {
  item: ScheduleItem;
  index: number;
  /** 재생 목록(한 바퀴) 안에서 이 항목이 시작하는 위치 */
  startMs: number;
  /** 이 항목 안에서의 위치 */
  offsetInItemMs: number;
  /** 한 바퀴 안에서의 위치 */
  loopPositionMs: number;
  loopLengthMs: number;
}

/** 서버 시각 기준 지금 재생 위치. 재생 목록이 비면 null. 기기 시계는 쓰지 않는다. */
export function nowPlaying(state: DeviceState, serverMs: number): NowPlaying | null {
  const items = playableItems(state.schedule, serverMs);
  const total = loopLengthMs(items);
  if (items.length === 0 || total === 0) return null;
  const p = state.playback;
  const elapsed = p.paused ? p.positionMs : p.positionMs + Math.max(0, serverMs - p.anchorMs);
  const pos = elapsed % total;
  let start = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const len = it.durationSec * 1000;
    if (pos < start + len) return { item: it, index: i, startMs: start, offsetInItemMs: pos - start, loopPositionMs: pos, loopLengthMs: total };
    start += len;
  }
  throw new Error('unreachable');
}

export function startOfIndex(items: ScheduleItem[], index: number): number {
  let s = 0;
  for (let i = 0; i < index; i++) s += items[i]!.durationSec * 1000;
  return s;
}

export function overrideActive(state: DeviceState, serverMs: number): boolean {
  const o = state.override;
  return o !== null && (o.untilMs === null || serverMs < o.untilMs);
}
