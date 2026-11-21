import { openEventStream, type PlayRecordBatch, type PlayRecordResult, type Snapshot, type Transport } from '@screenloop/sync-core';

export interface Cached {
  state: Snapshot['state'];
  offsetMs: number;
}

/**
 * 브라우저용 전송 계층. 기기 키는 헤더(fetch) 또는 쿼리(EventSource 는 헤더를 못 붙인다)로 보낸다.
 * 서버에 못 닿을 때 마지막 스냅샷이 저장돼 있으면 그것으로 계속 재생한다(저장 당시의 시계 차이를 그대로 쓴다).
 */
export function browserTransport(deviceId: string, key: string, store: Pick<Storage, 'getItem' | 'setItem'>, now: () => number): Transport {
  const cacheKey = `sl_last_${deviceId}`;
  return {
    async fetchSnapshot(): Promise<Snapshot> {
      try {
        const t0 = now();
        const r = await fetch(`/api/devices/${deviceId}/snapshot`, { headers: { 'X-Device-Key': key }, cache: 'no-store' });
        if (!r.ok) throw new Error(`snapshot ${r.status}`);
        const snap = (await r.json()) as Snapshot;
        try {
          store.setItem(cacheKey, JSON.stringify({ state: snap.state, offsetMs: snap.serverTimeMs - (t0 + now()) / 2 } satisfies Cached));
        } catch {
          /* 저장 실패는 무시 */
        }
        return snap;
      } catch (e) {
        const raw = store.getItem(cacheKey);
        if (!raw) throw e;
        const c = JSON.parse(raw) as Cached;
        return { state: c.state, serverTimeMs: Math.round(now() + c.offsetMs) };
      }
    },
    open: (after, h) => openEventStream(`/api/devices/${deviceId}/stream?after=${after}&deviceKey=${encodeURIComponent(key)}`, h),
  };
}

export async function postRecords(deviceId: string, key: string, batch: PlayRecordBatch): Promise<PlayRecordResult> {
  const r = await fetch(`/api/devices/${deviceId}/play-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': key },
    body: JSON.stringify(batch),
  });
  if (!r.ok) throw new Error(`records ${r.status}`);
  return (await r.json()) as PlayRecordResult;
}
