'use client';
import Link from 'next/link';
import { useState } from 'react';
import { sceneDataUri } from '@screenloop/scenes';
import type { Command } from '@screenloop/sync-core';
import { useDevice, useTick } from '@/lib/useDevice';
import { errorToast, newCommandId, toastFor, type CommandInput, type Toast } from './messages';

/** 휴대폰 리모컨. 운영 콘솔과 같은 동기화 코드(DeviceClient)로 같은 상태를 보고 같은 명령을 보낸다. */
export function Remote({ deviceId, canOperate }: { deviceId: string; canOperate: boolean }) {
  const { client, state, connection } = useDevice(deviceId, canOperate);
  useTick(250);
  const [toast, setToast] = useState<Toast | null>(null);
  const np = client.nowPlaying();
  const override = client.overrideActive();

  async function run(cmd: CommandInput, ok: string) {
    try { setToast(toastFor(await client.send({ ...cmd, commandId: newCommandId() } as Command), ok)); }
    catch (e) { setToast(errorToast(e instanceof Error ? e.message : '')); }
  }
  const dis = !canOperate || !state;
  return (
    <main className="remote" data-testid="remote">
      <header>
        <h1 className="title" style={{ fontSize: 19 }}>리모컨 <span className="mono">{deviceId}</span></h1>
        <p className="sub"><span className={`badge ${connection === 'online' ? 'ok' : 'warn'}`}>{connection === 'online' ? '연결됨' : '연결 끊김'}</span> · <Link href={`/devices/${deviceId}`}>운영 콘솔로</Link></p>
      </header>
      <div className="big-scene">
        {np && /* eslint-disable-next-line @next/next/no-img-element */ <img src={sceneDataUri(np.item.sceneId)} alt="" />}
        {override && state?.override && <div className="over">{state.override.text}</div>}
      </div>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--strong)' }} data-testid="remote-now">{np ? np.item.title : '재생할 항목이 없습니다'}{state?.playback.paused ? ' (일시정지)' : ''}</p>
      <div className="grid2">
        <button className="btn primary" disabled={dis || !np} onClick={() => np && run({ type: 'playback.next', fromItemId: np.item.id }, '다음으로 넘겼습니다.')}>다음</button>
        {state?.playback.paused
          ? <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.resume' }, '재개했습니다.')}>재개</button>
          : <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.pause' }, '일시정지했습니다.')}>일시정지</button>}
        <button className="btn" disabled={dis} onClick={() => run({ type: 'volume.set', volume: Math.max(0, (state?.volume ?? 50) - 10) }, '음량을 줄였습니다.')}>음량 −</button>
        <button className="btn" disabled={dis} onClick={() => run({ type: 'volume.set', volume: Math.min(100, (state?.volume ?? 50) + 10) }, '음량을 키웠습니다.')}>음량 +</button>
        <button className="btn danger" disabled={dis} onClick={() => run({ type: 'override.set', text: '잠시 안내 말씀드립니다', durationSec: 30 }, '긴급 공지를 띄웠습니다.')}>긴급 공지 30초</button>
        <button className="btn" disabled={dis || !override} onClick={() => run({ type: 'override.clear' }, '공지를 내렸습니다.')}>공지 해제</button>
      </div>
      <p className="sub mono" data-testid="remote-state">음량 {state?.volume ?? '—'} · v{state?.version ?? '—'}</p>
      <p className={`toast ${toast?.tone ?? ''}`} role="status" aria-live="polite">{toast?.text ?? ''}</p>
    </main>
  );
}
