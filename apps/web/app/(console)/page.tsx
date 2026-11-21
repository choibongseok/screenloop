import { api } from '@/lib/server';
import type { DeviceSummary } from '@screenloop/sync-core';
import { DeviceGrid } from '@/components/DeviceGrid';

export default async function Home() {
  const devices = await api<DeviceSummary[]>('/api/devices');
  return (
    <>
      <div>
        <h1 className="title">화면</h1>
        <p className="sub">각 화면의 지금 상태입니다. 카드를 누르면 편성표 편집과 원격 조작으로 이동합니다.</p>
      </div>
      <DeviceGrid initial={devices} />
    </>
  );
}
