import type { Command, CommandResult } from '@screenloop/sync-core';

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** commandId 만 빼고 쓰는 명령(commandId 는 보내는 순간에 붙인다) */
export type CommandInput = DistributiveOmit<Command, 'commandId'>;

export interface Toast {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
}

const reasons: Record<string, string> = {
  stale: '그 사이 다른 곳에서 이미 바뀌어서 적용하지 않았습니다.',
  conflict: '다른 사람이 먼저 편성표를 저장했습니다. 최신 편성표를 불러온 뒤 다시 저장하세요.',
  invalid: '값이 올바르지 않아 적용하지 않았습니다.',
  unchanged: '이미 그 상태입니다.',
};

export function toastFor(r: CommandResult, okText: string): Toast {
  if (r.result === 'accepted') return { tone: 'ok', text: okText };
  return { tone: r.reason === 'unchanged' ? 'warn' : 'bad', text: reasons[r.reason ?? ''] ?? '적용하지 못했습니다.' };
}

export const errorToast = (message: string): Toast => ({ tone: 'bad', text: message || '요청에 실패했습니다.' });

let n = 0;
/** 명령 ID. 같은 ID 로 다시 보내면 서버가 처음 결과를 돌려준다. */
export function newCommandId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `web-${rnd}`;
}
