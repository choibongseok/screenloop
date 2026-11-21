'use client';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { DeviceClient, openEventStream, type Command, type CommandResult, type DeviceState, type Snapshot, type Transport } from '@screenloop/sync-core';
import { sendCommand } from './actions';

/** 브라우저용 전송 계층: 스냅샷은 /api/snapshot, 스트림은 /api/stream(둘 다 이 웹 앱의 프록시), 조작은 서버 액션 */
function browserTransport(deviceId: string, canSend: boolean): Transport {
  return {
    async fetchSnapshot(): Promise<Snapshot> {
      const r = await fetch(`/api/snapshot/${deviceId}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`snapshot ${r.status}`);
      return (await r.json()) as Snapshot;
    },
    open: (after, h) => openEventStream(`/api/stream/${deviceId}?after=${after}`, h),
    sendCommand: canSend
      ? async (cmd: Command): Promise<CommandResult> => {
          const r = await sendCommand(deviceId, cmd);
          if (!r.ok) throw new Error(r.message);
          return r.value;
        }
      : undefined,
  };
}

export interface DeviceView {
  client: DeviceClient;
  state: DeviceState | null;
  connection: DeviceClient['connection'];
  pending: boolean;
}

/** 한 화면의 동기화 상태를 구독한다. 상태가 바뀔 때마다 다시 그리고, 재생 위치는 호출한 쪽이 타이머로 읽는다. */
export function useDevice(deviceId: string, canSend: boolean): DeviceView {
  const client = useMemo(() => new DeviceClient(browserTransport(deviceId, canSend)), [deviceId, canSend]);
  const version = useRef(0);
  const snapshot = useSyncExternalStore(
    (cb) => client.subscribe(() => { version.current++; cb(); }),
    () => version.current,
    () => 0,
  );
  useEffect(() => { client.start(); return () => client.stop(); }, [client]);
  void snapshot;
  return { client, state: client.view, connection: client.connection, pending: client.hasPending };
}

/** 500ms 마다 다시 그리게 하는 시계(재생 위치 표시용) */
export function useTick(ms = 500): number {
  const t = useRef(0);
  return useSyncExternalStore(
    (cb) => { const i = setInterval(() => { t.current++; cb(); }, ms); return () => clearInterval(i); },
    () => t.current,
    () => 0,
  );
}
