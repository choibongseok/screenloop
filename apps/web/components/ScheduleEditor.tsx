'use client';
import { useEffect, useRef, useState } from 'react';
import type { DeviceState } from '@screenloop/sync-core';
import type { CommandInput } from './messages';
import { SCENE_IDS, SCENE_LABEL } from '@screenloop/scenes';
import { fromDraft, hasErrors, move, newItemId, toDraft, validateItem, type ItemDraft } from '@/lib/validation';

type Run = (cmd: CommandInput, okText: string) => Promise<void>;

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

/**
 * 편성표 편집. 끌어서(또는 위·아래 버튼으로) 순서를 바꾸고, 항목마다 시간대 편성을 줄 수 있다.
 * 저장할 때 보는 기준은 "내가 불러온 편성표 버전"이다. 그 사이 다른 사람이 저장했으면 서버가 conflict 로 거절한다.
 */
export function ScheduleEditor({ deviceId, state, canOperate, onRun }: { deviceId: string; state: DeviceState; canOperate: boolean; onRun: Run }) {
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => state.schedule.items.map((it) => toDraft(it, nextKey())));
  const [baseVersion, setBaseVersion] = useState(state.scheduleVersion);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  // 편집 중이 아니면 서버의 최신 편성표를 따라간다
  useEffect(() => {
    if (!dirty && state.scheduleVersion !== baseVersion) {
      setDrafts(state.schedule.items.map((it) => toDraft(it, nextKey())));
      setBaseVersion(state.scheduleVersion);
    }
  }, [state.scheduleVersion, state.schedule.items, dirty, baseVersion]);

  const behind = dirty && state.scheduleVersion !== baseVersion;
  const errors = drafts.map(validateItem);
  const idsOk = new Set(drafts.map((d) => d.id)).size === drafts.length;
  const invalid = errors.some(hasErrors) || drafts.length === 0 || !idsOk;
  const dis = !canOperate;

  const edit = (i: number, patch: Partial<ItemDraft>) => { setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const reorder = (from: number, to: number) => { setDrafts((d) => move(d, from, to)); setDirty(true); };

  function reload() {
    setDrafts(state.schedule.items.map((it) => toDraft(it, nextKey())));
    setBaseVersion(state.scheduleVersion);
    setDirty(false);
    setShowErrors(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (invalid) {
      setFocusTick((t) => t + 1); // 오류 표시가 그려진 뒤 첫 오류 입력으로 초점을 옮긴다
      return;
    }
    setSaving(true);
    await onRun({ type: 'schedule.replace', baseScheduleVersion: baseVersion, items: drafts.map(fromDraft) }, '편성표를 저장했습니다.');
    setSaving(false);
  }

  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  // 저장이 받아들여지면 서버 쪽 버전이 올라가므로, 그 값이 내가 보낸 내용과 같으면 편집 상태를 닫는다
  useEffect(() => {
    if (dirty && state.scheduleVersion === baseVersion + 1 && JSON.stringify(state.schedule.items) === JSON.stringify(drafts.map((d) => fromDraft(d)))) {
      setBaseVersion(state.scheduleVersion);
      setDirty(false);
      setShowErrors(false);
    }
  }, [state.scheduleVersion, state.schedule.items, dirty, baseVersion, drafts]);

  return (
    <section className="panel" aria-labelledby="h-sched">
      <h2 id="h-sched">편성표 편집 <span className="badge mono">편성표 v{baseVersion}</span></h2>
      <p className="sub" style={{ marginTop: 0 }}>항목을 끌어서 순서를 바꾸거나 위·아래 버튼을 쓰세요. 시간대를 켜면 그 시간에만 재생합니다(한국 시간 기준, 자정을 넘기는 시간대도 됩니다).</p>
      {behind && (
        <p className="toast warn" role="alert">
          편집하는 사이 다른 사람이 편성표를 저장했습니다(서버 v{state.scheduleVersion}).{' '}
          <button type="button" className="btn small" onClick={reload}>최신 편성표 불러오기</button>
        </p>
      )}
      <form ref={formRef} onSubmit={save} noValidate aria-describedby="sched-help">
        <ol className="sched" data-testid="schedule-list">
          {drafts.length === 0 && <li className="empty">항목이 없습니다. 아래에서 추가하세요.</li>}
          {drafts.map((d, i) => {
            const err = showErrors ? errors[i]! : {};
            return (
              <li key={d.key} data-testid={`item-${i}`} draggable={!dis}
                data-dragging={dragFrom === i} data-over={dragOver === i && dragFrom !== i}
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) reorder(dragFrom, i); setDragFrom(null); setDragOver(null); }}>
                <div className="line">
                  <span className="handle" aria-hidden="true" title="끌어서 순서 바꾸기">⠿</span>
                  <span className="mono" style={{ alignSelf: 'center', color: 'var(--muted)' }}>{i + 1}</span>
                  <div className="field" style={{ flex: '1 1 200px' }}>
                    <label htmlFor={`t-${d.key}`}>제목</label>
                    <input id={`t-${d.key}`} type="text" value={d.title} disabled={dis} aria-invalid={!!err.title} aria-describedby={err.title ? `te-${d.key}` : undefined} onChange={(e) => edit(i, { title: e.target.value })} />
                    {err.title && <span id={`te-${d.key}`} className="err">{err.title}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor={`s-${d.key}`}>장면</label>
                    <select id={`s-${d.key}`} value={d.sceneId} disabled={dis} onChange={(e) => edit(i, { sceneId: e.target.value as ItemDraft['sceneId'] })}>
                      {SCENE_IDS.map((s) => <option key={s} value={s}>{SCENE_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`d-${d.key}`}>재생 시간(초)</label>
                    <input id={`d-${d.key}`} type="text" inputMode="numeric" style={{ width: 90 }} value={d.durationSec} disabled={dis} aria-invalid={!!err.durationSec} aria-describedby={err.durationSec ? `de-${d.key}` : undefined} onChange={(e) => edit(i, { durationSec: e.target.value })} />
                    {err.durationSec && <span id={`de-${d.key}`} className="err">{err.durationSec}</span>}
                  </div>
                </div>
                <div className="line">
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={d.windowOn} disabled={dis} onChange={(e) => edit(i, { windowOn: e.target.checked })} /> 시간대 편성
                  </label>
                  {d.windowOn && (
                    <>
                      <input type="time" aria-label={`${i + 1}번 항목 시작 시각`} value={d.from} disabled={dis} aria-invalid={!!err.window} onChange={(e) => edit(i, { from: e.target.value })} />
                      <span>~</span>
                      <input type="time" aria-label={`${i + 1}번 항목 끝 시각`} value={d.to} disabled={dis} aria-invalid={!!err.window} onChange={(e) => edit(i, { to: e.target.value })} />
                      {err.window && <span className="err">{err.window}</span>}
                    </>
                  )}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn small" disabled={dis || i === 0} aria-label={`${i + 1}번 항목(${d.title || '제목 없음'}) 위로`} onClick={() => reorder(i, i - 1)}>↑</button>
                  <button type="button" className="btn small" disabled={dis || i === drafts.length - 1} aria-label={`${i + 1}번 항목(${d.title || '제목 없음'}) 아래로`} onClick={() => reorder(i, i + 1)}>↓</button>
                  <button type="button" className="btn small danger" disabled={dis} aria-label={`${i + 1}번 항목(${d.title || '제목 없음'}) 삭제`} onClick={() => { setDrafts((x) => x.filter((_, j) => j !== i)); setDirty(true); }}>삭제</button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn" disabled={dis || drafts.length >= 50} onClick={() => { setDrafts((x) => [...x, toDraft({ id: newItemId(), title: '', sceneId: 'aurora', durationSec: 10 }, nextKey())]); setDirty(true); }}>항목 추가</button>
          <button type="submit" className="btn primary" disabled={dis || !dirty || saving} data-testid="save-schedule">{saving ? '저장 중…' : '편성표 저장'}</button>
          <button type="button" className="btn" disabled={!dirty} onClick={reload}>되돌리기</button>
          <span id="sched-help" className="sub">{dirty ? '저장하지 않은 변경이 있습니다.' : '저장된 편성표와 같습니다.'}</span>
        </div>
        {showErrors && invalid && <p className="err" role="alert">입력을 고친 뒤 저장하세요.{drafts.length === 0 ? ' 항목이 하나 이상 있어야 합니다.' : ''}</p>}
      </form>
    </section>
  );
}
