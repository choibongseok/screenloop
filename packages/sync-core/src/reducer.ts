import type { DeviceState, ScheduleItem, StateEvent } from './types';

export function initialState(deviceId: string): DeviceState {
  return {
    deviceId,
    version: 0,
    scheduleVersion: 0,
    schedule: { items: [] },
    playback: { anchorMs: 0, positionMs: 0, paused: false },
    volume: 50,
    override: null,
  };
}

/** 항목을 저장 형태로 맞춘다. window 가 없거나 null 이면 키를 두지 않는다(서버와 JSON 이 같아지도록). */
export function normalizeItem(it: ScheduleItem): ScheduleItem {
  const base: ScheduleItem = { id: it.id, title: it.title, sceneId: it.sceneId, durationSec: it.durationSec };
  if (it.window) base.window = { fromMin: it.window.fromMin, toMin: it.window.toMin };
  return base;
}

/**
 * 이벤트 한 건을 적용한다. 순수 함수이고 시각은 이벤트에 들어 있는 serverTimeMs 만 쓴다.
 * 그래서 어느 기기에서 언제 적용해도 같은 결과가 나온다. 버전 순서 확인은 Replica 가 한다.
 */
export function reduce(state: DeviceState, ev: StateEvent): DeviceState {
  const next: DeviceState = { ...state, version: ev.version };
  switch (ev.type) {
    case 'schedule.replaced':
      next.schedule = { items: ev.schedule.items.map(normalizeItem) };
      next.scheduleVersion = ev.scheduleVersion;
      // 편성표가 바뀌면 처음부터 다시 재생한다. 일시정지 여부는 유지한다.
      next.playback = { anchorMs: ev.serverTimeMs, positionMs: 0, paused: state.playback.paused };
      return next;
    case 'playback.changed':
      next.playback = { anchorMs: ev.serverTimeMs, positionMs: ev.positionMs, paused: ev.paused };
      return next;
    case 'volume.changed':
      next.volume = ev.volume;
      return next;
    case 'override.set':
      next.override = { text: ev.text, untilMs: ev.untilMs };
      return next;
    case 'override.cleared':
      next.override = null;
      return next;
  }
}
