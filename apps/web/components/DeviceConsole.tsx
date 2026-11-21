'use client';
import { useState } from 'react';
import { sceneDataUri } from '@screenloop/scenes';
import type { Command, DeviceState } from '@screenloop/sync-core';
import { useDevice, useTick } from '@/lib/useDevice';
import { ScheduleEditor } from './ScheduleEditor';
import { errorToast, newCommandId, toastFor, type CommandInput, type Toast } from './messages';

export function DeviceConsole({ deviceId, name, canOperate, initial }: { deviceId: string; name: string; canOperate: boolean; initial: DeviceState }) {
  const { client, state, connection, pending } = useDevice(deviceId, canOperate);
  useTick(250);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeSec, setNoticeSec] = useState('60');
  const [volDraft, setVolDraft] = useState<number | null>(null);
  const view = state ?? initial;
  const np = client.nowPlaying();
  const overrideOn = client.overrideActive();

  async function run(cmd: CommandInput, okText: string) {
    setToast(null);
    try {
      const r = await client.send({ ...cmd, commandId: newCommandId() } as Command);
      setToast(toastFor(r, okText));
    } catch (e) {
      setToast(errorToast(e instanceof Error ? e.message : ''));
    }
  }

  async function commitVolume(v: number) {
    await run({ type: 'volume.set', volume: v }, '음량을 바꿨습니다.');
    setVolDraft(null);
  }

  const dis = !canOperate;
  return (
    <>
      <div>
        <h1 className="title" data-testid="device-name">
          {name}
        </h1>
        <p className="sub">
          <span className="mono">{deviceId}</span> · 이 화면의 편성표와 원격 조작 ·{' '}
          <span className={`badge ${connection === 'online' ? 'ok' : 'warn'}`} data-testid="console-conn">
            {connection === 'online' ? '실시간 연결됨' : connection === 'connecting' ? '연결 중' : '연결 끊김'}
          </span>{' '}
          <a href={`/remote/${deviceId}`}>휴대폰 리모컨 화면</a>
        </p>
        {dis && (
          <p className="toast warn" role="note">
            보기 전용 계정이라 조작과 편집이 막혀 있습니다. 서버도 같은 이유로 요청을 거절합니다.
          </p>
        )}
      </div>

      <div className="two">
        <section className="panel" aria-labelledby="h-now">
          <h2 id="h-now">지금 재생 중</h2>
          <div className="big-scene">
            {np && <img src={sceneDataUri(np.item.sceneId)} alt="" />}
            {overrideOn && view.override && (
              <div className="over" data-testid="override-banner">
                {view.override.text}
              </div>
            )}
          </div>
          <p style={{ margin: '8px 0 2px', color: 'var(--strong)', fontWeight: 600 }} data-testid="now-title">
            {np ? np.item.title : '재생할 항목이 없습니다'}
          </p>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${np ? Math.round((np.offsetInItemMs / (np.item.durationSec * 1000)) * 100) : 0}%` }} />
          </div>
          <div className="facts">
            <div className="fact">
              <div className="k">상태</div>
              <div className="v" data-testid="paused">
                {view.playback.paused ? '일시정지' : '재생 중'}
              </div>
            </div>
            <div className="fact">
              <div className="k">음량</div>
              <div className="v" data-testid="volume">
                {view.volume}
              </div>
            </div>
            <div className="fact">
              <div className="k">상태 버전</div>
              <div className="v" data-testid="version">
                {view.version}
              </div>
            </div>
            <div className="fact">
              <div className="k">편성표 버전</div>
              <div className="v" data-testid="schedule-version">
                {view.scheduleVersion}
              </div>
            </div>
          </div>
          {pending && (
            <p className="sub" role="status">
              서버 확인을 기다리는 중…
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="h-remote">
          <h2 id="h-remote">원격 조작</h2>
          <div className="row">
            <button className="btn primary" disabled={dis || !np} onClick={() => np && run({ type: 'playback.next', fromItemId: np.item.id }, '다음 항목으로 넘겼습니다.')}>
              다음 항목
            </button>
            {view.playback.paused ? (
              <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.resume' }, '재생을 다시 시작했습니다.')}>
                재개
              </button>
            ) : (
              <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.pause' }, '일시정지했습니다.')}>
                일시정지
              </button>
            )}
            <button className="btn" disabled={dis || !np} onClick={() => run({ type: 'playback.seek', positionMs: 0 }, '처음부터 다시 재생합니다.')}>
              처음부터
            </button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label htmlFor="vol">음량 {volDraft ?? view.volume}</label>
            <input
              id="vol"
              type="range"
              min={0}
              max={100}
              value={volDraft ?? view.volume}
              disabled={dis}
              aria-valuetext={`${volDraft ?? view.volume}`}
              onChange={(e) => setVolDraft(Number(e.target.value))}
              onPointerUp={(e) => commitVolume(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => {
                if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) commitVolume(Number((e.target as HTMLInputElement).value));
              }}
            />
            {[0, 30, 60, 100].map((v) => (
              <button key={v} className="btn small" disabled={dis} onClick={() => run({ type: 'volume.set', volume: v }, `음량을 ${v}으로 바꿨습니다.`)}>
                {v}
              </button>
            ))}
          </div>
          <form
            style={{ marginTop: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              const sec = noticeSec === '' ? null : Number(noticeSec);
              run({ type: 'override.set', text: notice, durationSec: sec }, '긴급 공지를 띄웠습니다.');
            }}
          >
            <h2 style={{ margin: '0 0 6px' }}>긴급 공지</h2>
            <div className="row">
              <input
                type="text"
                aria-label="공지 문구"
                placeholder="화면 전체를 덮을 문구(80자까지)"
                maxLength={80}
                style={{ flex: 1, minWidth: 180 }}
                value={notice}
                disabled={dis}
                onChange={(e) => setNotice(e.target.value)}
              />
              <select aria-label="표시 시간" value={noticeSec} disabled={dis} onChange={(e) => setNoticeSec(e.target.value)}>
                <option value="30">30초</option>
                <option value="60">1분</option>
                <option value="600">10분</option>
                <option value="">해제할 때까지</option>
              </select>
              <button className="btn danger" type="submit" disabled={dis || notice.trim() === ''}>
                공지 표시
              </button>
              <button className="btn" type="button" disabled={dis || !overrideOn} onClick={() => run({ type: 'override.clear' }, '긴급 공지를 내렸습니다.')}>
                공지 해제
              </button>
            </div>
          </form>
          <p className={`toast ${toast?.tone ?? ''}`} role="status" aria-live="polite" data-testid="toast">
            {toast?.text ?? ''}
          </p>
        </section>
      </div>

      <ScheduleEditor state={view} canOperate={canOperate} onRun={run} />
    </>
  );
}
