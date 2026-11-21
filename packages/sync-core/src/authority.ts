import { nowPlaying, playableItems, startOfIndex } from './playback';
import { initialState, normalizeItem, reduce } from './reducer';
import type { Command, CommandResult, DeviceState, RejectReason, ScheduleItem, StateEvent } from './types';

const SCENES = ['aurora', 'waves', 'grid', 'pulse', 'dusk'];

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type Decision =
  | { result: 'accepted'; event: DistributiveOmit<StateEvent, 'deviceId' | 'version' | 'serverTimeMs' | 'actor'> }
  | { result: 'rejected'; reason: RejectReason };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function validItems(items: ScheduleItem[]): boolean {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return false;
  const ids = new Set<string>();
  for (const it of items) {
    if (typeof it.id !== 'string' || it.id.length < 1 || it.id.length > 40 || ids.has(it.id)) return false;
    ids.add(it.id);
    if (typeof it.title !== 'string' || it.title.trim().length < 1 || it.title.length > 60) return false;
    if (!SCENES.includes(it.sceneId)) return false;
    if (!isInt(it.durationSec) || it.durationSec < 1 || it.durationSec > 3600) return false;
    if (it.window) {
      const { fromMin, toMin } = it.window;
      if (!isInt(fromMin) || !isInt(toMin) || fromMin < 0 || fromMin > 1440 || toMin < 0 || toMin > 1440) return false;
    }
  }
  return true;
}

const reject = (reason: RejectReason): Decision => ({ result: 'rejected', reason });

/**
 * 명령 한 건을 지금 상태에서 판정한다(순수 함수). 충돌 규칙:
 *  - 서버가 도착 순서로 한 줄로 세운다. 이벤트 버전이 곧 그 순서다.
 *  - 절대값 명령(일시정지·재개·이동·음량·긴급 공지)은 나중에 도착한 쪽이 이긴다. 이미 같은 상태면 unchanged 로 거절하고 버전을 올리지 않는다.
 *  - 상대 명령(다음)은 조작자가 본 항목(fromItemId)이 아직 재생 중일 때만 받는다. 그 사이 다른 사람이 넘겼으면 stale.
 *  - 편성표 교체는 조작자가 본 scheduleVersion 이 그대로일 때만 받는다. 먼저 저장한 쪽이 이기고 늦은 쪽은 conflict.
 */
export function decide(state: DeviceState, cmd: Command, nowMs: number): Decision {
  switch (cmd.type) {
    case 'schedule.replace': {
      if (cmd.baseScheduleVersion !== state.scheduleVersion) return reject('conflict');
      if (!validItems(cmd.items)) return reject('invalid');
      return { result: 'accepted', event: { type: 'schedule.replaced', schedule: { items: cmd.items.map(normalizeItem) }, scheduleVersion: state.scheduleVersion + 1 } };
    }
    case 'playback.next': {
      const np = nowPlaying(state, nowMs);
      if (!np) return reject('invalid');
      if (np.item.id !== cmd.fromItemId) return reject('stale');
      const items = playableItems(state.schedule, nowMs);
      const nextIndex = (np.index + 1) % items.length;
      return { result: 'accepted', event: { type: 'playback.changed', reason: 'next', positionMs: startOfIndex(items, nextIndex), paused: state.playback.paused } };
    }
    case 'playback.jump': {
      const items = playableItems(state.schedule, nowMs);
      const idx = items.findIndex((it) => it.id === cmd.itemId);
      if (idx < 0) return reject('invalid');
      return { result: 'accepted', event: { type: 'playback.changed', reason: 'jump', positionMs: startOfIndex(items, idx), paused: state.playback.paused } };
    }
    case 'playback.pause': {
      if (state.playback.paused) return reject('unchanged');
      const np = nowPlaying(state, nowMs);
      return { result: 'accepted', event: { type: 'playback.changed', reason: 'pause', positionMs: np ? np.loopPositionMs : 0, paused: true } };
    }
    case 'playback.resume': {
      if (!state.playback.paused) return reject('unchanged');
      return { result: 'accepted', event: { type: 'playback.changed', reason: 'resume', positionMs: state.playback.positionMs, paused: false } };
    }
    case 'playback.seek': {
      const np = nowPlaying(state, nowMs);
      if (!np || !isInt(cmd.positionMs) || cmd.positionMs < 0 || cmd.positionMs >= np.loopLengthMs) return reject('invalid');
      return { result: 'accepted', event: { type: 'playback.changed', reason: 'seek', positionMs: cmd.positionMs, paused: state.playback.paused } };
    }
    case 'volume.set': {
      if (!isInt(cmd.volume) || cmd.volume < 0 || cmd.volume > 100) return reject('invalid');
      if (cmd.volume === state.volume) return reject('unchanged');
      return { result: 'accepted', event: { type: 'volume.changed', volume: cmd.volume } };
    }
    case 'override.set': {
      const text = typeof cmd.text === 'string' ? cmd.text : '';
      if (text.trim().length < 1 || text.length > 80) return reject('invalid');
      const d = cmd.durationSec;
      if (d !== undefined && d !== null && (!isInt(d) || d < 1 || d > 86400)) return reject('invalid');
      const untilMs = d === undefined || d === null ? null : nowMs + d * 1000;
      return { result: 'accepted', event: { type: 'override.set', text, untilMs } };
    }
    case 'override.clear': {
      if (state.override === null) return reject('unchanged');
      return { result: 'accepted', event: { type: 'override.cleared' } };
    }
  }
}

/** 한 화면의 서버 쪽 기록 장치: 이벤트 로그, 현재 상태, commandId 중복 방지. 데모 사이트의 가짜 서버와 테스트가 쓴다. */
export class DeviceAuthority {
  state: DeviceState;
  readonly log: StateEvent[] = [];
  private readonly seen = new Map<string, CommandResult>();

  constructor(deviceId: string, state?: DeviceState) {
    this.state = state ?? initialState(deviceId);
  }

  submit(cmd: Command, nowMs: number, actor: string): CommandResult {
    const prev = this.seen.get(cmd.commandId);
    if (prev) return { ...prev, replayed: true };
    const d = decide(this.state, cmd, nowMs);
    let out: CommandResult;
    if (d.result === 'accepted') {
      const event = { ...d.event, deviceId: this.state.deviceId, version: this.state.version + 1, serverTimeMs: nowMs, actor } as StateEvent;
      this.state = reduce(this.state, event);
      this.log.push(event);
      out = { result: 'accepted', version: this.state.version, replayed: false, event };
    } else {
      out = { result: 'rejected', reason: d.reason, version: this.state.version, replayed: false };
    }
    this.seen.set(cmd.commandId, out);
    return out;
  }

  eventsAfter(version: number): StateEvent[] {
    return this.log.filter((e) => e.version > version);
  }
}
