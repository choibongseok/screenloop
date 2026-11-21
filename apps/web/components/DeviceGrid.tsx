'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { sceneDataUri } from '@screenloop/scenes';
import type { DeviceSummary } from '@screenloop/sync-core';
import { useDevice, useTick } from '@/lib/useDevice';

/** 플레이어(TV·PC) 연결 상태는 서버가 알고 있으므로 몇 초마다 목록을 다시 읽는다. */
function usePlayers(initial: DeviceSummary[]): DeviceSummary[] {
  const [list, setList] = useState(initial);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/devices', { cache: 'no-store' });
        if (r.ok && alive) setList((await r.json()) as DeviceSummary[]);
      } catch {
        /* 다음 주기에 다시 */
      }
    };
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return list;
}

export function DeviceGrid({ initial }: { initial: DeviceSummary[] }) {
  const devices = usePlayers(initial);
  if (devices.length === 0) return <p className="empty panel">등록된 화면이 없습니다.</p>;
  return (
    <div className="cards" role="list">
      {devices.map((d) => (
        <DeviceCard key={d.id} summary={d} />
      ))}
    </div>
  );
}

function DeviceCard({ summary }: { summary: DeviceSummary }) {
  const { client, state, connection } = useDevice(summary.id, false);
  useTick(500);
  const np = client.nowPlaying();
  const override = client.overrideActive();
  return (
    <article className="card" role="listitem" data-testid={`card-${summary.id}`} data-online={summary.online}>
      <div className="scene">
        {np ? <img src={sceneDataUri(np.item.sceneId)} alt="" /> : null}
        {!state && (
          <div className="over" style={{ background: 'rgba(0,0,0,.6)' }}>
            불러오는 중…
          </div>
        )}
        {state && !np && (
          <div className="over" style={{ background: 'rgba(0,0,0,.6)' }}>
            편성된 항목 없음
          </div>
        )}
        {override && state?.override && (
          <div className="over" data-testid="override-banner">
            {state.override.text}
          </div>
        )}
      </div>
      <div className="body">
        <h2>
          <Link href={`/devices/${summary.id}`}>{summary.name}</Link>
        </h2>
        <div className="row">
          <span className={`badge ${summary.online ? 'ok' : 'bad'}`} data-testid={`player-${summary.id}`}>
            {summary.online ? '플레이어 연결됨' : '플레이어 끊김'}
          </span>
          {state?.playback.paused && <span className="badge warn">일시정지</span>}
          {connection === 'offline' && <span className="badge warn">콘솔 연결 끊김</span>}
        </div>
        <div data-testid={`now-${summary.id}`}>{np ? np.item.title : '—'}</div>
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${np ? Math.round((np.offsetInItemMs / (np.item.durationSec * 1000)) * 100) : 0}%` }} />
        </div>
        <div className="sub mono">
          v{state?.version ?? summary.version} · 음량 {state?.volume ?? summary.volume}
        </div>
      </div>
    </article>
  );
}
