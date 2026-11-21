import type { ScheduleItem } from '@screenloop/sync-core';

export interface ItemDraft {
  key: string;
  id: string;
  title: string;
  sceneId: ScheduleItem['sceneId'];
  durationSec: string;
  windowOn: boolean;
  from: string; // HH:MM
  to: string;
}

export interface ItemErrors {
  title?: string;
  durationSec?: string;
  window?: string;
}

const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMinutes = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
export const toHHMM = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 편성 항목 한 줄의 입력 검사. 서버도 같은 기준으로 다시 검사한다. */
export function validateItem(d: ItemDraft): ItemErrors {
  const e: ItemErrors = {};
  if (d.title.trim().length === 0) e.title = '제목을 입력하세요.';
  else if (d.title.length > 60) e.title = '제목은 60자까지입니다.';
  const sec = Number(d.durationSec);
  if (d.durationSec.trim() === '' || !Number.isInteger(sec)) e.durationSec = '재생 시간은 정수(초)로 입력하세요.';
  else if (sec < 1 || sec > 3600) e.durationSec = '재생 시간은 1~3600초입니다.';
  if (d.windowOn) {
    if (!hhmm.test(d.from) || !hhmm.test(d.to)) e.window = '시간대는 HH:MM 형식으로 입력하세요.';
    else if (d.from === d.to) e.window = '시작과 끝이 같으면 재생되지 않습니다.';
  }
  return e;
}

export const hasErrors = (e: ItemErrors): boolean => Object.keys(e).length > 0;

export function toDraft(it: ScheduleItem, key: string): ItemDraft {
  return {
    key,
    id: it.id,
    title: it.title,
    sceneId: it.sceneId,
    durationSec: String(it.durationSec),
    windowOn: !!it.window,
    from: it.window ? toHHMM(it.window.fromMin) : '09:00',
    to: it.window ? toHHMM(it.window.toMin) : '18:00',
  };
}

export function fromDraft(d: ItemDraft): ScheduleItem {
  const item: ScheduleItem = { id: d.id, title: d.title.trim(), sceneId: d.sceneId, durationSec: Number(d.durationSec) };
  if (d.windowOn) item.window = { fromMin: toMinutes(d.from), toMin: toMinutes(d.to) };
  return item;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const copy = list.slice();
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x as T);
  return copy;
}

let counter = 0;
export const newItemId = (): string => `item-${Date.now().toString(36)}-${(counter++).toString(36)}`;
