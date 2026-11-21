import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PlayerEngine } from '@screenloop/sync-core';
import { SceneCache } from './sceneCache';
import { browserTransport, postRecords } from './transport';

declare global {
  interface Window {
    /** 시험과 현장 점검용으로 지금 상태를 읽을 수 있게 노출한다 */
    __player?: () => Record<string, unknown>;
  }
}

const params = new URLSearchParams(location.search);
const deviceId = params.get('device') ?? 'd-001';
const key = params.get('key') ?? `dk-${deviceId}`;
const skewMs = Number(params.get('skew') ?? 0) || 0; // 기기 시계를 일부러 틀리게(점검용)
const flushMs = Number(params.get('flush') ?? 5000) || 5000;
const debug = params.get('debug') === '1';

const safeStore = (): Pick<Storage, 'getItem' | 'setItem'> => {
  try {
    localStorage.setItem('sl_probe', '1');
    return localStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  }
};

export function App() {
  const sceneCache = useMemo(() => new SceneCache(), []);
  const engine = useMemo(() => {
    const store = safeStore();
    const now = () => Date.now() + skewMs;
    return new PlayerEngine({
      deviceId,
      store,
      now,
      flushMs,
      resyncMs: 60_000,
      transport: browserTransport(deviceId, key, store, now),
      post: (batch) => postRecords(deviceId, key, batch),
    });
  }, []);
  const [, setCachedTick] = useState(0);
  const version = useRef(0);
  useSyncExternalStore(
    (cb) => {
      const un = engine.client.subscribe(() => {
        version.current++;
        cb();
      });
      const i = setInterval(() => {
        version.current++;
        cb();
      }, 250);
      return () => {
        un();
        clearInterval(i);
      };
    },
    () => version.current,
    () => 0,
  );

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const state = engine.client.view;
  const np = engine.client.nowPlaying();
  const override = engine.client.overrideActive();
  const sceneIds = state?.schedule.items.map((i) => i.sceneId) ?? [];
  const sceneKey = sceneIds.join(',');
  useEffect(() => {
    void sceneCache.prefetch(sceneIds, () => setCachedTick((t) => t + 1));
  }, [sceneKey]);

  useEffect(() => {
    window.__player = () => ({
      deviceId,
      connection: engine.client.connection,
      version: engine.client.confirmed?.version ?? null,
      itemId: np?.item.id ?? null,
      itemTitle: np?.item.title ?? null,
      offsetInItemMs: np?.offsetInItemMs ?? null,
      itemDurationMs: np ? np.item.durationSec * 1000 : null,
      paused: state?.playback.paused ?? null,
      volume: state?.volume ?? null,
      override: override ? (state?.override?.text ?? null) : null,
      queued: engine.queue.size,
      lastAckSeq: engine.stats.lastAckSeq,
      sent: engine.stats.sent,
      flushFailures: engine.stats.flushFailures,
      duplicatesReported: engine.stats.duplicatesReported,
      clockOffsetMs: engine.client.clockOffsetMs,
      snapshots: engine.client.stats.snapshots,
      reconnects: engine.client.stats.reconnects,
      scenesCached: [...sceneCache.cached].sort(),
    });
  });

  const [fs, setFs] = useState(false);
  const online = engine.client.connection === 'online';
  const scene = np ? sceneCache.src(np.item.sceneId) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }} data-testid="player" data-item={np?.item.id ?? ''} data-conn={engine.client.connection}>
      {scene && <img key={np?.item.id} src={scene} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {!state && <Center text="연결하는 중…" />}
      {state && !np && <Center text="편성된 항목이 없습니다" />}
      {np && (
        <div
          style={{
            position: 'absolute',
            left: 24,
            bottom: 24,
            right: 24,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            textShadow: '0 1px 8px rgba(0,0,0,.8)',
          }}
        >
          <div>
            <div style={{ fontSize: 'clamp(22px, 4vw, 56px)', fontWeight: 700 }} data-testid="title">
              {np.item.title}
            </div>
            <div style={{ height: 4, width: 'min(60vw, 480px)', background: 'rgba(255,255,255,.25)', marginTop: 8 }}>
              <div style={{ height: '100%', width: `${Math.round((np.offsetInItemMs / (np.item.durationSec * 1000)) * 100)}%`, background: '#fff' }} />
            </div>
          </div>
          {state?.playback.paused && <div style={{ fontSize: 28, fontWeight: 700 }}>❚❚ 일시정지</div>}
        </div>
      )}
      {override && state?.override && (
        <div
          role="alert"
          data-testid="override"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(170, 20, 40, .94)',
            fontSize: 'clamp(28px, 6vw, 84px)',
            fontWeight: 800,
            textAlign: 'center',
            padding: 32,
          }}
        >
          {state.override.text}
        </div>
      )}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, opacity: debug || !online ? 1 : 0.0 }}>
        {!online && (
          <span data-testid="offline-badge" style={{ background: '#a56a00', padding: '2px 8px', borderRadius: 2 }}>
            연결 끊김 · 마지막 편성으로 재생 중
          </span>
        )}
        {debug && (
          <span style={{ background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 2 }}>
            {deviceId} · v{engine.client.confirmed?.version ?? '–'} · 대기 기록 {engine.queue.size} · 장면 캐시 {sceneCache.cached.size}
          </span>
        )}
      </div>
      {!fs && (
        <button
          type="button"
          onClick={() => {
            document.documentElement
              .requestFullscreen?.()
              .then(() => setFs(true))
              .catch(() => setFs(true));
          }}
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: 'rgba(0,0,0,.55)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,.4)',
            padding: '6px 12px',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          전체 화면
        </button>
      )}
    </div>
  );
}

function Center({ text }: { text: string }) {
  return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 24, color: '#ccc' }}>{text}</div>;
}
