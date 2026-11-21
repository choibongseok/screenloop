import { describe, expect, it } from 'vitest';
import { fromDraft, hasErrors, move, toDraft, toHHMM, toMinutes, validateItem, type ItemDraft } from '../lib/validation';
import { toastFor } from '../components/messages';

const ok: ItemDraft = { key: 'k', id: 'i1', title: '아침 인사', sceneId: 'aurora', durationSec: '10', windowOn: false, from: '09:00', to: '18:00' };

describe('편성 항목 입력 검사', () => {
  it('정상 입력은 오류가 없다', () => {
    expect(hasErrors(validateItem(ok))).toBe(false);
  });

  it('제목이 비었거나 길면 알려 준다', () => {
    expect(validateItem({ ...ok, title: '   ' }).title).toMatch(/입력/);
    expect(validateItem({ ...ok, title: 'x'.repeat(61) }).title).toMatch(/60자/);
  });

  it('재생 시간은 1~3600 사이 정수만 받는다', () => {
    for (const bad of ['', 'abc', '0', '3601', '1.5', '-3']) expect(validateItem({ ...ok, durationSec: bad }).durationSec, bad).toBeTruthy();
    for (const good of ['1', '10', '3600']) expect(validateItem({ ...ok, durationSec: good }).durationSec, good).toBeUndefined();
  });

  it('시간대는 HH:MM 이어야 하고 시작과 끝이 같으면 안 된다. 자정을 넘기는 시간대는 허용한다', () => {
    expect(validateItem({ ...ok, windowOn: true, from: '9:00', to: '18:00' }).window).toMatch(/HH:MM/);
    expect(validateItem({ ...ok, windowOn: true, from: '09:00', to: '09:00' }).window).toMatch(/같으면/);
    expect(validateItem({ ...ok, windowOn: true, from: '22:00', to: '06:00' }).window).toBeUndefined();
    expect(validateItem({ ...ok, windowOn: false, from: 'zz', to: 'zz' }).window).toBeUndefined();
  });

  it('입력 초안과 서버에 보내는 항목이 서로 오갈 때 값이 보존된다 (시간대 포함)', () => {
    const item = { id: 'i2', title: '야간', sceneId: 'dusk' as const, durationSec: 15, window: { fromMin: 1320, toMin: 360 } };
    const draft = toDraft(item, 'k');
    expect(draft.from).toBe('22:00');
    expect(draft.to).toBe('06:00');
    expect(fromDraft(draft)).toEqual(item);
    expect(fromDraft({ ...draft, windowOn: false })).toEqual({ id: 'i2', title: '야간', sceneId: 'dusk', durationSec: 15 });
    expect(toMinutes('22:30')).toBe(1350);
    expect(toHHMM(1350)).toBe('22:30');
  });

  it('순서 바꾸기는 원본을 고치지 않고 범위를 벗어나면 그대로 둔다', () => {
    const a = ['a', 'b', 'c'];
    expect(move(a, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(move(a, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(move(a, 0, -1)).toBe(a);
    expect(move(a, 1, 3)).toBe(a);
    expect(a).toEqual(['a', 'b', 'c']);
  });
});

describe('명령 결과 안내 문구', () => {
  it('받아들여지면 성공 문구, 거절 사유마다 다른 문구', () => {
    expect(toastFor({ result: 'accepted', version: 3, replayed: false }, '넘겼습니다.')).toEqual({ tone: 'ok', text: '넘겼습니다.' });
    expect(toastFor({ result: 'rejected', reason: 'stale', version: 3, replayed: false }, 'x').text).toMatch(/다른 곳에서 이미/);
    expect(toastFor({ result: 'rejected', reason: 'conflict', version: 3, replayed: false }, 'x').text).toMatch(/먼저 편성표를 저장/);
    expect(toastFor({ result: 'rejected', reason: 'unchanged', version: 3, replayed: false }, 'x').tone).toBe('warn');
  });
});
