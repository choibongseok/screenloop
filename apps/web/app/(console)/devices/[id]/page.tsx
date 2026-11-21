import { notFound } from 'next/navigation';
import { ApiError, api, requireSession } from '@/lib/server';
import type { Snapshot, DeviceSummary } from '@screenloop/sync-core';
import { DeviceConsole } from '@/components/DeviceConsole';

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  let snap: Snapshot;
  let name = id;
  try {
    snap = await api<Snapshot>(`/api/devices/${encodeURIComponent(id)}/snapshot`);
    name = (await api<DeviceSummary[]>('/api/devices')).find((d) => d.id === id)?.name ?? id;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <DeviceConsole deviceId={id} name={name} canOperate={s.role === 'operator'} initial={snap.state} />;
}
